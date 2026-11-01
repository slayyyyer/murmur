import {
  BUDGETS,
  CALM_THRESHOLD,
  DECAY,
  GROUP_LABELS,
  MOODS,
  MOOD_COPY,
  NEWS_SLOTS_PER_TOPIC,
  NEWS_TOPICS,
  NEWS_SLOT_WEIGHT,
  PUBLISHER_STORY_LIMIT,
  PUBLISHERS,
  SOURCE_DEFS,
} from '../config.js';
import { formatDateTime, formatPercent, formatRelative, formatStrength } from '../lib/time.js';
import { escapeHtml } from '../lib/validate.js';
import { reactionAnchorAt } from '../mood/engine.js';
import {
  dateSummary,
  kindLabel,
  recordStatus,
  sourceStatusText,
  sourceTone,
  topicLabel,
} from './format.js';

export const EXPLORE_FILTERS = Object.freeze([
  { id: 'all', label: 'All' },
  ...NEWS_TOPICS.map((topic) => ({ id: `topic:${topic.id}`, label: topic.label })),
  { id: 'weather', label: 'Weather' },
  { id: 'alerts', label: 'Alerts' },
  { id: 'air', label: 'Air' },
  { id: 'water', label: 'River' },
  { id: 'earthquake', label: 'Earthquakes' },
  { id: 'wildlife', label: 'Wildlife' },
  { id: 'eonet', label: 'NASA events' },
]);

export function matchesFilter(record, filter) {
  if (filter === 'all') return true;
  if (filter.startsWith('topic:')) {
    return record.group === 'news' && record.data?.topic === filter.slice('topic:'.length);
  }
  return record.group === filter;
}

const SHORT_STATUS = {
  live: 'Live',
  empty: 'Empty',
  cached: 'Cached',
  malformed: 'Malformed',
  unavailable: 'Unavailable',
};

