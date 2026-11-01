import { DECAY, WORLD_CACHE_SCHEMA_VERSION } from '../config.js';
import { HOUR_MS } from '../lib/time.js';
import { dedupeRecords } from '../lib/dedupe.js';
import { readFiniteNumber, sanitizeText } from '../lib/validate.js';
import { validateCachedNewsReactions } from '../ai/newsInterpretation.js';
import { validateWorldCache } from './worldCache.js';

const NEWS_FUTURE_MS = 5 * 60_000;
const DEFAULT_MAX_SOURCE_RECORDS = 250;

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function attemptTime(value, fallback) {
  const parsed = readFiniteNumber(value);
  return parsed === null ? fallback : parsed;
}

/** A record is publishable history only while its own decay window is open. */
export function recordIsRetained(record, now = Date.now()) {
  const config = DECAY[record?.group];
  if (!config) return true;
  const anchor = finite(record.observedAt) ? record.observedAt : record.originalAt;
  if (!finite(anchor) || anchor > now + NEWS_FUTURE_MS) return false;
  if (now - anchor > config.maxAgeHours * HOUR_MS) return false;
  if (
    record.group === 'alerts' &&
    finite(record.data?.expiresAt) &&
    record.data.expiresAt <= now
  ) {
    return false;
  }
  return true;
}

function previousSnapshot(raw, now) {
  if (!raw) return null;
  try {
    return validateWorldCache(raw, { now });
  } catch {
    return null;
  }
}

function sourceHasFailure(outcome) {
  if (outcome.status === 'malformed' || outcome.status === 'unavailable') return true;
  return Boolean(
    Array.isArray(outcome.detail?.feeds) &&
      outcome.detail.feeds.some((feed) => feed.status === 'malformed' || feed.status === 'unavailable'),
  );
}

/**
 * Build the source list and decide which previous records are safe to retain.
 * A failed source keeps validated history, but its failure status and error
 * remain visible. A genuinely empty successful response keeps its empty state
 * and does not masquerade as cached data.
 */
