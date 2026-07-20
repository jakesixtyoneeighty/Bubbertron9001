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
