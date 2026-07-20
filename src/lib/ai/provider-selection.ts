type ProviderType = "openai" | "anthropic" | "codex";

interface ProviderSelection {
  selectedProvider: ProviderType;
  selectedModel: string;
  oauthAuthenticated: boolean;
  openaiApiKey?: string;
  anthropicApiKey?: string;
}

export interface ResolvedProviderSelection {
  provider: ProviderType;
  model: string;
  apiKey: string;
}

export function resolveProviderSelection({
  selectedProvider,
  selectedModel,
  oauthAuthenticated,
  openaiApiKey,
  anthropicApiKey,
}: ProviderSelection): ResolvedProviderSelection {
  if (selectedProvider === "codex") {
    if (!oauthAuthenticated) {
      throw new Error(
        "Your ChatGPT session is unavailable. Sign in again or select an API model."
      );
    }
    return {
      provider: "codex",
      model: selectedModel,
      apiKey: "codex-oauth",
    };
  }

  const apiKey =
    selectedProvider === "openai" ? openaiApiKey : anthropicApiKey;
  if (!apiKey) {
    throw new Error(
      `No API key configured for ${selectedProvider}. Add one in settings or select a different provider.`
    );
  }

  return {
    provider: selectedProvider,
    model: selectedModel,
    apiKey,
  };
}
