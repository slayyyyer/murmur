import {
  NEWS_TOPIC_IDS,
  SOURCE_DEFS,
  WORLD_CACHE_BUCKET_MS,
  WORLD_CACHE_SCHEMA_VERSION,
  WORLD_CACHE_URL,
} from '../config.js';
import { fetchJson, SourceError } from '../sources/http.js';
import { HOUR_MS } from '../lib/time.js';
import { isPlainObject, safeHttpsUrl, sanitizeText, validTimestamp } from '../lib/validate.js';

const SOURCE_BY_ID = new Map(SOURCE_DEFS.map((source) => [source.id, source]));
const STATUSES = new Set(['live', 'empty', 'malformed', 'unavailable']);
const TOPICS = new Set(NEWS_TOPIC_IDS);
const MAX_SOURCES = 20;
const MAX_RECORDS_PER_SOURCE = 250;
const MAX_DATA_BYTES = 2_000;

function normalizeKey(value) {
  if (typeof value !== 'string') return null;
  const key = value.trim();
  if (!key || key.length > 200 || /[\u0000-\u001F<>]/.test(key)) return null;
  return key;
}

function validateRecord(raw, source, now, fallbackFetchedAt) {
  if (!isPlainObject(raw)) return null;
  const key = normalizeKey(raw.key);
  if (!key || raw.sourceId !== source.id || raw.group !== source.group) return null;

  const title = sanitizeText(raw.title, 240);
  const url = safeHttpsUrl(raw.url);
  const originalAt = validTimestamp(raw.originalAt, { now, requireTimestamp: true });
  if (!title || !url || originalAt === null) return null;

  const data = isPlainObject(raw.data) ? raw.data : {};
  if (source.group === 'news' && !TOPICS.has(data.topic)) return null;

  let dataJson;
  try {
    dataJson = JSON.stringify(data);
  } catch {
    return null;
  }
  if (!dataJson || new TextEncoder().encode(dataJson).byteLength > MAX_DATA_BYTES) return null;

  const observedAt =
    raw.observedAt === null || raw.observedAt === undefined
      ? null
      : validTimestamp(raw.observedAt, { now, requireTimestamp: true });
  if (raw.observedAt !== null && raw.observedAt !== undefined && observedAt === null) return null;

  const updatedAt =
    raw.updatedAt === null || raw.updatedAt === undefined
      ? null
      : validTimestamp(raw.updatedAt, { now, requireTimestamp: true });
  if (raw.updatedAt !== null && raw.updatedAt !== undefined && updatedAt === null) return null;

  const fetchedAt =
    validTimestamp(raw.fetchedAt ?? fallbackFetchedAt, { now, requireTimestamp: true }) ?? fallbackFetchedAt;

  return {
    key,
    group: source.group,
    sourceId: source.id,
    sourceLabel: source.label,
    provider: source.provider,
    title,
    summary: sanitizeText(raw.summary, 400),
    url,
    originalAt,
    observedAt,
    updatedAt,
    fetchedAt,
    dateOnly: raw.dateOnly === true,
    data,
  };
}

/**
 * Validate the whole snapshot before any of it reaches IndexedDB. Invalid
 * records are dropped individually; an invalid envelope is rejected so a
 * damaged cache cannot overwrite a good saved mood.
 */
export function validateWorldCache(payload, { now = Date.now() } = {}) {
  if (!isPlainObject(payload)) {
    throw new SourceError('The world cache is not a JSON object.', 'malformed');
  }
  if (payload.schemaVersion !== WORLD_CACHE_SCHEMA_VERSION) {
    throw new SourceError('The world cache uses an unsupported schema version.', 'malformed');
  }

  const generatedAt = validTimestamp(payload.generatedAt, { now, requireTimestamp: true });
  if (generatedAt === null) {
    throw new SourceError('The world cache has no valid generation time.', 'malformed');
  }
  if (!Array.isArray(payload.sources) || payload.sources.length === 0 || payload.sources.length > MAX_SOURCES) {
    throw new SourceError('The world cache has no usable source list.', 'malformed');
  }

  const seen = new Set();
  const sources = [];
  let invalidRecords = 0;

  for (const rawSource of payload.sources) {
    if (!isPlainObject(rawSource)) {
      throw new SourceError('The world cache contains an invalid source entry.', 'malformed');
    }
    const definition = SOURCE_BY_ID.get(rawSource.sourceId);
    if (!definition) {
      throw new SourceError(`The world cache contains an unknown source (${String(rawSource.sourceId)}).`, 'malformed');
    }
    if (seen.has(definition.id)) {
      throw new SourceError(`The world cache repeats the source ${definition.id}.`, 'malformed');
    }
    seen.add(definition.id);

    const reportedStatus = rawSource.status;
    let status = STATUSES.has(reportedStatus) ? reportedStatus : 'malformed';
    let error = sanitizeText(rawSource.error, 300) || null;
    if (!STATUSES.has(reportedStatus)) error = 'The cache reported an unknown source status.';

    const fetchedAt =
      validTimestamp(rawSource.fetchedAt ?? generatedAt, { now, requireTimestamp: true }) ?? generatedAt;
    const records = [];

    if (Array.isArray(rawSource.records)) {
      for (const rawRecord of rawSource.records.slice(0, MAX_RECORDS_PER_SOURCE)) {
        const record = validateRecord(rawRecord, definition, now, fetchedAt);
        if (record) records.push(record);
        else invalidRecords += 1;
      }
    } else {
      invalidRecords += 1;
    }

    if (status === 'live' && records.length === 0) {
      status = rawSource.records?.length ? 'malformed' : 'empty';
      if (status === 'malformed') error = 'The cached response had no records that passed validation.';
    }

    sources.push({
      sourceId: definition.id,
      label: definition.label,
      provider: definition.provider,
      homepage: definition.homepage,
      group: definition.group,
      status,
      error,
      fetchedAt,
      records,
    });
  }

  return {
    schemaVersion: WORLD_CACHE_SCHEMA_VERSION,
    generatedAt,
    receivedAt: now,
    staleHours: Math.max(0, (now - generatedAt) / HOUR_MS),
    sources,
    invalidRecords,
  };
}

/** A new CDN cache key every ten minutes, matching GitHub Pages' max-age. */
export function cacheRequestUrl(baseUrl, now = Date.now()) {
  const url = new URL(baseUrl);
  url.searchParams.set('v', String(Math.floor(now / WORLD_CACHE_BUCKET_MS)));
  return url.href;
}

export async function loadWorldCache({
  fetchImpl = globalThis.fetch,
  url = WORLD_CACHE_URL,
  now = Date.now(),
} = {}) {
  const response = await fetchJson(cacheRequestUrl(url, now), {
    fetchImpl,
    timeoutMs: 15_000,
    maxBytes: 6 * 1024 * 1024,
  });
  return validateWorldCache(response.data, { now });
}
