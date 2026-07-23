import { useSettingsStore } from "@/stores/settings";
import { useAuthStore } from "@/stores/auth";
import {
  beginAgentRun,
  hasActivePlan,
  hasRunningPlan,
  isPlanReadyToFinish,
  shouldCreatePlan,
} from "@/lib/agent/run-state";
import { isAuthenticated as isCodexAuthenticated } from "@/lib/auth/codex";
import { resolveProviderSelection } from "./provider-selection";
import type { ChatMode } from "@/stores/chat";

export { ROBLOX_SYSTEM_PROMPT } from "./system-prompt";

export type ProviderType = "openai" | "anthropic" | "codex";

export interface ToolCallEvent {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultEvent {
  id: string;
  name?: string;
  output: unknown;
}

export interface ToolErrorEvent {
  id: string;
  name: string;
  error: string;
  retryable: boolean;
}

export interface WebSource {
  id: string;
  url: string;
  title?: string;
}

export interface ChatCallbacks {
  onToken?: (token: string) => void;
  onToolCall?: (toolCall: ToolCallEvent) => void;
  onToolResult?: (toolResult: ToolResultEvent) => void;
  onToolError?: (toolError: ToolErrorEvent) => void;
  onSource?: (source: WebSource) => void;
  onFinish?: (text: string) => void;
  onError?: (error: Error) => void;
}

export interface ChatRunOptions {
  signal?: AbortSignal;
  mode?: ChatMode;
  forcePlan?: boolean;
  forceWebSearch?: boolean;
  officialDocsOnly?: boolean;
}

export interface ChatOptions extends ChatCallbacks, ChatRunOptions {
  runId: string;
  model: string;
  provider: ProviderType;
  apiKey: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  planningRequired?: boolean;
}

interface StandardStepPolicyInput {
  steps: ReadonlyArray<{
    toolCalls: ReadonlyArray<{ toolName: string }>;
  }>;
  planningRequired: boolean;
  forceWebSearch: boolean;
  toolNames: string[];
  runId?: string;
}

function toolWasCalled(
  steps: StandardStepPolicyInput["steps"],
  toolName: string
) {
  return steps.some((step) =>
    step.toolCalls.some((call) => call.toolName === toolName)
  );
}

export function getStandardStepPolicy({
  steps,
  planningRequired,
  forceWebSearch,
  toolNames,
  runId,
}: StandardStepPolicyInput) {
  if (planningRequired && !hasActivePlan(runId)) {
    return {
      activeTools: ["agent_create_plan"],
      toolChoice: {
        type: "tool" as const,
        toolName: "agent_create_plan",
      },
    };
  }

  if (forceWebSearch && !toolWasCalled(steps, "web_search")) {
    return {
      activeTools: ["web_search"],
      toolChoice: {
        type: "tool" as const,
        toolName: "web_search",
      },
    };
  }

  if (isPlanReadyToFinish(runId)) {
    return {
      activeTools: ["agent_finish_plan"],
      toolChoice: {
        type: "tool" as const,
        toolName: "agent_finish_plan",
      },
    };
  }

  const workingTools = toolNames.filter(
    (toolName) => toolName !== "agent_finish_plan"
  );

  if (hasRunningPlan(runId)) {
    return {
      activeTools: workingTools,
      toolChoice: "required" as const,
    };
  }

  return { activeTools: workingTools };
}

export async function chat(options: ChatOptions) {
  const runtime = await import("./providers-runtime");
  return runtime.chat(options);
}

export function useChat() {
  const {
    selectedModel,
    selectedProvider,
    getApiKey,
    appSettings,
  } = useSettingsStore();
  const { isOAuthAuthenticated } = useAuthStore();

  const sendMessage = async (
    messages: Array<{ role: "user" | "assistant"; content: string }>,
    options: ChatCallbacks & ChatRunOptions = {}
  ) => {
    const { provider, apiKey, model } = resolveProviderSelection({
      selectedProvider,
      selectedModel,
      oauthAuthenticated: isOAuthAuthenticated(),
      openaiApiKey: getApiKey("openai"),
      anthropicApiKey: getApiKey("anthropic"),
    });

    const currentMessage =
      [...messages].reverse().find((message) => message.role === "user")
        ?.content || "";
    const mode = options.mode || "build";
    const planningRequired = mode === "build" && appSettings.autoPlan
      ? shouldCreatePlan(currentMessage, options.forcePlan)
      : mode === "build" && options.forcePlan === true;

    const runId = beginAgentRun(currentMessage, planningRequired);

    return chat({
      runId,
      model,
      provider,
      apiKey,
      messages: messages.slice(-appSettings.maxHistoryMessages),
      planningRequired,
      mode,
      ...options,
    });
  };

  return { sendMessage };
}

export function hasAnyAuth(): boolean {
  const { apiKeys } = useSettingsStore.getState();
  return Boolean(
    apiKeys.openai || apiKeys.anthropic || isCodexAuthenticated()
  );
}
