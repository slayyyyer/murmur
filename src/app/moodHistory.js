import { LOCATION, MOODS, NEWS_TOPIC_IDS } from '../config.js';
import { DAY_MS, HOUR_MS } from '../lib/time.js';
import { fetchJson } from '../sources/http.js';

export const MOOD_HISTORY_SCHEMA_VERSION = 1;
export const MOOD_HISTORY_RETENTION_DAYS = 365;
export const MOOD_HISTORY_RECENT_DAYS = 30;

const GROUP_KEYS = Object.freeze([
  'news',
  'weather',
  'alerts',
  'air',
  'water',
  'wildlife',
  'earthquake',
  'eonet',
]);
const MOOD_SET = new Set(MOODS);
const TOPIC_SET = new Set(NEWS_TOPIC_IDS);
const MONTH_PATTERN = /^\d{4}-\d{2}$/;

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function round(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.round(number * 1_000_000) / 1_000_000;
}

function boundedScore(value) {
  return round(Math.min(1, Math.max(0, Number(value) || 0)));
}

function nonNegativeInteger(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.trunc(number));
}

function normalizeGroupScores(raw) {
  const source = isObject(raw) ? raw : {};
  return Object.fromEntries(GROUP_KEYS.map((group) => [group, boundedScore(source[group])]));
}

function normalizeMoodScores(raw) {
  const source = isObject(raw) ? raw : {};
  return Object.fromEntries(MOODS.map((mood) => [mood, boundedScore(source[mood])]));
}

function normalizeTopicCounts(raw) {
  const source = isObject(raw) ? raw : {};
  return Object.fromEntries(
    [...TOPIC_SET]
      .map((topic) => [topic, nonNegativeInteger(source[topic])])
      .filter(([, count]) => count > 0),
  );
}

/** Calendar month in Charlotte, using the same timezone as the rest of the UI. */
export function moodMonthKey(timestamp) {
  const date = new Date(Number(timestamp));
  if (!Number.isFinite(date.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: LOCATION.timezone,
      year: 'numeric',
      month: '2-digit',
    }).formatToParts(date);
    const year = parts.find((part) => part.type === 'year')?.value;
    const month = parts.find((part) => part.type === 'month')?.value;
    return year && month ? `${year}-${month}` : null;
  } catch {
    return date.toISOString().slice(0, 7);
  }
}

/** Reduce a full computed mood to the small point stored in the public history. */
export function createMoodPoint(mood, { at = mood?.generatedAt } = {}) {
  const timestamp = Number(at);
  if (!mood || !Number.isFinite(timestamp) || !MOOD_SET.has(mood.mood)) return null;

  const groups = Object.fromEntries(GROUP_KEYS.map((group) => [group, 0]));
  for (const item of Array.isArray(mood.groups) ? mood.groups : []) {
    if (GROUP_KEYS.includes(item?.group)) groups[item.group] = boundedScore(item.used);
  }

  const scores = Object.fromEntries(MOODS.map((key) => [key, 0]));
  for (const key of MOODS) scores[key] = boundedScore(mood.byMood?.[key]?.score);

  const topicCounts = {};
  for (const topic of Array.isArray(mood.newsTopics) ? mood.newsTopics : []) {
    if (TOPIC_SET.has(topic?.id) && Array.isArray(topic.slots) && topic.slots.length) {
      topicCounts[topic.id] = nonNegativeInteger(topic.slots.length);
    }
  }

  return {
    at: Math.trunc(timestamp),
    mood: mood.mood,
    topEmotion: MOOD_SET.has(mood.topEmotion) ? mood.topEmotion : mood.mood,
    score: boundedScore(mood.score),
    isCalm: mood.isCalm === true,
    activeCount: Array.isArray(mood.active) ? mood.active.length : 0,
    groups,
    scores,
    topicCounts,
  };
}

export function normalizeMoodPoint(raw) {
  if (!isObject(raw)) return null;
  const at = Number(raw.at);
  if (!Number.isFinite(at) || at <= 0) return null;
  if (!MOOD_SET.has(raw.mood)) return null;
  const topEmotion = MOOD_SET.has(raw.topEmotion) ? raw.topEmotion : raw.mood;
  const score = Number(raw.score);
  if (!Number.isFinite(score) || score < 0 || score > 1) return null;

  return {
    at: Math.trunc(at),
    mood: raw.mood,
    topEmotion,
    score: round(score),
    isCalm: raw.isCalm === true,
    activeCount: nonNegativeInteger(raw.activeCount),
    groups: normalizeGroupScores(raw.groups),
    scores: normalizeMoodScores(raw.scores),
    topicCounts: normalizeTopicCounts(raw.topicCounts),
  };
}

