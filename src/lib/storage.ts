export function migrateStorageKey(legacyKey: string, currentKey: string) {
  if (typeof localStorage === "undefined") return;
  if (localStorage.getItem(currentKey) !== null) return;

  const legacyValue = localStorage.getItem(legacyKey);
  if (legacyValue !== null) {
    try {
      localStorage.setItem(currentKey, legacyValue);
    } catch (error) {
      // A cache or legacy payload can be larger than the WebView's current
      // quota. Migration is best-effort and must never prevent app startup.
      console.warn(
        `[Storage] Could not migrate ${legacyKey} to ${currentKey}:`,
        error,
      );
    }
  }
}

interface AsyncStringStorage {
  getItem: (key: string) => Promise<string | null> | string | null;
  setItem: (key: string, value: string) => Promise<void> | void;
  removeItem: (key: string) => Promise<void> | void;
}

function safeLocalStorage(): AsyncStringStorage {
  return {
    getItem: (key) => localStorage.getItem(key),
    setItem: (key, value) => {
      try {
        localStorage.setItem(key, value);
      } catch (error) {
        console.warn("[Storage] Could not save local data:", error);
      }
    },
    removeItem: (key) => localStorage.removeItem(key),
  };
}

/**
 * Conversation transcripts can outgrow WebView localStorage quickly. IndexedDB
 * gives them a separate, larger quota while retaining a safe browser fallback.
 */
export function createConversationStorage(): AsyncStringStorage {
  if (typeof indexedDB === "undefined") return safeLocalStorage();

  const database = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("bubbertron9001", 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("conversations")) {
        request.result.createObjectStore("conversations");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  const run = async <T>(
    mode: IDBTransactionMode,
    operation: (store: IDBObjectStore) => IDBRequest<T>,
  ) => {
    const db = await database;
    return new Promise<T>((resolve, reject) => {
      const request = operation(
        db.transaction("conversations", mode).objectStore("conversations"),
      );
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  };

  return {
    getItem: async (key) => (await run("readonly", (store) => store.get(key))) || null,
    setItem: async (key, value) => {
      await run("readwrite", (store) => store.put(value, key));
    },
    removeItem: async (key) => {
      await run("readwrite", (store) => store.delete(key));
    },
  };
}
