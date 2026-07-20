import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  LEGACY_STORAGE_KEYS,
  PREVIOUS_STORAGE_KEYS,
  STORAGE_KEYS,
} from "@/config/brand";

export const SECRET_KEYS = {
  openaiApiKey: "openai-api-key",
  anthropicApiKey: "anthropic-api-key",
  codexOAuth: "codex-oauth",
} as const;

export type SecretKey = (typeof SECRET_KEYS)[keyof typeof SECRET_KEYS];
export type SecretStorageBackend =
  | "uninitialized"
  | "os-keychain"
  | "browser-fallback";

export interface SecretStorageInitialization {
  backend: Exclude<SecretStorageBackend, "uninitialized">;
  migrationErrors: string[];
}

const ALL_SECRET_KEYS = Object.values(SECRET_KEYS);
const BROWSER_FALLBACK_KEY = "bubbertron9001-browser-secrets";
const PREVIOUS_BROWSER_FALLBACK_KEY = "bubberton9001-browser-secrets";

let backend: SecretStorageBackend = "uninitialized";
let initialization: Promise<SecretStorageInitialization> | null = null;
let secretCache: Partial<Record<SecretKey, string>> = {};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTauriRuntime(): boolean {
  return isTauri();
}

function parseSecretRecord(raw: string | null): Partial<Record<SecretKey, string>> {
  if (!raw) return {};

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return {};

    const result: Partial<Record<SecretKey, string>> = {};
    for (const key of ALL_SECRET_KEYS) {
      const value = parsed[key];
      if (typeof value === "string" && value.length > 0) {
        result[key] = value;
      }
    }
    return result;
  } catch {
    return {};
  }
}

function readApiKeysFromSettings(
  storageKey: string,
): Partial<Record<SecretKey, string>> {
  const raw = localStorage.getItem(storageKey);
  if (!raw) return {};

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return {};

    const state = isRecord(parsed.state) ? parsed.state : parsed;
    const apiKeys = isRecord(state.apiKeys) ? state.apiKeys : null;
    if (!apiKeys) return {};

    const result: Partial<Record<SecretKey, string>> = {};
    if (typeof apiKeys.openai === "string" && apiKeys.openai.length > 0) {
      result[SECRET_KEYS.openaiApiKey] = apiKeys.openai;
    }
    if (
      typeof apiKeys.anthropic === "string" &&
      apiKeys.anthropic.length > 0
    ) {
      result[SECRET_KEYS.anthropicApiKey] = apiKeys.anthropic;
    }
    return result;
  } catch {
    return {};
  }
}

function readLegacySecrets(): Partial<Record<SecretKey, string>> {
  const migrated: Partial<Record<SecretKey, string>> = {
    ...parseSecretRecord(localStorage.getItem(PREVIOUS_BROWSER_FALLBACK_KEY)),
    ...parseSecretRecord(localStorage.getItem(BROWSER_FALLBACK_KEY)),
  };

  for (const storageKey of [
    STORAGE_KEYS.settings,
    PREVIOUS_STORAGE_KEYS.settings,
    LEGACY_STORAGE_KEYS.settings,
  ]) {
    const apiKeys = readApiKeysFromSettings(storageKey);
    for (const [key, value] of Object.entries(apiKeys) as Array<
      [SecretKey, string]
    >) {
      migrated[key] ??= value;
    }
  }

  for (const storageKey of [
    STORAGE_KEYS.codexAuth,
    PREVIOUS_STORAGE_KEYS.codexAuth,
    LEGACY_STORAGE_KEYS.codexAuth,
  ]) {
    const value = localStorage.getItem(storageKey);
    if (value) {
      migrated[SECRET_KEYS.codexOAuth] ??= value;
    }
  }

  return migrated;
}

function scrubApiKeysFromSettings(storageKey: string): void {
  const raw = localStorage.getItem(storageKey);
  if (!raw) return;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) {
      localStorage.removeItem(storageKey);
      return;
    }

    let changed = false;
    if ("apiKeys" in parsed) {
      delete parsed.apiKeys;
      changed = true;
    }
    if (isRecord(parsed.state) && "apiKeys" in parsed.state) {
      delete parsed.state.apiKeys;
      changed = true;
    }

    if (changed) {
      localStorage.setItem(storageKey, JSON.stringify(parsed));
    }
  } catch {
    // A corrupt settings payload cannot safely be proven secret-free.
    localStorage.removeItem(storageKey);
  }
}

