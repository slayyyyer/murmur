export const KEY_FIELDS = Object.freeze({
  observations: 'key',
  reactions: 'key',
  sourceStates: 'sourceId',
  meta: 'key',
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

/**
 * A small store used by tests, and by browsers where IndexedDB is unavailable.
 * The shape mirrors the IndexedDB adapter: get/getAll/put/bulkPut/delete/clear.
 */
export function createMemoryStore(seed = {}) {
  const collections = new Map(Object.keys(KEY_FIELDS).map((name) => [name, new Map()]));

  const ensure = (name) => {
    if (!collections.has(name)) collections.set(name, new Map());
    return collections.get(name);
  };

  for (const [name, rows] of Object.entries(seed)) {
    const field = KEY_FIELDS[name] ?? 'key';
    for (const row of rows ?? []) ensure(name).set(row[field], clone(row));
  }

  return {
    kind: 'memory',

    async get(name, key) {
      const row = ensure(name).get(key);
      return row ? clone(row) : null;
    },

    async getAll(name) {
      return [...ensure(name).values()].map(clone);
    },

    async put(name, value) {
      ensure(name).set(value[KEY_FIELDS[name] ?? 'key'], clone(value));
    },

    async bulkPut(name, values) {
      const field = KEY_FIELDS[name] ?? 'key';
      for (const value of values) ensure(name).set(value[field], clone(value));
    },

    async delete(name, key) {
      ensure(name).delete(key);
    },

    async clear(name) {
      ensure(name).clear();
    },

    snapshot() {
      return Object.fromEntries(
        [...collections.entries()].map(([name, rows]) => [name, [...rows.values()].map(clone)]),
      );
    },

    close() {},
  };
}

export function memoryStoreFromSnapshot(snapshot) {
  return createMemoryStore(snapshot);
}