function sourceLink(url, label) {
  if (!url) return '';
  return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(
    label,
  )}<span class="visually-hidden"> (opens in a new tab)</span></a>`;
}

export function conditionMarkup({ kind, record, sourceState, now = Date.now() }) {
  const isWeather = kind === 'weather';
  const heading = isWeather ? 'Charlotte weather' : 'Charlotte air quality';
  const tone = sourceState ? sourceTone(sourceState.status) : 'warn';
  const shortStatus = sourceState
    ? sourceState.fromSnapshot
      ? sourceState.status === 'live'
        ? 'Hourly cache'
        : sourceState.status === 'empty'
          ? 'Cache: empty'
          : SHORT_STATUS[sourceState.status] ?? 'Cache'
      : SHORT_STATUS[sourceState.status] ?? 'Waiting'
    : 'Waiting';
  const cacheMeta = sourceState?.fromSnapshot
    ? ` · hourly cache ${formatRelative(sourceState.cacheGeneratedAt, now)}`
    : '';
  const head = `<div class="condition-head"><h2 id="${kind}-heading">${heading}</h2><span class="source-state" data-tone="${tone}" title="${escapeHtml(
    sourceState?.error ?? '',
  )}">${shortStatus}</span></div>`;

  if (!record) {
    return `${head}
      <div class="condition-main">
        <span class="condition-glyph" aria-hidden="true">◌</span>
        <p class="condition-value">—</p>
        <p class="condition-label">No observation saved yet</p>
      </div>
      <p class="condition-meta">${
        sourceState?.error
          ? escapeHtml(sourceState.error)
          : `Reload the hourly cache to load ${isWeather ? 'Open-Meteo weather' : 'modeled air quality'}. Previously saved observations are kept when a source fails.`
      }</p>`;
  }

  const observedAt = record.observedAt ?? record.originalAt;
  const age = now - Number(observedAt);
  const stale = Number.isFinite(age) && age > 6 * 3_600_000;

  if (isWeather) {
    const data = record.data ?? {};
    const facts = [];
    if (Number.isFinite(data.apparentC)) facts.push(['Feels like', `${Math.round(data.apparentC)}°C`]);
    if (Number.isFinite(data.humidity)) facts.push(['Humidity', `${Math.round(data.humidity)}%`]);
    if (Number.isFinite(data.windKmh)) facts.push(['Wind', `${Math.round(data.windKmh)} km/h`]);
    if (Number.isFinite(data.highC) && Number.isFinite(data.lowC)) {
      facts.push(['Today', `${Math.round(data.lowC)}–${Math.round(data.highC)}°C`]);
    }
    if (Number.isFinite(data.precipitationChance)) {
      facts.push(['Rain chance', `${Math.round(data.precipitationChance)}%`]);
    }

    return `${head}
      <div class="condition-main">
        <span class="condition-glyph" aria-hidden="true">${escapeHtml(data.glyph ?? '◌')}</span>
        <p class="condition-value">${Number.isFinite(data.temperatureC) ? `${Math.round(data.temperatureC)}°C` : '—'}</p>
        <p class="condition-label">${escapeHtml(data.condition ?? 'Conditions unavailable')}</p>
      </div>
      <dl class="condition-facts">${facts
        .map(([label, value]) => `<div><dt>${label}</dt><dd>${escapeHtml(value)}</dd></div>`)
        .join('')}</dl>
      <p class="condition-meta">Observed ${formatDateTime(observedAt)} · ${formatRelative(
        observedAt,
        now,
      )}${stale ? ' · outside the 6-hour mood window' : ''}${cacheMeta} · ${sourceLink(record.url, 'Open-Meteo')}</p>`;
  }

  const data = record.data ?? {};
  const facts = [];
  if (Number.isFinite(data.pm25)) facts.push(['PM2.5', `${data.pm25} µg/m³`]);
  if (Number.isFinite(data.pm10)) facts.push(['PM10', `${data.pm10} µg/m³`]);
  if (Number.isFinite(data.ozone)) facts.push(['Ozone', `${data.ozone} µg/m³`]);

  return `${head}
    <div class="condition-main">
      <span class="condition-glyph" aria-hidden="true">🌬️</span>
      <p class="condition-value">${Number.isFinite(data.usAqi) ? `AQI ${Math.round(data.usAqi)}` : '—'}</p>
      <p class="condition-label">${escapeHtml(data.category ?? 'Modeled air quality')}</p>
    </div>
    <dl class="condition-facts">${facts
      .map(([label, value]) => `<div><dt>${label}</dt><dd>${escapeHtml(value)}</dd></div>`)
      .join('')}</dl>
    <p class="condition-meta">Modeled, not a sensor reading · observed ${formatDateTime(
      observedAt,
    )} · ${formatRelative(observedAt, now)}${stale ? ' · outside the 6-hour mood window' : ''}${cacheMeta} · ${sourceLink(
      record.url,
      'Open-Meteo',
    )}</p>`;
}

export function availabilityMarkup(
  sourceStates,
  {
    now = Date.now(),
    storeKind = 'indexeddb',
    lastRefreshAt = null,
    cacheGeneratedAt = null,
    cacheStale = false,
  } = {},
) {
  const byId = new Map((sourceStates ?? []).map((state) => [state.sourceId, state]));
  const chips = SOURCE_DEFS.map((definition) => {
    const state = byId.get(definition.id);
    const tone = state ? sourceTone(state.status) : 'warn';
    const text = state ? sourceStatusText(state, now) : 'Waiting for the first check';
    return `<li class="source-chip" data-tone="${tone}" title="${escapeHtml(state?.error ?? '')}">
      <strong>${escapeHtml(definition.label)}</strong>
      <span>${escapeHtml(text)}</span>
      ${sourceLink(definition.homepage, 'Source')}
    </li>`;
  }).join('');

  const live = (sourceStates ?? []).filter((state) => state.status === 'live').length;
  const answered = (sourceStates ?? []).filter(
    (state) => state.status === 'live' || state.status === 'empty',
  ).length;
  const cacheTime = cacheGeneratedAt
    ? `hourly cache generated ${formatRelative(cacheGeneratedAt, now)}`
    : lastRefreshAt
      ? `cache loaded ${formatRelative(lastRefreshAt, now)}`
      : 'no cache time';
  const note = sourceStates?.length
    ? `${answered} of ${SOURCE_DEFS.length} sources answered (${live} live) · ${cacheTime}${
        cacheStale ? ' · stale' : ''
      } · ${storeKind === 'indexeddb' ? 'saved in IndexedDB' : 'temporary memory only'}`
    : `No hourly cache loaded yet · ${storeKind === 'indexeddb' ? 'IndexedDB ready' : 'IndexedDB unavailable, using memory'}`;

  return { chips, note };
}

