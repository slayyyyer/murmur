import { KEY_FIELDS } from './memoryStore.js';

export const DB_NAME = 'murmur';
export const DB_VERSION = 1;

function requestAsPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction was aborted.'));
  });
}

export function createIdbStore(db) {
  const transaction = (name, mode) => db.transaction(name, mode);

  return {
    kind: 'indexeddb',

    async get(name, key) {
      const tx = transaction(name, 'readonly');
      return requestAsPromise(tx.objectStore(name).get(key));
    },

    async getAll(name) {
      const tx = transaction(name, 'readonly');
      return requestAsPromise(tx.objectStore(name).getAll());
    },

    async put(name, value) {
      const tx = transaction(name, 'readwrite');
      tx.objectStore(name).put(value);
      await transactionDone(tx);
    },

    async bulkPut(name, values) {
      if (!values?.length) return;
      const tx = transaction(name, 'readwrite');
      const store = tx.objectStore(name);
      for (const value of values) store.put(value);
      await transactionDone(tx);
    },

    async delete(name, key) {
      const tx = transaction(name, 'readwrite');
      tx.objectStore(name).delete(key);
      await transactionDone(tx);
    },

    async clear(name) {
      const tx = transaction(name, 'readwrite');
      tx.objectStore(name).clear();
      await transactionDone(tx);
    },

    close() {
      db.close();
    },
  };
}

/**
 * Open (and upgrade) the local database. Returns null when IndexedDB is not
 * available, in which case the app falls back to a memory store and says so.
 */
export async function openMurmurStore(factory = globalThis.indexedDB) {
  if (!factory) return null;

  let db;
  try {
    db = await new Promise((resolve, reject) => {
      const request = factory.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const database = request.result;
        for (const [name, field] of Object.entries(KEY_FIELDS)) {
          if (!database.objectStoreNames.contains(name)) {
            database.createObjectStore(name, { keyPath: field });
          }
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('Could not open IndexedDB.'));
      request.onblocked = () => reject(new Error('IndexedDB is blocked by another open tab.'));
    });
  } catch {
    return null;
  }

  db.onversionchange = () => db.close();
  return createIdbStore(db);
}