function scrubLegacyPlaintext(): void {
  scrubApiKeysFromSettings(STORAGE_KEYS.settings);
  scrubApiKeysFromSettings(PREVIOUS_STORAGE_KEYS.settings);
  scrubApiKeysFromSettings(LEGACY_STORAGE_KEYS.settings);
  localStorage.removeItem(STORAGE_KEYS.codexAuth);
  localStorage.removeItem(PREVIOUS_STORAGE_KEYS.codexAuth);
  localStorage.removeItem(LEGACY_STORAGE_KEYS.codexAuth);
}

function persistBrowserFallback(): void {
  const values = Object.fromEntries(
    Object.entries(secretCache).filter(([, value]) => Boolean(value)),
  );

  if (Object.keys(values).length === 0) {
    localStorage.removeItem(BROWSER_FALLBACK_KEY);
  } else {
    localStorage.setItem(BROWSER_FALLBACK_KEY, JSON.stringify(values));
  }
}

async function initializeOsKeychain(
  migrated: Partial<Record<SecretKey, string>>,
): Promise<SecretStorageInitialization> {
  const migrationErrors: string[] = [];

  for (const key of ALL_SECRET_KEYS) {
    try {
      const stored = await invoke<string | null>("secret_get", { key });
      if (stored) {
        secretCache[key] = stored;
        continue;
      }
    } catch (error) {
      migrationErrors.push(`Could not read ${key}: ${String(error)}`);
    }

    const legacyValue = migrated[key];
    if (!legacyValue) continue;

    // Keep the migrated value in memory for this session even if the native
    // credential store is temporarily locked. It is never written back to
    // localStorage in a packaged app.
    secretCache[key] = legacyValue;
    try {
      await invoke("secret_set", { key, value: legacyValue });
    } catch (error) {
      migrationErrors.push(`Could not migrate ${key}: ${String(error)}`);
    }
  }

  scrubLegacyPlaintext();
  localStorage.removeItem(BROWSER_FALLBACK_KEY);
  localStorage.removeItem(PREVIOUS_BROWSER_FALLBACK_KEY);
  backend = "os-keychain";
  return { backend, migrationErrors };
}

function initializeBrowserFallback(
  migrated: Partial<Record<SecretKey, string>>,
): SecretStorageInitialization {
  secretCache = { ...migrated };
  backend = "browser-fallback";
  persistBrowserFallback();
  localStorage.removeItem(PREVIOUS_BROWSER_FALLBACK_KEY);
  scrubLegacyPlaintext();
  return { backend, migrationErrors: [] };
}

/**
 * Hydrates the synchronous in-memory secret cache before the React app loads.
 *
 * Packaged Tauri builds use the operating system credential store through Rust
 * commands. Browser development and unit tests use a deliberately scoped
 * localStorage fallback because no native credential store exists there.
 */
export async function initializeSecretStorage(): Promise<SecretStorageInitialization> {
  if (initialization) return initialization;

  initialization = (async () => {
    if (typeof localStorage === "undefined") {
      backend = "browser-fallback";
      return { backend, migrationErrors: [] };
    }

    const migrated = readLegacySecrets();
    if (isTauriRuntime()) {
      return initializeOsKeychain(migrated);
    }
    return initializeBrowserFallback(migrated);
  })();

  return initialization;
}

export function getSecretStorageBackend(): SecretStorageBackend {
  return backend;
}

export function getSecretValue(key: SecretKey): string | undefined {
  return secretCache[key];
}

export async function setSecretValue(
  key: SecretKey,
  value: string,
): Promise<void> {
  await initializeSecretStorage();

  if (value.length === 0) {
    await deleteSecretValue(key);
    return;
  }

  const previous = secretCache[key];
  secretCache[key] = value;

  try {
    if (backend === "os-keychain") {
      await invoke("secret_set", { key, value });
    } else {
      persistBrowserFallback();
    }
  } catch (error) {
    if (previous) {
      secretCache[key] = previous;
    } else {
      delete secretCache[key];
    }
    throw new Error(`Unable to save the secret securely: ${String(error)}`);
  }
}

export async function deleteSecretValue(key: SecretKey): Promise<void> {
  await initializeSecretStorage();

  const previous = secretCache[key];
  delete secretCache[key];

  try {
    if (backend === "os-keychain") {
      await invoke("secret_delete", { key });
    } else {
      persistBrowserFallback();
    }
  } catch (error) {
    if (previous) secretCache[key] = previous;
    throw new Error(`Unable to remove the stored secret: ${String(error)}`);
  }
}

export const __secureStorageTestUtils = {
  browserFallbackKey: BROWSER_FALLBACK_KEY,
  previousBrowserFallbackKey: PREVIOUS_BROWSER_FALLBACK_KEY,
  reset() {
    backend = "uninitialized";
    initialization = null;
    secretCache = {};
  },
};
