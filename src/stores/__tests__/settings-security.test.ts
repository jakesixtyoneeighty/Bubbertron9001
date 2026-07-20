import { beforeEach, describe, expect, it } from "vitest";
import { STORAGE_KEYS } from "@/config/brand";
import {
  __secureStorageTestUtils,
  initializeSecretStorage,
} from "@/lib/secure-storage";
import { currentModelId, useSettingsStore } from "../settings";

describe("settings secret persistence", () => {
  beforeEach(async () => {
    __secureStorageTestUtils.reset();
    await initializeSecretStorage();
    useSettingsStore.setState({
      apiKeys: {},
      selectedModel: "gpt-5.6-terra",
      selectedProvider: "codex",
      appSettings: {
        confirmDestructiveActions: true,
        maxHistoryMessages: 40,
        autoPlan: true,
      },
    });
  });

  it("keeps API keys out of the persisted preferences payload", async () => {
    await useSettingsStore.getState().setApiKey("openai", "sk-sensitive");
    useSettingsStore.getState().setSelectedModel("gpt-test", "openai");

    const persisted = localStorage.getItem(STORAGE_KEYS.settings);

    expect(persisted).not.toContain("sk-sensitive");
    expect(persisted).toContain("gpt-test");
    expect(useSettingsStore.getState().getApiKey("openai")).toBe(
      "sk-sensitive",
    );
  });

  it("maps retired provider choices to current replacements", () => {
    expect(currentModelId("gpt-4o")).toBe("gpt-5.6-terra");
    expect(currentModelId("claude-sonnet-4-20250514")).toBe(
      "claude-sonnet-5",
    );
    expect(currentModelId("gpt-5.6-sol")).toBe("gpt-5.6-sol");
  });
});
