import { describe, expect, it } from "vitest";
import { resolveProviderSelection } from "../provider-selection";

describe("provider selection", () => {
  it("keeps an explicitly selected Anthropic model on Anthropic when OAuth exists", () => {
    expect(
      resolveProviderSelection({
        selectedProvider: "anthropic",
        selectedModel: "claude-sonnet-5",
        oauthAuthenticated: true,
        anthropicApiKey: "anthropic-test-key",
      })
    ).toEqual({
      provider: "anthropic",
      model: "claude-sonnet-5",
      apiKey: "anthropic-test-key",
    });
  });

  it("requires a valid OAuth session for a Codex model", () => {
    expect(() =>
      resolveProviderSelection({
        selectedProvider: "codex",
        selectedModel: "gpt-5.2",
        oauthAuthenticated: false,
        openaiApiKey: "openai-test-key",
      })
    ).toThrow("ChatGPT session is unavailable");
  });
});