export function prepareBuild({
  outcomes = [],
  records = [],
  previous = null,
  now = Date.now(),
  maxSourceRecords = DEFAULT_MAX_SOURCE_RECORDS,
} = {}) {
  const previousCache = previousSnapshot(previous, now);
  const previousById = new Map((previousCache?.sources ?? []).map((source) => [source.sourceId, source]));

  const currentBySource = new Map();
  for (const record of records) {
    if (!record?.sourceId) continue;
    if (!currentBySource.has(record.sourceId)) currentBySource.set(record.sourceId, []);
    currentBySource.get(record.sourceId).push(record);
  }
  for (const outcome of outcomes) {
    if (!currentBySource.has(outcome.sourceId)) {
      currentBySource.set(outcome.sourceId, Array.isArray(outcome.records) ? outcome.records : []);
    }
  }

  const metadata = [];
  const candidateRecords = [];
  for (const outcome of outcomes) {
    const current = currentBySource.get(outcome.sourceId) ?? [];
    const previousSource = previousById.get(outcome.sourceId) ?? null;
    const retainPrevious = sourceHasFailure(outcome);
    const retained = retainPrevious
      ? (previousSource?.records ?? []).filter((record) => recordIsRetained(record, now))
      : [];
    const currentKeys = new Set(current.map((record) => record.key));
    const combined = dedupeRecords([...current, ...retained]).records;
    candidateRecords.push(...combined);
    metadata.push({
      outcome,
      previousSource,
      currentKeys,
    });
  }

  const deduped = dedupeRecords(candidateRecords);
  const sources = metadata.map(({ outcome, previousSource, currentKeys }) => {
    const sourceRecords = deduped.records
      .filter((record) => record.sourceId === outcome.sourceId)
      .slice(0, maxSourceRecords);
    const fresh = outcome.status === 'live' || outcome.status === 'empty';
    const lastSuccessAt = fresh
      ? attemptTime(outcome.fetchedAt, now)
      : attemptTime(previousSource?.lastSuccessAt, attemptTime(previousSource?.fetchedAt, null));

    return {
      sourceId: outcome.sourceId,
      label: outcome.label,
      provider: outcome.provider,
      homepage: outcome.homepage,
      group: outcome.group,
      status: outcome.status,
      error: outcome.error ? sanitizeText(outcome.error, 300) : null,
      fetchedAt: attemptTime(outcome.fetchedAt, now),
      lastSuccessAt,
      carriedRecords: sourceRecords.filter((record) => !currentKeys.has(record.key)).length,
      records: sourceRecords,
    };
  });

  // Derive news only from records that survived per-source limits, otherwise a
  // reaction could refer to a headline absent from every published source.
  const includedRecords = sources.flatMap((source) => source.records);
  const newsRecords = includedRecords
    .filter(
      (record) =>
        record.group === 'news' &&
        record.originalAt <= now + NEWS_FUTURE_MS &&
        now - record.originalAt <= DECAY.news.maxAgeHours * HOUR_MS,
    )
    .sort((a, b) => b.originalAt - a.originalAt);
  const newsByKey = new Map(newsRecords.map((record) => [record.key, record]));

  const validatedCarried = validateCachedNewsReactions(
    previousCache?.newsReactions ?? [],
    new Set(newsByKey.keys()),
    { now },
  );
  const carried = validatedCarried.reactions.filter((reaction) => {
    const record = newsByKey.get(reaction.sourceId);
    return (
      record &&
      recordIsRetained(record, now) &&
      now - reaction.interpretedAt <= DECAY.news.maxAgeHours * HOUR_MS
    );
  });
  const carriedByKey = new Set(carried.map((reaction) => reaction.sourceId));
  const pending = newsRecords.filter((record) => !carriedByKey.has(record.key));

  return {
    sources,
    records: includedRecords,
    newsRecords,
    newsByKey,
    carried,
    carriedRejected: validatedCarried.rejected,
    pending,
    previousCache,
    now,
  };
}

/** Compose the final cache payload after the model has run (or failed). */
export function composeSnapshot({ plan, modelResult = {}, modelConfig = {}, now } = {}) {
  if (!plan) throw new Error('A prepared build plan is required.');
  const generatedAt = now ?? plan.now ?? Date.now();

  const newReactions = (Array.isArray(modelResult.reactions) ? modelResult.reactions : [])
    .filter((reaction) => reaction && plan.newsByKey.has(reaction.sourceId))
    .map((reaction) => ({
      sourceId: reaction.sourceId,
      mood: reaction.mood,
      intensity: reaction.intensity,
      text: reaction.text,
      interpretedAt: generatedAt,
    }));

  const merged = new Map();
  for (const reaction of plan.carried) merged.set(reaction.sourceId, reaction);
  for (const reaction of newReactions) merged.set(reaction.sourceId, reaction);
  const newsReactions = [...merged.values()].filter((reaction) => plan.newsByKey.has(reaction.sourceId));

  const attempted = plan.pending.length > 0;
  const configured = modelConfig.configured === true;
  const available = attempted ? modelResult.ok === true : configured;
  const error = attempted ? modelResult.error ?? (available ? null : 'News model did not run.') : null;

  const newsModel = {
    provider: modelConfig.provider ?? null,
    model: modelConfig.model ?? null,
    configured,
    available,
    error: error ? sanitizeText(error, 300) : null,
    partial: Boolean(error && newsReactions.length > 0),
    reactionCount: newsReactions.length,
    interpretedThisRun: newReactions.length,
    carriedThisRun: plan.carried.length,
    rejectedThisRun: Array.isArray(modelResult.rejected) ? modelResult.rejected.length : 0,
    generatedAt,
  };

  return {
    schemaVersion: WORLD_CACHE_SCHEMA_VERSION,
    generatedAt,
    newsModel,
    newsReactions,
    sources: plan.sources,
  };
}