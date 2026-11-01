import {
  AUTO_REFRESH_MS,
  LOCATION,
  MOOD_COPY,
  PREVIEW_SCENARIOS,
  RECORD_PAGE_SIZE,
  TICK_MS,
  WORLD_CACHE_MAX_AGE_HOURS,
  WORLD_CACHE_URL,
} from './config.js';
import { loadWorldCache } from './app/worldCache.js';
import { runRefresh } from './app/runRefresh.js';
import { buildSourceStates } from './app/sourceState.js';
import { loadSettings, saveSettings } from './app/settings.js';
import { createRepository } from './store/repository.js';
import { openMurmurStore } from './store/indexedDb.js';
import { createMemoryStore } from './store/memoryStore.js';
import { activeReactionKeys, computeMood } from './mood/engine.js';
import { createReaction } from './interpret/reactions.js';
import { faceSvg } from './ui/face.js';
import { bubblesMarkup, moodTimeText, wakingBubblesMarkup } from './ui/moodView.js';
import {
  EXPLORE_FILTERS,
  availabilityMarkup,
  breakdownMarkup,
  conditionMarkup,
  exploreSummary,
  matchesFilter,
  recordListMarkup,
  scenarioChipsMarkup,
} from './ui/panels.js';
import { escapeHtml } from './lib/validate.js';
import { formatClock, formatDuration, formatRelative, HOUR_MS } from './lib/time.js';
import { moodLabel } from './ui/format.js';

const $ = (id) => document.getElementById(id);

const state = {
  now: Date.now(),
  repository: null,
  storeKind: 'memory',
  records: [],
  recordsByKey: new Map(),
  reactions: [],
  reactionsByKey: new Map(),
  sourceStates: [],
  mood: computeMood({ reactions: [], now: Date.now() }),
  activeKeys: new Set(),
  settings: loadSettings(),
  newsModel: null,
  busy: false,
  lastRefreshAt: null,
  cacheGeneratedAt: null,
  cacheStale: false,
  nextRefreshAt: null,
  refreshNote: 'Murmur has not loaded the hourly world cache yet.',
  exploreFilter: 'all',
  exploreActiveOnly: false,
  exploreLimit: RECORD_PAGE_SIZE,
  previewId: PREVIEW_SCENARIOS[0].id,
  toastTimer: null,
};

function setText(id, text) {
  const element = $(id);
  if (element) element.textContent = text;
}

function toast(message) {
  const element = $('toast');
  element.textContent = message;
  element.hidden = false;
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => {
    element.hidden = true;
  }, 4200);
}

function storageKindLabel() {
  return state.storeKind === 'indexeddb' ? 'saved in IndexedDB' : 'in-memory only';
}

function latestRecord(group) {
  return state.records.find((record) => record.group === group) ?? null;
}

function findSourceState(sourceId) {
  return state.sourceStates.find((sourceState) => sourceState.sourceId === sourceId) ?? null;
}

function isWaking() {
  return !state.lastRefreshAt && state.records.length === 0;
}

/* ------------------------------------------------------------------ */
/* Rendering                                                          */
/* ------------------------------------------------------------------ */

function renderMood() {
  const waking = isWaking();
  const mood = state.mood.mood;
  const copy = MOOD_COPY[mood] ?? MOOD_COPY.calm;

  $('face-slot').innerHTML = faceSvg(waking ? 'calm' : mood);
  $('mood-heading').textContent = waking ? 'Waking up…' : moodLabel(mood);
  $('mood-description').textContent = waking
    ? 'Murmur is gathering its first impressions of the world.'
    : state.mood.description;
  $('mood-time').textContent = waking
    ? 'No refresh yet.'
    : moodTimeText({
        mood: state.mood,
        lastRefreshAt: state.lastRefreshAt,
        cacheGeneratedAt: state.cacheGeneratedAt,
        now: state.now,
      });
  $('bubbles').innerHTML = waking ? wakingBubblesMarkup() : bubblesMarkup(state.mood);

  document.documentElement.style.setProperty('--mood-tint', copy.accent);
}