export function normalizeMoodIndex(raw) {
  if (!isObject(raw) || !Array.isArray(raw.months)) {
    return { schemaVersion: MOOD_HISTORY_SCHEMA_VERSION, updatedAt: null, months: [] };
  }
  const months = [...new Set(raw.months.filter((month) => typeof month === 'string' && MONTH_PATTERN.test(month)))].sort();
  return {
    schemaVersion: MOOD_HISTORY_SCHEMA_VERSION,
    updatedAt: Number.isFinite(Number(raw.updatedAt)) ? Math.trunc(Number(raw.updatedAt)) : null,
    months,
  };
}

export function normalizeMoodMonth(raw, month) {
  if (!MONTH_PATTERN.test(String(month ?? ''))) return null;
  if (!isObject(raw) || (raw.month && raw.month !== month)) return null;

  const map = new Map();
  for (const item of Array.isArray(raw.points) ? raw.points.slice(0, 1_000) : []) {
    const point = normalizeMoodPoint(item);
    if (!point || moodMonthKey(point.at) !== month) continue;
    const hour = Math.floor(point.at / HOUR_MS);
    const current = map.get(hour);
    if (!current || point.at >= current.at) map.set(hour, point);
  }

  const points = [...map.values()].sort((a, b) => a.at - b.at);
  return {
    schemaVersion: MOOD_HISTORY_SCHEMA_VERSION,
    month,
    updatedAt: Number.isFinite(Number(raw.updatedAt)) ? Math.trunc(Number(raw.updatedAt)) : null,
    points,
  };
}

/**
 * Append one point to a month, replacing a same-hour rerun and pruning points
 * beyond the retention window. The month file stays sorted and bounded.
 */
export function mergeMoodMonth(existing, point, { now = point?.at, retentionDays = MOOD_HISTORY_RETENTION_DAYS } = {}) {
  const incoming = normalizeMoodPoint(point);
  if (!incoming) return null;
  const month = moodMonthKey(incoming.at);
  if (!month) return null;

  const map = new Map();
  const previous = Array.isArray(existing?.points) ? existing.points : [];
  for (const item of [...previous, incoming]) {
    const normalized = normalizeMoodPoint(item);
    if (!normalized) continue;
    const hour = Math.floor(normalized.at / HOUR_MS);
    const current = map.get(hour);
    if (!current || normalized.at >= current.at) map.set(hour, normalized);
  }

  const cutoff = Number(now) - Math.max(1, Number(retentionDays) || MOOD_HISTORY_RETENTION_DAYS) * DAY_MS;
  const points = [...map.values()]
    .filter((item) => item.at >= cutoff)
    .sort((a, b) => a.at - b.at);

  return {
    schemaVersion: MOOD_HISTORY_SCHEMA_VERSION,
    month,
    updatedAt: Number.isFinite(Number(now)) ? Math.trunc(Number(now)) : incoming.at,
    points,
  };
}

export function moodHistoryIndex(months, { updatedAt = Date.now() } = {}) {
  const cleaned = [...new Set((months ?? []).filter((month) => typeof month === 'string' && MONTH_PATTERN.test(month)))].sort();
  return {
    schemaVersion: MOOD_HISTORY_SCHEMA_VERSION,
    updatedAt: Number.isFinite(Number(updatedAt)) ? Math.trunc(Number(updatedAt)) : Date.now(),
    months: cleaned,
  };
}

function versionedUrl(url, now) {
  const next = new URL(url);
  next.searchParams.set('v', String(Math.floor(now / (10 * 60 * 1000))));
  return next.href;
}

/**
 * Load only the months that can contribute to the recent chart. A missing
 * month is reported but does not discard the months that did load.
 */
export async function loadMoodHistory({
  indexUrl,
  now = Date.now(),
  days = MOOD_HISTORY_RECENT_DAYS,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!indexUrl) throw new Error('No mood history index URL is configured.');
  const safeDays = Math.max(1, Math.min(365, Math.trunc(Number(days) || MOOD_HISTORY_RECENT_DAYS)));
  const indexResponse = await fetchJson(versionedUrl(indexUrl, now), {
    fetchImpl,
    timeoutMs: 15_000,
    maxBytes: 1_000_000,
  });
  const index = normalizeMoodIndex(indexResponse.data);
  const startMonth = moodMonthKey(now - safeDays * DAY_MS);
  const wanted = index.months.filter((month) => !startMonth || month >= startMonth);

  const settled = await Promise.all(
    wanted.map(async (month) => {
      try {
        const response = await fetchJson(versionedUrl(new URL(`${month}.json`, indexUrl).href, now), {
          fetchImpl,
          timeoutMs: 15_000,
          maxBytes: 2_000_000,
        });
        return normalizeMoodMonth(response.data, month);
      } catch {
        return null;
      }
    }),
  );

  const months = settled.filter(Boolean);
  const cutoff = now - safeDays * DAY_MS;
  const points = months
    .flatMap((month) => month.points)
    .filter((point) => point.at >= cutoff && point.at <= now + 5 * 60 * 1000)
    .sort((a, b) => a.at - b.at);

  return {
    index,
    months: months.map((month) => month.month),
    missing: wanted.filter((month, indexPosition) => !settled[indexPosition]),
    points,
    days: safeDays,
  };
}
