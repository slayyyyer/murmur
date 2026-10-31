import {
  AUTO_REFRESH_MS,
  LLM_DEFAULTS,
  LOCATION,
  MOOD_COPY,
  NEWS_BATCHES_PER_REFRESH,
  NEWS_BATCH_SIZE,
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
import { checkModelConnection, interpretNewsBatch, normalizeEndpoint } from './ai/newsInterpretation.js';
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
  interpretation: {
    configured: false,
    available: false,
    interpreted: 0,
    rejected: 0,
    error: null,
    note: 'No local model is configured.',
    at: null,
  },
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
  attemptedNews: new Set(),
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

function interpretationForDisplay() {
  if (!state.settings.llm.enabled) {
    return {
      configured: false,
      available: false,
      interpreted: 0,
      error: null,
      note: 'News interpretation is off. Headlines stay browsable but do not affect mood.',
    };
  }
  return { ...state.interpretation, configured: true };
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
    interpretation: interpretationForDisplay(),
    limit: state.exploreLimit,
  });

  $('show-more').hidden = rows.length <= state.exploreLimit;
}

function renderBreakdown() {
  $('breakdown-body').innerHTML = breakdownMarkup({
    mood: state.mood,
    sourceStates: state.sourceStates,
    settings: state.settings,
    interpretation: interpretationForDisplay(),
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
  if (!state.settings.llm.enabled) {
    pill.dataset.state = 'off';
    pill.textContent = 'News model: off';
    return;
  }
  if (state.interpretation.available) {
    pill.dataset.state = 'on';
    pill.textContent = `News model: ${state.settings.llm.model}`;
    return;
  }
  pill.dataset.state = 'error';
  pill.textContent = 'News model: unavailable';
}

function renderRefreshStatus() {
  const element = $('refresh-status');
  const interpretation = state.interpretation;
  let text = state.refreshNote;
  let tone = '';

  if (!state.settings.llm.enabled) {
    text += ' News interpretation is off; headlines remain browsable.';
  } else if (!interpretation.available) {
    const reason = (interpretation.error || interpretation.note || 'the model has not answered').slice(0, 180);
    text += ` News interpretation is unavailable: ${reason}`;
    tone = 'warn';
  } else if (interpretation.interpreted > 0) {
    text += ` Interpreted ${interpretation.interpreted} new headline${
      interpretation.interpreted === 1 ? '' : 's'
    }.`;
    tone = 'ok';
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
  if (snapshot.staleHours > WORLD_CACHE_MAX_AGE_HOURS) {
    parts.push('stale; GitHub Actions may be delayed or disabled');
  }
  return `${formatClock(Date.now())} · ${parts.join(' · ')}.`;
}

async function interpretPendingNews(now) {
  const llm = state.settings.llm;
  if (!llm.enabled) {
    return {
      configured: false,
      available: false,
      interpreted: 0,
      rejected: 0,
      error: null,
      note: 'News interpretation is off.',
      at: now,
    };
  }

  const storedReactions = await state.repository.listReactions();
  const reacted = new Set(storedReactions.map((reaction) => reaction.recordKey));
  const pending = state.records
    .filter(
      (record) =>
        record.group === 'news' &&
        !reacted.has(record.key) &&
        !state.attemptedNews.has(record.key) &&
        now - record.originalAt <= 48 * HOUR_MS &&
        now - record.originalAt >= -5 * 60_000,
    )
    .sort((a, b) => b.originalAt - a.originalAt)
    .slice(0, NEWS_BATCH_SIZE * NEWS_BATCHES_PER_REFRESH);

  if (!pending.length) {
    return {
      configured: true,
      available: true,
      interpreted: 0,
      rejected: 0,
      error: null,
      note: 'No new eligible headlines needed interpretation.',
      at: now,
    };
  }

  let interpreted = 0;
  let rejected = 0;

  for (let index = 0; index < pending.length; index += NEWS_BATCH_SIZE) {
    const batch = pending.slice(index, index + NEWS_BATCH_SIZE);
    for (const record of batch) state.attemptedNews.add(record.key);

    const result = await interpretNewsBatch({
      endpoint: llm.endpoint,
      model: llm.model,
      records: batch,
      fetchImpl: window.fetch.bind(window),
    });

    if (!result.ok) {
      return {
        configured: true,
        available: false,
        interpreted,
        rejected,
        error: result.error,
        note: 'The local model did not provide usable reactions.',
        at: now,
      };
    }

    for (const interpretation of result.reactions) {
      const record = batch.find((entry) => entry.key === interpretation.sourceId);
      if (!record) continue;
      const reaction = createReaction(record, interpretation, { now });
      if (!reaction) continue;
      const saved = await state.repository.saveReactionIfAbsent(reaction);
      if (saved.saved) interpreted += 1;
    }
    rejected += result.rejected?.length ?? 0;
  }

  return {
    configured: true,
    available: true,
    interpreted,
    rejected,
    error: null,
    note: interpreted ? `Interpreted ${interpreted} new headline(s).` : 'The model returned no usable reactions.',
    at: now,
  };
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
        };
      },
    }));
    const result = await runRefresh({ loaders, repository: state.repository, now });
    const records = await state.repository.listRecords();
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
    state.refreshNote = summarizeRefresh(sourceStates, result, snapshot);

    const interpretation = await interpretPendingNews(state.now);
    state.interpretation = interpretation;
    await state.repository.setMeta('interpretation', interpretation);

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
  const [records, sourceStates, lastRefreshAt, cacheGeneratedAt, savedInterpretation] = await Promise.all([
    state.repository.listRecords(),
    state.repository.listSourceStates(),
    state.repository.getMeta('lastRefreshAt'),
    state.repository.getMeta('cacheGeneratedAt'),
    state.repository.getMeta('interpretation'),
  ]);

  state.records = records;
  state.sourceStates = sourceStates;
  state.lastRefreshAt = lastRefreshAt ?? null;
  state.now = Date.now();
  state.cacheGeneratedAt = cacheGeneratedAt ?? null;
  state.cacheStale = cacheGeneratedAt
    ? state.now - cacheGeneratedAt > WORLD_CACHE_MAX_AGE_HOURS * HOUR_MS
    : false;
  await reloadSavedState();
  state.mood = computeMood({ reactions: state.reactions, now: state.now });
  state.activeKeys = activeReactionKeys(state.mood);

  if (state.settings.llm.enabled) {
    state.interpretation = savedInterpretation
      ? { ...savedInterpretation, configured: true, available: false }
      : {
          configured: true,
          available: false,
          interpreted: 0,
          rejected: 0,
          error: 'No interpretation attempt this session yet.',
          at: null,
        };
  }
}