function renderConditions() {
  $('weather-card').innerHTML = conditionMarkup({
    kind: 'weather',
    record: latestRecord('weather'),
    sourceState: findSourceState('weather'),
    now: state.now,
  });
  $('air-card').innerHTML = conditionMarkup({
    kind: 'air',
    record: latestRecord('air'),
    sourceState: findSourceState('air'),
    now: state.now,
  });
}

function renderAvailability() {
  const { chips, note } = availabilityMarkup(state.sourceStates, {
    now: state.now,
    storeKind: state.storeKind,
    lastRefreshAt: state.lastRefreshAt,
    cacheGeneratedAt: state.cacheGeneratedAt,
    cacheStale: state.cacheStale,
  });
  $('source-chips').innerHTML = chips;
  $('availability-note').textContent = note;
}

function contributionMap() {
  return new Map(state.mood.active.map((item) => [item.reaction.key, item.contribution]));
}

function ignoredReasonMap() {
  return new Map(state.mood.ignored.map((item) => [item.reaction.key, item.reason]));
}

function filteredRecords() {
  let rows = state.records.filter((record) => matchesFilter(record, state.exploreFilter));
  if (state.exploreActiveOnly) {
    rows = rows.filter((record) => {
      const reaction = state.reactionsByKey.get(record.key);
      return reaction && state.activeKeys.has(reaction.key);
    });
  }
  return rows;
}

function renderExplorePressed() {
  for (const button of $('explore-filters').querySelectorAll('[data-filter]')) {
    button.setAttribute('aria-pressed', String(button.dataset.filter === state.exploreFilter));
  }
}

function renderExploreList() {
  const rows = filteredRecords();
  const activeCount = state.records.filter((record) => {
    const reaction = state.reactionsByKey.get(record.key);
    return reaction && state.activeKeys.has(reaction.key);
  }).length;
  const filterLabel =
    EXPLORE_FILTERS.find((filter) => filter.id === state.exploreFilter)?.label ?? 'all records';

  $('explore-summary').textContent = exploreSummary({
    total: rows.length,
    activeCount,
    shown: state.exploreLimit,
    filterLabel,
    activeOnly: state.exploreActiveOnly,
  });

  $('record-list').innerHTML = recordListMarkup({
    records: rows,
    reactionsByKey: state.reactionsByKey,
    activeKeys: state.activeKeys,
    contributionByKey: contributionMap(),
    ignoredReasons: ignoredReasonMap(),
    now: state.now,
    newsModel: state.newsModel,
    limit: state.exploreLimit,
  });

  $('show-more').hidden = rows.length <= state.exploreLimit;
}

function renderBreakdown() {
  $('breakdown-body').innerHTML = breakdownMarkup({
    mood: state.mood,
    sourceStates: state.sourceStates,
    newsModel: state.newsModel,
    now: state.now,
    storeKind: state.storeKind,
    cacheGeneratedAt: state.cacheGeneratedAt,
    cacheStale: state.cacheStale,
  });
}

function renderPreview() {
  const scenario = PREVIEW_SCENARIOS.find((entry) => entry.id === state.previewId) ?? PREVIEW_SCENARIOS[0];
  $('scenario-chips').innerHTML = scenarioChipsMarkup(PREVIEW_SCENARIOS, scenario.id);
  $('preview-face').innerHTML = faceSvg(scenario.mood, { preview: true });
  $('preview-title').textContent = scenario.title;
  $('preview-description').textContent = scenario.description;
}

function renderModelPill() {
  const pill = $('model-pill');
  const news = state.newsModel;
  if (!news) {
    pill.dataset.state = 'off';
    pill.textContent = 'News mood: waiting';
    return;
  }
  if (news.error) {
    pill.dataset.state = 'error';
    pill.textContent = 'News mood: unavailable';
    return;
  }
  if (news.reactionCount > 0) {
    pill.dataset.state = 'on';
    pill.textContent = `News mood: ${news.model}`;
    return;
  }
  pill.dataset.state = news.configured ? 'error' : 'off';
  pill.textContent = news.configured ? 'News mood: no reactions' : 'News mood: not generated';
}

