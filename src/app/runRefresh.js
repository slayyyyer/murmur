import { dedupeRecords } from '../lib/dedupe.js';
import { measuredReaction } from '../interpret/reactions.js';

export function readableError(error) {
  if (!error) return 'Unknown error.';
  if (typeof error === 'string') return error;
  return error.message || String(error);
}

/**
 * Every loader is isolated: a thrown error becomes that source's status and
 * cannot stop the others. All fetched records are deduped once, then a saved
 * reaction is created for each eligible measured observation. News reactions
 * are created only by the optional local model, never here.
 */
export async function runRefresh({ loaders = [], repository, now = Date.now() }) {
  const outcomes = await Promise.all(
    loaders.map(async (loader) => {
      const base = {
        sourceId: loader.id,
        label: loader.label,
        provider: loader.provider,
        homepage: loader.homepage,
        group: loader.group,
      };

      try {
        const result = await loader.load({ now });
        const records = Array.isArray(result?.records) ? result.records : [];
        return {
          ...base,
          status: result?.status ?? (records.length ? 'live' : 'empty'),
          records,
          error: result?.error ?? null,
          detail: result?.detail ?? null,
          fetchedAt: result?.fetchedAt ?? now,
        };
      } catch (error) {
        return {
          ...base,
          status: error?.kind === 'malformed' ? 'malformed' : 'unavailable',
          records: [],
          error: readableError(error),
          detail: null,
          fetchedAt: now,
        };
      }
    }),
  );

  const deduped = dedupeRecords(outcomes.flatMap((outcome) => outcome.records));

  let ingest = { records: [], added: 0, updated: 0 };
  let ingestError = null;
  try {
    ingest = await repository.ingestRecords(deduped.records, now);
  } catch (error) {
    ingestError = readableError(error);
  }

  const reactionsSaved = [];
  for (const record of ingest.records) {
    if (record.group === 'news') continue;
    const reaction = measuredReaction(record, { now });
    if (!reaction) continue;
    try {
      const result = await repository.saveReactionIfAbsent(reaction);
      if (result.saved) reactionsSaved.push(reaction);
    } catch {
      /* A storage failure is already surfaced through ingestError. */
    }
  }

  return {
    outcomes,
    records: ingest.records,
    duplicates: deduped.removed,
    added: ingest.added,
    updated: ingest.updated,
    ingestError,
    reactionsSaved,
    at: now,
  };
}