function populateSettingsForm() {
  $('llm-endpoint').value = state.settings.llm.endpoint;
  $('llm-model').value = state.settings.llm.model;
  $('llm-enabled').checked = state.settings.llm.enabled;
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

  const dialog = $('settings-dialog');
  $('settings-open').addEventListener('click', () => {
    populateSettingsForm();
    $('llm-test-result').textContent = '';
    delete $('llm-test-result').dataset.tone;
    if (!dialog.open) dialog.showModal();
    $('llm-endpoint').focus();
  });

  $('settings-close').addEventListener('click', () => dialog.close());

  $('llm-test').addEventListener('click', async () => {
    const status = $('llm-test-result');
    status.textContent = 'Checking the endpoint…';
    delete status.dataset.tone;
    const result = await checkModelConnection({
      endpoint: $('llm-endpoint').value,
      fetchImpl: window.fetch.bind(window),
    });
    if (result.ok) {
      status.dataset.tone = 'ok';
      status.textContent = `Connected. ${result.models.length} model${
        result.models.length === 1 ? '' : 's'
      } available${result.models.length ? `: ${result.models.slice(0, 6).join(', ')}` : ''}.`;
    } else {
      status.dataset.tone = 'bad';
      status.textContent = result.error;
    }
  });

  $('settings-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const status = $('llm-test-result');
    const endpoint = normalizeEndpoint($('llm-endpoint').value);
    const model = $('llm-model').value.trim().slice(0, 80) || LLM_DEFAULTS.model;

    if (!endpoint) {
      status.dataset.tone = 'bad';
      status.textContent = 'Enter a valid HTTP(S) endpoint, for example http://localhost:11434.';
      $('llm-endpoint').focus();
      return;
    }

    state.settings = {
      ...state.settings,
      llm: { enabled: $('llm-enabled').checked, endpoint, model },
    };
    saveSettings(state.settings);
    state.interpretation = {
      configured: state.settings.llm.enabled,
      available: false,
      interpreted: 0,
      rejected: 0,
      error: null,
      note: state.settings.llm.enabled
        ? 'Refresh to attempt news interpretation with the saved model.'
        : 'No local model is configured.',
      at: null,
    };
    if (dialog.open) dialog.close();
    renderModelPill();
    renderRefreshStatus();
    renderBreakdown();
    toast(
      state.settings.llm.enabled
        ? 'Model settings saved. Refresh the world to interpret pending headlines.'
        : 'Model off. News will stay collected but uninterpreted.',
    );
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
  populateSettingsForm();
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
