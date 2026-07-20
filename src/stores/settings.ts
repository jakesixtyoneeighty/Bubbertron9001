import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  LEGACY_STORAGE_KEYS,
  PREVIOUS_STORAGE_KEYS,
  STORAGE_KEYS,
} from "@/config/brand";
import { migrateStorageKey } from "@/lib/storage";
import {
  deleteSecretValue,
  getSecretValue,
  SECRET_KEYS,
  setSecretValue,
} from "@/lib/secure-storage";

export interface ApiKeys {
  openai?: string;
  anthropic?: string;
}

export type ProviderType = "openai" | "anthropic" | "codex";

export interface AppSettings {
  // Behavior Settings
  confirmDestructiveActions: boolean;
  maxHistoryMessages: number;
  autoPlan: boolean;
}

export interface SettingsState {
  apiKeys: ApiKeys;
  selectedModel: string;
  selectedProvider: ProviderType;
  appSettings: AppSettings;

  // Actions
  setApiKey: (provider: keyof ApiKeys, key: string) => Promise<void>;
  setSelectedModel: (model: string, provider: ProviderType) => void;
  hasApiKey: (provider: keyof ApiKeys) => boolean;
  getApiKey: (provider: keyof ApiKeys) => string | undefined;
  updateAppSettings: (settings: Partial<AppSettings>) => void;
  resetAppSettings: () => void;
}

const DEFAULT_APP_SETTINGS: AppSettings = {
  confirmDestructiveActions: true,
  // Twenty user/assistant turns is ample continuity without repeatedly sending
  // an unbounded transcript to the provider.
  maxHistoryMessages: 40,
  autoPlan: true,
};

const RETIRED_MODEL_REPLACEMENTS: Record<string, string> = {
  "gpt-4o": "gpt-5.6-terra",
  "gpt-4o-mini": "gpt-5.6-luna",
  "chatgpt-4o-latest": "gpt-5.6-terra",
  "gpt-5": "gpt-5.6-terra",
  "gpt-5.1": "gpt-5.6-terra",
  "gpt-5.1-chat-latest": "gpt-5.6-terra",
  "gpt-5.2": "gpt-5.6-terra",
  "gpt-5.2-chat-latest": "gpt-5.6-terra",
  "claude-sonnet-4-20250514": "claude-sonnet-5",
  "claude-3-5-haiku-20241022": "claude-haiku-4-5-20251001",
};

export function currentModelId(model: string) {
  return RETIRED_MODEL_REPLACEMENTS[model] ?? model;
}

function boundedHistoryMessages(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(40, Math.max(10, Math.trunc(value)))
    : DEFAULT_APP_SETTINGS.maxHistoryMessages;
}

function currentProvider(value: unknown): ProviderType {
  return value === "openai" || value === "anthropic" || value === "codex"
    ? value
    : "codex";
}

migrateStorageKey(PREVIOUS_STORAGE_KEYS.settings, STORAGE_KEYS.settings);
migrateStorageKey(LEGACY_STORAGE_KEYS.settings, STORAGE_KEYS.settings);

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      apiKeys: {
        openai: getSecretValue(SECRET_KEYS.openaiApiKey),
        anthropic: getSecretValue(SECRET_KEYS.anthropicApiKey),
      },
      selectedModel: "gpt-5.6-terra",
      selectedProvider: "codex" as ProviderType,
      appSettings: DEFAULT_APP_SETTINGS,

      setApiKey: async (provider, key) => {
        const normalized = key.trim();
        const secretKey =
          provider === "openai"
            ? SECRET_KEYS.openaiApiKey
            : SECRET_KEYS.anthropicApiKey;

        if (normalized) {
          await setSecretValue(secretKey, normalized);
        } else {
          await deleteSecretValue(secretKey);
        }

        set((state) => ({
          apiKeys: { ...state.apiKeys, [provider]: normalized || undefined },
        }));
      },

      setSelectedModel: (model, provider) =>
        set({
          selectedModel: model,
          selectedProvider: provider,
        }),

      hasApiKey: (provider) => {
        const key = get().apiKeys[provider];
        return !!key && key.length > 0;
      },

      getApiKey: (provider) => get().apiKeys[provider],

      updateAppSettings: (settings) =>
        set((state) => ({
          appSettings: { ...state.appSettings, ...settings },
        })),

      resetAppSettings: () =>
        set({ appSettings: DEFAULT_APP_SETTINGS }),
    }),
    {
      name: STORAGE_KEYS.settings,
      version: 4,
      migrate: (persisted) => {
        const saved = persisted as Partial<SettingsState>;
        return {
          ...saved,
          apiKeys: {},
          selectedProvider: currentProvider(saved.selectedProvider),
          appSettings: {
            ...DEFAULT_APP_SETTINGS,
            ...saved.appSettings,
            maxHistoryMessages: boundedHistoryMessages(
              saved.appSettings?.maxHistoryMessages,
            ),
          },
          selectedModel:
            typeof saved.selectedModel === "string"
              ? currentModelId(saved.selectedModel)
              : "gpt-5.6-terra",
        } as SettingsState;
      },
      partialize: (state) => ({
        selectedModel: state.selectedModel,
        selectedProvider: state.selectedProvider,
        appSettings: state.appSettings,
      }),
      merge: (persisted, current) => {
        const saved = persisted as Partial<SettingsState> | undefined;
        return {
          ...current,
          ...saved,
          // Secrets are hydrated from the OS keychain before this store loads.
          apiKeys: current.apiKeys,
          appSettings: {
            ...DEFAULT_APP_SETTINGS,
            ...saved?.appSettings,
            maxHistoryMessages: boundedHistoryMessages(
              saved?.appSettings?.maxHistoryMessages,
            ),
          },
        };
      },
    }
  )
);
