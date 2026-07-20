import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
  isTauri: () =>
    Boolean((globalThis as unknown as Record<string, unknown>).isTauri),
}));

import { LEGACY_STORAGE_KEYS, STORAGE_KEYS } from "@/config/brand";
import {
  __secureStorageTestUtils,
  deleteSecretValue,
  getSecretValue,
  initializeSecretStorage,
  SECRET_KEYS,
  setSecretValue,
} from "../secure-storage";

function setTauriRuntime(enabled: boolean) {
  const target = globalThis as unknown as Record<string, unknown>;
  if (enabled) {
    Object.defineProperty(target, "isTauri", {
      value: true,
      configurable: true,
    });
  } else {
    delete target.isTauri;
  }
}

describe("secure storage", () => {
  beforeEach(() => {
    __secureStorageTestUtils.reset();
    invokeMock.mockReset();
    setTauriRuntime(false);
  });

  it("migrates legacy secrets into the browser fallback while preserving preferences", async () => {
    localStorage.setItem(
      LEGACY_STORAGE_KEYS.settings,
      JSON.stringify({
        state: {
          apiKeys: {
            openai: "sk-openai-legacy",
            anthropic: "sk-ant-legacy",
          },
          selectedModel: "gpt-test",
        },
        version: 2,
      }),
    );
    localStorage.setItem(
      LEGACY_STORAGE_KEYS.codexAuth,
      JSON.stringify({
        type: "oauth",
        access: "access",
        refresh: "refresh",
        expires: 123,
      }),
    );

    const result = await initializeSecretStorage();

    expect(result).toEqual({
      backend: "browser-fallback",
      migrationErrors: [],
    });
    expect(getSecretValue(SECRET_KEYS.openaiApiKey)).toBe(
      "sk-openai-legacy",
    );
    expect(getSecretValue(SECRET_KEYS.anthropicApiKey)).toBe("sk-ant-legacy");
    expect(getSecretValue(SECRET_KEYS.codexOAuth)).toContain('"refresh"');
    expect(localStorage.getItem(LEGACY_STORAGE_KEYS.codexAuth)).toBeNull();

    const persistedSettings = JSON.parse(
      localStorage.getItem(LEGACY_STORAGE_KEYS.settings) ?? "{}",
    );
    expect(persistedSettings.state.apiKeys).toBeUndefined();
    expect(persistedSettings.state.selectedModel).toBe("gpt-test");

    const fallback = localStorage.getItem(
      __secureStorageTestUtils.browserFallbackKey,
    );
    expect(fallback).toContain("sk-openai-legacy");
    const parsedFallback = JSON.parse(fallback ?? "{}");
    expect(JSON.parse(parsedFallback[SECRET_KEYS.codexOAuth]).refresh).toBe(
      "refresh",
    );
  });

  it("updates and removes values through the browser fallback", async () => {
    await initializeSecretStorage();

    await setSecretValue(SECRET_KEYS.openaiApiKey, "sk-new");
    expect(getSecretValue(SECRET_KEYS.openaiApiKey)).toBe("sk-new");
    expect(
      localStorage.getItem(__secureStorageTestUtils.browserFallbackKey),
    ).toContain("sk-new");

    await deleteSecretValue(SECRET_KEYS.openaiApiKey);
    expect(getSecretValue(SECRET_KEYS.openaiApiKey)).toBeUndefined();
    expect(
      localStorage.getItem(__secureStorageTestUtils.browserFallbackKey),
    ).toBeNull();
  });

  it("migrates the previous browser fallback after the name correction", async () => {
    localStorage.setItem(
      __secureStorageTestUtils.previousBrowserFallbackKey,
      JSON.stringify({
        [SECRET_KEYS.openaiApiKey]: "sk-before-name-fix",
      }),
    );

    await initializeSecretStorage();

    expect(getSecretValue(SECRET_KEYS.openaiApiKey)).toBe(
      "sk-before-name-fix",
    );
    expect(
      localStorage.getItem(__secureStorageTestUtils.previousBrowserFallbackKey),
    ).toBeNull();
    expect(
      localStorage.getItem(__secureStorageTestUtils.browserFallbackKey),
    ).toContain("sk-before-name-fix");
  });

  it("migrates packaged-app secrets to the OS keychain and removes plaintext", async () => {
    setTauriRuntime(true);
    localStorage.setItem(
      STORAGE_KEYS.settings,
      JSON.stringify({
        state: {
          apiKeys: { openai: "sk-packaged" },
          selectedProvider: "openai",
        },
        version: 2,
      }),
    );
    localStorage.setItem(
      STORAGE_KEYS.codexAuth,
      JSON.stringify({
        type: "oauth",
        access: "access",
        refresh: "refresh",
        expires: 123,
      }),
    );
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "secret_get") return null;
      return undefined;
    });

    const result = await initializeSecretStorage();

    expect(result.backend).toBe("os-keychain");
    expect(result.migrationErrors).toEqual([]);
    expect(invokeMock).toHaveBeenCalledWith("secret_set", {
      key: SECRET_KEYS.openaiApiKey,
      value: "sk-packaged",
    });
    expect(invokeMock).toHaveBeenCalledWith("secret_set", {
      key: SECRET_KEYS.codexOAuth,
      value: expect.stringContaining('"refresh"'),
    });
    expect(localStorage.getItem(STORAGE_KEYS.codexAuth)).toBeNull();
    expect(
      localStorage.getItem(__secureStorageTestUtils.browserFallbackKey),
    ).toBeNull();

    const persistedSettings = JSON.parse(
      localStorage.getItem(STORAGE_KEYS.settings) ?? "{}",
    );
    expect(persistedSettings.state.apiKeys).toBeUndefined();
    expect(persistedSettings.state.selectedProvider).toBe("openai");
  });

  it("prefers an existing OS keychain credential over migrated plaintext", async () => {
    setTauriRuntime(true);
    localStorage.setItem(
      STORAGE_KEYS.settings,
      JSON.stringify({
        state: { apiKeys: { openai: "sk-stale" } },
      }),
    );
    invokeMock.mockImplementation(
      async (command: string, { key }: { key: string }) => {
        if (command === "secret_get" && key === SECRET_KEYS.openaiApiKey) {
          return "sk-keychain";
        }
        if (command === "secret_get") return null;
        return undefined;
      },
    );

    await initializeSecretStorage();

    expect(getSecretValue(SECRET_KEYS.openaiApiKey)).toBe("sk-keychain");
    expect(invokeMock).not.toHaveBeenCalledWith("secret_set", {
      key: SECRET_KEYS.openaiApiKey,
      value: "sk-stale",
    });
  });
});