function renderRefreshStatus() {
  const element = $('refresh-status');
  const news = state.newsModel;
  let text = state.refreshNote;
  let tone = '';

  if (!news) {
    text += ' News mood has not loaded yet.';
  } else if (news.error) {
    text += ` News mood: ${news.error.slice(0, 180)}`;
    tone = 'warn';
  } else if (news.reactionCount > 0) {
    text += ` News mood: ${news.reactionCount} cached reaction${
      news.reactionCount === 1 ? '' : 's'
    } from ${news.model}.`;
    tone = 'ok';
  } else if (news.configured) {
    text += ' The news model returned no usable reactions for this cache.';
    tone = 'warn';
  } else {
    text += ' News mood is not generated; no model key was configured for this cache.';
  }

  element.textContent = text;
  if (tone) element.dataset.tone = tone;
  else delete element.dataset.tone;
}

function renderNextRefresh() {
  const element = $('next-refresh');
  if (state.busy) {
    element.textContent = 'Checking for a new cache…';
    return;
  }
  if (!state.nextRefreshAt) {
    element.textContent = 'Checks for a new cache every 10 minutes';
    return;
  }
  const remaining = Math.max(0, state.nextRefreshAt - state.now);
  element.textContent = `Next cache check in ${formatDuration(remaining / 60_000)}`;
}

function renderAll() {
  renderMood();
  renderConditions();
  renderAvailability();
  renderExplorePressed();
  renderExploreList();
  renderBreakdown();
  renderPreview();
  renderModelPill();
  renderRefreshStatus();
  renderNextRefresh();
}

/* ------------------------------------------------------------------ */
/* Refresh and interpretation                                         */
/* ------------------------------------------------------------------ */

function summarizeRefresh(sourceStates, result, snapshot) {
  const counts = sourceStates.reduce(
    (accumulator, sourceState) => {
      accumulator[sourceState.status] = (accumulator[sourceState.status] ?? 0) + 1;
      return accumulator;
    },
    {},
  );
  const answered = sourceStates.filter(
    (sourceState) => sourceState.status === 'live' || sourceState.status === 'empty',
  ).length;
  const parts = [
    `Hourly cache generated ${formatRelative(snapshot.generatedAt, Date.now())}`,
    `${answered} of ${sourceStates.length} sources answered`,
  ];
  for (const status of ['live', 'empty', 'cached', 'malformed', 'unavailable']) {
    if (counts[status]) parts.push(`${counts[status]} ${status}`);
  }
  if (result?.duplicates) parts.push(`${result.duplicates} duplicate${result.duplicates === 1 ? '' : 's'} removed`);
  if (snapshot.newsReactions.length) {
    parts.push(`${snapshot.newsReactions.length} news reaction${snapshot.newsReactions.length === 1 ? '' : 's'} cached`);
  }
  if (snapshot.staleHours > WORLD_CACHE_MAX_AGE_HOURS) {
    parts.push('stale; GitHub Actions may be delayed or disabled');
  }
  return `${formatClock(Date.now())} · ${parts.join(' · ')}.`;
}

async function saveCachedNewsReactions(snapshot, records) {
  const byKey = new Map(records.map((record) => [record.key, record]));
  let saved = 0;
  for (const item of snapshot.newsReactions) {
    const record = byKey.get(item.sourceId);
    if (!record) continue;
    const reaction = createReaction(record, item, { now: item.interpretedAt });
    if (!reaction) continue;
    const result = await state.repository.saveReactionIfAbsent(reaction);
    if (result.saved) saved += 1;
  }
  return saved;
}

async function reloadSavedState() {
  state.reactions = await state.repository.listReactions();
  state.reactionsByKey = new Map(state.reactions.map((reaction) => [reaction.recordKey, reaction]));
  state.recordsByKey = new Map(state.records.map((record) => [record.key, record]));
}