export function scenarioChipsMarkup(scenarios, selectedId) {
  return scenarios
    .map(
      (scenario) => `<button type="button" class="scenario-chip" data-scenario="${escapeHtml(
        scenario.id,
      )}" aria-pressed="${scenario.id === selectedId}">${escapeHtml(scenario.title)}</button>`,
    )
    .join('');
}

function recordMarkup({ record, reaction, active, contribution, ignoredReason, now, newsModel }) {
  const kind = kindLabel(record.group);
  const status = recordStatus({ record, reaction, active, ignoredReason, now, newsModel });
  const summary = record.summary ? `<p class="record-summary">${escapeHtml(record.summary)}</p>` : '';
  const topic = record.group === 'news' ? `<span>${escapeHtml(topicLabel(record.data?.topic))}</span>` : '';
  const dates = dateSummary(record)
    .map((line) => `<span>${escapeHtml(line)}</span>`)
    .join('');
  const provider = record.provider ? ` · ${record.provider}` : '';

  const reactionLine = reaction
    ? `<p class="record-reaction">${escapeHtml(reaction.text)}<br /><span class="strength">Saved reaction — ${
        escapeHtml(MOOD_COPY[reaction.mood]?.label ?? reaction.mood)
      } · intensity ${Number(reaction.intensity).toFixed(2)}${
        Number.isFinite(contribution)
          ? ` · contributing ${formatStrength(contribution)} now`
          : ' · not currently contributing'
      }</span></p>`
    : '';

  return `<li class="record" data-active="${active}">
    <div class="record-head">
      <span class="badge badge-kind" data-kind="${kind.kind}">${kind.label}</span>
      <span class="badge">${escapeHtml(record.sourceLabel ?? record.sourceId)}</span>
      <span class="badge badge-status" data-tone="${status.tone}"${
        status.detail ? ` title="${escapeHtml(status.detail)}"` : ''
      }>${escapeHtml(status.label)}</span>
    </div>
    <h3><a href="${escapeHtml(record.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(
      record.title,
    )}<span class="visually-hidden"> (opens in a new tab)</span></a></h3>
    ${summary}
    <div class="record-meta">
      <span>${escapeHtml(record.sourceLabel ?? record.sourceId)}${escapeHtml(provider)}</span>
      ${topic}
      ${dates}
    </div>
    ${reactionLine}
  </li>`;
}

export function recordListMarkup({
  records,
  reactionsByKey,
  activeKeys,
  contributionByKey,
  ignoredReasons,
  now,
  newsModel,
  limit,
}) {
  const shown = records.slice(0, limit);
  if (!shown.length) {
    return `<li class="empty-state">Nothing has been recorded for this filter yet. Refresh the world, or choose another category.</li>`;
  }

  return shown
    .map((record) => {
      const reaction = reactionsByKey.get(record.key) ?? null;
      const active = Boolean(reaction && activeKeys.has(reaction.key));
      return recordMarkup({
        record,
        reaction,
        active,
        contribution: reaction ? contributionByKey.get(reaction.key) : undefined,
        ignoredReason: reaction ? ignoredReasons.get(reaction.key) : null,
        now,
        newsModel,
      });
    })
    .join('');
}

export function exploreSummary({ total, activeCount, shown, filterLabel, activeOnly }) {
  if (!total) return `No records match ${activeOnly ? 'active reactions' : filterLabel}.`;
  return `${total} record${total === 1 ? '' : 's'} in ${filterLabel}${
    activeOnly ? ' with an active reaction' : ''
  } · ${activeCount} active reaction${activeCount === 1 ? '' : 's'} across all records · showing ${Math.min(
    shown,
    total,
  )}`;
}

