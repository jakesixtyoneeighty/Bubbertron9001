export function migrateStorageKey(legacyKey: string, currentKey: string) {
  if (typeof localStorage === "undefined") return;
  if (localStorage.getItem(currentKey) !== null) return;

  const legacyValue = localStorage.getItem(legacyKey);
  if (legacyValue !== null) {
    localStorage.setItem(currentKey, legacyValue);
  }
}