async function refresh({ auto = false } = {}) {
  if (state.busy) return;
  state.busy = true;
  const button = $('refresh-button');
  button.disabled = true;
  button.textContent = auto ? 'Checking quietly…' : 'Loading cache…';
  setText(
    'refresh-status',
    auto ? 'Checking for a new hourly cache…' : 'Loading the hourly world cache…',
  );
  renderNextRefresh();

  try {
    const now = Date.now();
    const snapshot = await loadWorldCache({
      fetchImpl: window.fetch.bind(window),
      url: WORLD_CACHE_URL,
      now,
    });
    const loaders = snapshot.sources.map((source) => ({
      id: source.sourceId,
      label: source.label,
      provider: source.provider,
      homepage: source.homepage,
      group: source.group,
      async load() {
        return {
          status: source.status,
          records: source.records,
          error: source.error,
          fetchedAt: source.fetchedAt,
          lastSuccessAt: source.lastSuccessAt ?? null,
        };
      },
    }));
    const result = await runRefresh({ loaders, repository: state.repository, now });
    const records = await state.repository.listRecords();
    const cachedNewsSaved = await saveCachedNewsReactions(snapshot, records);
    const sourceStates = buildSourceStates({
      outcomes: result.outcomes,
      records,
      previousStates: state.sourceStates,
      now,
      attemptAt: snapshot.generatedAt,
    }).map((sourceState) => ({
      ...sourceState,
      fromSnapshot: true,
      cacheGeneratedAt: snapshot.generatedAt,
    }));

    await state.repository.saveSourceStates(sourceStates);
    await state.repository.setMeta('lastRefreshAt', now);
    await state.repository.setMeta('cacheGeneratedAt', snapshot.generatedAt);
    if (result.ingestError) toast(`Some data could not be saved: ${result.ingestError}`);

    state.sourceStates = sourceStates;
    state.records = records;
    state.lastRefreshAt = now;
    state.cacheGeneratedAt = snapshot.generatedAt;
    state.cacheStale = snapshot.staleHours > WORLD_CACHE_MAX_AGE_HOURS;
    state.now = Date.now();
    state.newsModel = {
      ...snapshot.newsModel,
      reactionCount: snapshot.newsReactions.length,
      interpretedNow: cachedNewsSaved,
    };
    await state.repository.setMeta('newsModel', state.newsModel);
    state.refreshNote = summarizeRefresh(sourceStates, result, snapshot);

    await reloadSavedState();
    state.mood = computeMood({ reactions: state.reactions, now: state.now });
    state.activeKeys = activeReactionKeys(state.mood);
    state.refreshNote = summarizeRefresh(sourceStates, result, snapshot);
  } catch (error) {
    state.refreshNote = `World cache unavailable: ${error.message}. Saved records and reactions are still shown.`;
    toast('The hourly cache could not be loaded. Saved records are still available.');
  } finally {
    state.busy = false;
    button.disabled = false;
    button.textContent = 'Reload world cache';
    state.nextRefreshAt = Date.now() + AUTO_REFRESH_MS;
    renderAll();
  }
}

/* ------------------------------------------------------------------ */
/* Boot and events                                                    */
/* ------------------------------------------------------------------ */

async function loadFromStore() {
  const [records, sourceStates, lastRefreshAt, cacheGeneratedAt, newsModel] = await Promise.all([
    state.repository.listRecords(),
    state.repository.listSourceStates(),
    state.repository.getMeta('lastRefreshAt'),
    state.repository.getMeta('cacheGeneratedAt'),
    state.repository.getMeta('newsModel'),
  ]);

  state.records = records;
  state.sourceStates = sourceStates;
  state.lastRefreshAt = lastRefreshAt ?? null;
  state.now = Date.now();
  state.cacheGeneratedAt = cacheGeneratedAt ?? null;
  state.cacheStale = cacheGeneratedAt
    ? state.now - cacheGeneratedAt > WORLD_CACHE_MAX_AGE_HOURS * HOUR_MS
    : false;
  state.newsModel = newsModel ?? null;
  await reloadSavedState();
  state.mood = computeMood({ reactions: state.reactions, now: state.now });
  state.activeKeys = activeReactionKeys(state.mood);

}

function applyMotionPreference() {
  const systemReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const reduced = state.settings.motion === 'reduced' || systemReduced;
  document.documentElement.dataset.motion = reduced ? 'reduced' : 'auto';
  const toggle = $('motion-toggle');
  toggle.textContent = state.settings.motion === 'reduced' ? 'Motion off' : 'Reduce motion';
  toggle.setAttribute('aria-pressed', String(reduced));
}