function newsModelNotice(newsModel) {
  if (!newsModel) {
    return `<div class="notice"><strong>News mood has not loaded.</strong> The hourly cache has not provided a news-model status yet.</div>`;
  }
  if (newsModel.error) {
    return `<div class="notice" data-tone="bad"><strong>News mood is unavailable.</strong> ${escapeHtml(
      newsModel.error,
    )}${newsModel.reactionCount ? ` ${newsModel.reactionCount} cached reaction(s) from earlier builds remain.` : ''} Headlines stay browsable but do not affect the mood until the model succeeds.</div>`;
  }
  if (newsModel.reactionCount > 0) {
    return `<div class="notice" data-tone="ok"><strong>News mood is generated at build time.</strong> ${escapeHtml(
      newsModel.model,
    )} produced ${newsModel.reactionCount} cached reaction${
      newsModel.reactionCount === 1 ? '' : 's'
    }${newsModel.configured ? '' : ' in an earlier build'}. They age from their original interpretation time, not from when you loaded the page.</div>`;
  }
  if (newsModel.configured) {
    return `<div class="notice" data-tone="warn"><strong>The news model ran but returned no usable reactions.</strong> The hourly build still deployed the measured sources; news stays browsable without affecting the mood.</div>`;
  }
  return `<div class="notice"><strong>News mood is not generated.</strong> No model key was configured for the hourly cache, so headlines are collected and browsable but do not affect the mood. Weather, alerts, air quality, river level, wildlife, earthquakes, and NASA events keep working.</div>`;
}

function emotionRows(mood) {
  return MOODS.map((moodId) => {
    const bucket = mood.byMood[moodId];
    const support = bucket.supports.length
      ? `<ul class="support-list">${bucket.supports
          .map(
            (entry) => `<li>${sourceLink(entry.reaction.url, entry.reaction.title)} — ${escapeHtml(
              entry.reaction.publisherLabel ?? entry.reaction.sourceLabel ?? 'source',
            )} · <span class="strength">${formatStrength(entry.contribution)} now · intensity ${Number(
              entry.reaction.intensity,
            ).toFixed(2)} · ${formatRelative(reactionAnchorAt(entry.reaction), mood.generatedAt)}</span></li>`,
          )
          .join('')}</ul>`
      : `<p class="muted">No active contributions.</p>`;

    return `<div class="emotion-row" data-mood="${moodId}">
      <div class="emotion-head"><strong>${MOOD_COPY[moodId].label}</strong><span class="emotion-score">${bucket.score.toFixed(
        3,
      )}</span></div>
      <div class="meter"><span style="width:${Math.min(100, bucket.score * 100).toFixed(1)}%"></span></div>
      ${support}
    </div>`;
  }).join('');
}

function budgetTable(mood) {
  return `<div class="table-wrap"><table class="budget-table">
    <thead><tr><th scope="col">Source group</th><th scope="col">Max</th><th scope="col">Active</th><th scope="col">Strength now</th><th scope="col">Budget used</th></tr></thead>
    <tbody>${mood.groups
      .map((group) => {
        const share = group.budget > 0 ? group.used / group.budget : 0;
        const slotText =
          group.group === 'news'
            ? `${group.activeCount} / ${NEWS_TOPICS.length * NEWS_SLOTS_PER_TOPIC} slots`
            : `${group.activeCount} / 1 slot`;
        return `<tr>
          <th scope="row">${escapeHtml(group.label)}</th>
          <td class="num">${formatPercent(group.budget)}</td>
          <td class="num">${slotText}</td>
          <td class="num">${formatStrength(group.used)}</td>
          <td class="num">${formatPercent(share)}</td>
        </tr>`;
      })
      .join('')}</tbody>
  </table></div>`;
}

function slotGrid(mood) {
  return `<div class="slot-grid">${mood.newsTopics
    .map(
      (topic) => `<div class="slot-topic"><strong>${escapeHtml(topic.label)}</strong>${
        topic.slots.length
          ? topic.slots
              .map(
                (slot) =>
                  `<span>${escapeHtml(slot.reaction.title)} <em>· ${formatStrength(slot.contribution)}</em></span>`,
              )
              .join('')
          : '<span class="muted">Empty</span>'
      }</div>`,
    )
    .join('')}</div>`;
}

