/**
 * A failed fetch never deletes cached observations. If records survive, the
 * visible status becomes "cached" so the difference from a live response is
 * explicit.
 */
export function buildSourceStates({
  outcomes = [],
  records = [],
  previousStates = [],
  now = Date.now(),
  attemptAt = now,
}) {
  const previousById = new Map((previousStates ?? []).map((state) => [state.sourceId, state]));

  return outcomes.map((outcome) => {
    const recordCount = records.filter((record) => record.sourceId === outcome.sourceId).length;
    const isFresh = outcome.status === 'live' || outcome.status === 'empty';
    const status = isFresh ? outcome.status : recordCount > 0 ? 'cached' : outcome.status;
    const previous = previousById.get(outcome.sourceId);

    return {
      sourceId: outcome.sourceId,
      label: outcome.label,
      provider: outcome.provider,
      homepage: outcome.homepage,
      group: outcome.group,
      status,
      error: outcome.error ?? null,
      recordCount,
      detail: outcome.detail ?? null,
      lastAttemptAt: attemptAt,
      lastSuccessAt: isFresh
        ? outcome.fetchedAt ?? outcome.lastSuccessAt ?? now
        : outcome.lastSuccessAt ?? previous?.lastSuccessAt ?? null,
    };
  });
}