function setupExploreFilters() {
  $('explore-filters').innerHTML = EXPLORE_FILTERS.map(
    (filter) =>
      `<button type="button" class="filter-chip" data-filter="${escapeHtml(filter.id)}" aria-pressed="${
        filter.id === state.exploreFilter
      }">${escapeHtml(filter.label)}</button>`,
  ).join('');
}

function wireEvents() {
  $('refresh-button').addEventListener('click', () => refresh({ auto: false }));

  $('motion-toggle').addEventListener('click', () => {
    state.settings = {
      ...state.settings,
      motion: state.settings.motion === 'reduced' ? 'auto' : 'reduced',
    };
    saveSettings(state.settings);
    applyMotionPreference();
    toast(state.settings.motion === 'reduced' ? 'Animation reduced.' : 'Animation follows your system setting.');
  });

  $('explore-filters').addEventListener('click', (event) => {
    const button = event.target.closest('[data-filter]');
    if (!button) return;
    state.exploreFilter = button.dataset.filter;
    state.exploreLimit = RECORD_PAGE_SIZE;
    renderExplorePressed();
    renderExploreList();
  });

  $('active-only').addEventListener('change', (event) => {
    state.exploreActiveOnly = event.target.checked;
    state.exploreLimit = RECORD_PAGE_SIZE;
    renderExploreList();
  });

  $('show-more').addEventListener('click', () => {
    state.exploreLimit += RECORD_PAGE_SIZE;
    renderExploreList();
  });

  $('scenario-chips').addEventListener('click', (event) => {
    const button = event.target.closest('[data-scenario]');
    if (!button) return;
    state.previewId = button.dataset.scenario;
    renderPreview();
  });

  $('explore-panel').addEventListener('toggle', () => {
    if ($('explore-panel').open) {
      state.now = Date.now();
      renderExploreList();
    }
  });

  $('breakdown-panel').addEventListener('toggle', () => {
    if ($('breakdown-panel').open) {
      state.now = Date.now();
      renderBreakdown();
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    state.now = Date.now();
    state.mood = computeMood({ reactions: state.reactions, now: state.now });
    state.activeKeys = activeReactionKeys(state.mood);
    renderMood();
    renderNextRefresh();
    if (state.nextRefreshAt && state.now >= state.nextRefreshAt) refresh({ auto: true });
  });
}

function tick() {
  state.now = Date.now();
  state.mood = computeMood({ reactions: state.reactions, now: state.now });
  const nextKeys = activeReactionKeys(state.mood);
  const changed =
    nextKeys.size !== state.activeKeys.size || [...nextKeys].some((key) => !state.activeKeys.has(key));
  state.activeKeys = nextKeys;

  renderMood();
  renderNextRefresh();

  if (changed) {
    renderBreakdown();
    if ($('explore-panel').open) renderExploreList();
  }

  if (!state.busy && !document.hidden && state.nextRefreshAt && state.now >= state.nextRefreshAt) {
    refresh({ auto: true });
  }
}

async function boot() {
  const store = await openMurmurStore();
  state.storeKind = store?.kind ?? 'memory';
  state.repository = createRepository(store ?? createMemoryStore());

  applyMotionPreference();
  setupExploreFilters();
  wireEvents();
  await loadFromStore();
  renderAll();

  state.nextRefreshAt = Date.now() + AUTO_REFRESH_MS;

  if (!state.lastRefreshAt || Date.now() - state.lastRefreshAt > 5 * 60_000) {
    refresh({ auto: false });
  }

  setInterval(tick, TICK_MS);

  // A quiet reminder of where the clock is set.
  document.documentElement.lang = 'en';
  if (!state.records.length && state.storeKind === 'memory') {
    $('availability-note').textContent =
      'IndexedDB is unavailable, so saved moods will not survive a reload.';
  }
  setText('face-caption', LOCATION.name);
}

boot().catch((error) => {
  console.error(error);
  const status = $('refresh-status');
  if (status) {
    status.dataset.tone = 'warn';
    status.textContent = `Murmur could not start: ${error.message}`;
  }
});