function publisherList(mood) {
  const entries = Object.entries(mood.publisherCounts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (!entries.length) return `<p class="muted">No publisher has an active news story right now.</p>`;
  return `<ul class="support-list">${entries
    .map(
      ([id, count]) =>
        `<li>${escapeHtml(PUBLISHERS[id]?.label ?? id)} — ${count} active of a maximum ${PUBLISHER_STORY_LIMIT}</li>`,
    )
    .join('')}</ul>`;
}

function sourceTable(sourceStates, now) {
  if (!sourceStates?.length) return `<p class="muted">No source check has run this session.</p>`;
  return `<div class="table-wrap"><table class="source-table">
    <thead><tr><th scope="col">Source</th><th scope="col">Status</th><th scope="col">Records</th><th scope="col">Last success</th></tr></thead>
    <tbody>${sourceStates
      .map(
        (state) => `<tr>
        <th scope="row">${escapeHtml(state.label)}<br /><span class="muted">${escapeHtml(state.provider ?? '')}</span></th>
        <td>${escapeHtml(sourceStatusText(state, now))}${
          state.error ? `<br /><span class="muted">${escapeHtml(state.error)}</span>` : ''
        }</td>
        <td class="num">${state.recordCount ?? 0}</td>
        <td class="num">${state.lastSuccessAt ? formatRelative(state.lastSuccessAt, now) : 'never'}</td>
      </tr>`,
      )
      .join('')}</tbody>
  </table></div>`;
}

function cacheNotice({ cacheGeneratedAt, cacheStale, now }) {
  if (!cacheGeneratedAt) {
    return `<div class="notice" data-tone="bad"><strong>No hourly cache loaded.</strong> Murmur could not read the static snapshot published by GitHub Actions. Previously saved records are still shown.</div>`;
  }
  return `<div class="notice" data-tone="${cacheStale ? 'bad' : 'ok'}"><strong>Hourly snapshot.</strong> GitHub Actions generated this world cache ${escapeHtml(
    formatRelative(cacheGeneratedAt, now),
  )}. The browser ingests that snapshot; it never contacts feeds directly.${
    cacheStale ? ' The cache is older than two hours, so GitHub Actions may be delayed or disabled.' : ''
  }</div>`;
}

function methodList() {
  const newsSlots = NEWS_TOPICS.length * NEWS_SLOTS_PER_TOPIC;
  return `<ul class="method-list">
    <li>Every reaction contributes <strong>intensity × slot weight × 2<sup>−age ÷ half-life</sup></strong>. The strongest aggregate emotion sets the face; below ${CALM_THRESHOLD.toFixed(
      2,
    )}, the face is calm.</li>
    <li>World data is fetched hourly by GitHub Actions through the local allowlist relay and published as one static cache. The browser only reads that same-origin snapshot; it never contacts a feed directly.</li>
    <li>News gets ${formatPercent(BUDGETS.news)} across ${newsSlots} slots — ${NEWS_SLOTS_PER_TOPIC} per topic, each worth ${formatPercent(
      NEWS_SLOT_WEIGHT,
      1,
    )}. A publisher may hold at most ${PUBLISHER_STORY_LIMIT} active stories.</li>
    <li>Weather ${formatPercent(BUDGETS.weather)}, weather alerts ${formatPercent(BUDGETS.alerts, 1)}, air quality ${formatPercent(
      BUDGETS.air,
    )}, river level ${formatPercent(BUDGETS.water)}, wildlife ${formatPercent(BUDGETS.wildlife)}, earthquakes ${formatPercent(
      BUDGETS.earthquake,
      1,
    )}, NASA events ${formatPercent(BUDGETS.eonet, 1)}. Unused shares are never redistributed.</li>
    <li>News decays from its first interpretation and is also expired 48 hours after publication. Other inputs decay from their own observation time.</li>
    <li>Weather: ${DECAY.weather.halfLifeHours}-hour half-life, ${DECAY.weather.maxAgeHours}-hour expiry. Alerts: ${DECAY.alerts.halfLifeHours}-hour half-life, ${DECAY.alerts.maxAgeHours}-hour expiry or the official expiry, whichever is sooner. Air: ${DECAY.air.halfLifeHours}-hour half-life, ${DECAY.air.maxAgeHours}-hour expiry. River: ${DECAY.water.halfLifeHours}-hour half-life, ${DECAY.water.maxAgeHours}-hour expiry. Earthquakes: ${DECAY.earthquake.halfLifeHours}-hour half-life, ${DECAY.earthquake.maxAgeHours}-hour expiry. Wildlife and NASA events: ${DECAY.wildlife.halfLifeHours}-hour half-life, 7-day expiry.</li>
    <li>Only the newest eligible wildlife observation, newest eligible NASA event, strongest current earthquake, strongest active alert, and newest river reading can contribute. Older records stay browsable.</li>
    <li>Reactions are saved once. Reloading, polling, or seeing the same evidence again never resets its age or increases its strength. Repeat nature IDs keep their earliest known original date.</li>
    <li>Weather, alerts, air, river level, wildlife, earthquakes, and NASA listings use transparent local rules. News is interpreted during the hourly build by an external model; without a model key, news is browsable but never invents a reaction.</li>
  </ul>`;
}

export function breakdownMarkup({
  mood,
  sourceStates,
  newsModel,
  now,
  storeKind,
  cacheGeneratedAt = null,
  cacheStale = false,
}) {
  return `${cacheNotice({ cacheGeneratedAt, cacheStale, now })}${newsModelNotice(newsModel)}
    <div class="breakdown-grid">
      <section class="breakdown-block" aria-labelledby="emotion-heading">
        <h3 id="emotion-heading">Emotion ledger</h3>
        <p>Current strength of each simulated emotion, with the records supporting it.</p>
        ${emotionRows(mood)}
      </section>
      <section class="breakdown-block" aria-labelledby="budget-heading">
        <h3 id="budget-heading">Influence budgets</h3>
        <p>Maximum share, active slots, and the strength actually used right now.</p>
        ${budgetTable(mood)}
        <p class="fine-print">Strength is a decayed share of the total possible influence (1.000). Maximum inputs can add up to exactly 1.000; missing inputs simply leave their share unused.</p>
      </section>
      <section class="breakdown-block" aria-labelledby="slots-heading">
        <h3 id="slots-heading">News slots</h3>
        <p>Two active stories per topic, evenly sharing the ${formatPercent(BUDGETS.news)} news budget.</p>
        ${slotGrid(mood)}
        <h4 class="minor-heading">Publisher limit</h4>
        ${publisherList(mood)}
      </section>
      <section class="breakdown-block" aria-labelledby="model-heading">
        <h3 id="model-heading">News model and storage</h3>
        <p>How headline reactions are produced, and where the saved state lives.</p>
        <ul class="method-list">
          <li>News model: ${
            newsModel?.model && newsModel.model !== 'No model'
              ? `<strong>${escapeHtml(newsModel.model)}</strong> via ${escapeHtml(newsModel.provider ?? 'build-time provider')}`
              : '<strong>not configured</strong>'
          }${newsModel?.generatedAt ? ` · model cache time ${formatRelative(newsModel.generatedAt, now)}` : ''}.</li>
          <li>The model runs in GitHub Actions during the cache build. Its API key is never sent to the browser; the browser ingests only validated mood, intensity, and text.</li>
          <li>Model output must use a provided story ID, a valid mood (happy, hopeful, sad, uneasy, mad, confused), intensity from 0 to 1, and a short text without URLs, numbers, quotes, or unsupported claims. “Frustrated” is the displayed label for the stored `mad` mood. Anything else is rejected.</li>
          <li>Headlines are treated as untrusted data. The model is told not to follow instructions inside them and not to invent article details.</li>
          <li>Storage: the latest hourly snapshot is ingested into ${storeKind === 'indexeddb' ? 'IndexedDB in this browser' : 'temporary memory (IndexedDB unavailable)'}. Observations and saved reactions survive reloads when IndexedDB is available; re-ingesting the same snapshot does not strengthen them.</li>
          <li>Wildlife records store taxon names, a coarse distance, and the observation link — never observer identities, photos, place guesses, or precise coordinates.</li>
        </ul>
      </section>
    </div>
    <section class="breakdown-block" style="margin-top: 20px" aria-labelledby="sources-table-heading">
      <h3 id="sources-table-heading">Source ledger</h3>
      <p>Status, retained records, and last good response for every source.</p>
      ${sourceTable(sourceStates, now)}
    </section>
    <section class="breakdown-block" style="margin-top: 20px" aria-labelledby="method-heading">
      <h3 id="method-heading">Calculation and limits</h3>
      <p>The whole mood engine runs locally. There is no hidden sentiment analysis or server-side scoring.</p>
      ${methodList()}
      <p class="fine-print">Murmur's mood is a simulation with a clock, not a feeling, a measurement of public opinion, or a factual summary of the world.</p>
    </section>`;
}
