function earliestValid(a, b) {
  const left = Number(a);
  const right = Number(b);
  const leftValid = Number.isFinite(left);
  const rightValid = Number.isFinite(right);
  if (leftValid && rightValid) return Math.min(left, right);
  if (leftValid) return left;
  if (rightValid) return right;
  return null;
}

function latestValid(a, b) {
  const left = Number(a);
  const right = Number(b);
  const leftValid = Number.isFinite(left);
  const rightValid = Number.isFinite(right);
  if (leftValid && rightValid) return Math.max(left, right);
  if (leftValid) return left;
  if (rightValid) return right;
  return null;
}

/**
 * Merge a repeated record without moving its known original date forward.
 * Incoming content wins for title/URL/summary; the earliest original date and
 * the latest observation date are preserved deliberately.
 */
export function mergeRecord(existing, incoming, now = Date.now()) {
  return {
    ...existing,
    ...incoming,
    key: existing.key,
    firstSeenAt: existing.firstSeenAt ?? now,
    lastSeenAt: now,
    originalAt: earliestValid(existing.originalAt, incoming.originalAt),
    observedAt: latestValid(existing.observedAt, incoming.observedAt),
    updatedAt: latestValid(existing.updatedAt, incoming.updatedAt),
  };
}

export function createRepository(store) {
  return {
    store,

    async ingestRecords(incoming, now = Date.now()) {
      const merged = [];
      let added = 0;
      let updated = 0;

      for (const record of incoming ?? []) {
        if (!record?.key) continue;
        const existing = await store.get('observations', record.key);
        if (!existing) {
          const row = { ...record, firstSeenAt: now, lastSeenAt: now };
          await store.put('observations', row);
          merged.push(row);
          added += 1;
        } else {
          const row = mergeRecord(existing, record, now);
          await store.put('observations', row);
          merged.push(row);
          updated += 1;
        }
      }

      return { records: merged, added, updated };
    },

    async saveReactionIfAbsent(reaction) {
      if (!reaction?.key) return { saved: false, reaction: null };
      const existing = await store.get('reactions', reaction.key);
      if (existing) return { saved: false, reaction: existing };
      await store.put('reactions', reaction);
      return { saved: true, reaction };
    },

    async getReaction(key) {
      return store.get('reactions', key);
    },

    async listRecords() {
      const records = await store.getAll('observations');
      return records.sort(
        (a, b) =>
          Number(b.observedAt ?? b.originalAt ?? b.firstSeenAt ?? 0) -
            Number(a.observedAt ?? a.originalAt ?? a.firstSeenAt ?? 0) ||
          String(a.key).localeCompare(String(b.key)),
      );
    },

    async listReactions() {
      return store.getAll('reactions');
    },

    async listSourceStates() {
      return store.getAll('sourceStates');
    },

    async saveSourceStates(states) {
      await store.bulkPut('sourceStates', states);
    },

    async getMeta(key) {
      const row = await store.get('meta', key);
      return row?.value ?? null;
    },

    async setMeta(key, value) {
      await store.put('meta', { key, value });
    },

    async clearAll() {
      for (const collection of ['observations', 'reactions', 'sourceStates', 'meta']) {
        await store.clear(collection);
      }
    },
  };
}
