import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { stepCountIs, streamText, type ToolSet } from "ai";
import { robloxTools } from "@/lib/roblox";
import { skillTools } from "@/lib/skills";
import { appFetch } from "@/lib/http";
import { planningTools } from "@/lib/agent/planning";
import { hasRunningPlan } from "@/lib/agent/run-state";
import { codexChat } from "./codex-chat";
import { errorMessage, getToolError } from "./errors";
import { ROBLOX_SYSTEM_PROMPT } from "./system-prompt";
import { getStandardStepPolicy } from "./providers";
import type { ChatOptions, ProviderType } from "./providers";

function createStandardRuntime(
  provider: Exclude<ProviderType, "codex">,
  apiKey: string,
  model: string,
  officialDocsOnly: boolean
) {
  if (provider === "openai") {
    const openai = createOpenAI({ apiKey, fetch: appFetch });
    return {
      model: openai.responses(model),
      webSearch: openai.tools.webSearch({
        externalWebAccess: true,
        searchContextSize: "medium",
        ...(officialDocsOnly
          ? { filters: { allowedDomains: ["create.roblox.com"] } }
          : {}),
      }),
    };
  }

  const anthropic = createAnthropic({ apiKey, fetch: appFetch });
  return {
    model: anthropic(model),
    webSearch: anthropic.tools.webSearch_20250305({
      maxUses: 5,
      ...(officialDocsOnly
        ? { allowedDomains: ["create.roblox.com"] }
        : {}),
    }),
  };
}

export async function chat(options: ChatOptions) {
  const {
    model,
    provider,
    apiKey,
    messages,
    signal,
    forceWebSearch = false,
    officialDocsOnly = false,
    planningRequired = false,
    onToken,
    onToolCall,
    onToolResult,
    onToolError,
    onSource,
    onFinish,
    onError,
  } = options;

  try {
    if (provider === "codex") {
      return codexChat(model, messages, {
        signal,
        planningRequired,
        forceWebSearch,
        officialDocsOnly,
        onToken,
        onToolCall,
        onToolResult,
        onToolError,
        onSource,
        onFinish,
        onError,
      });
    }

    const runtime = createStandardRuntime(
      provider,
      apiKey,
      model,
      officialDocsOnly
    );
    const tools = {
      ...robloxTools,
      ...skillTools,
      ...planningTools,
      web_search: runtime.webSearch,
    } as ToolSet;
    const toolNames = Object.keys(tools);

    const result = streamText({
      model: runtime.model,
      system: ROBLOX_SYSTEM_PROMPT,
      tools,
      stopWhen: stepCountIs(18),
      maxRetries: 2,
      timeout: 2 * 60 * 1000,
      abortSignal: signal,
      messages: messages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
      prepareStep: ({ steps }) =>
        getStandardStepPolicy({
          steps,
          planningRequired,
          forceWebSearch,
          toolNames,
        }),
    });

    let fullText = "";
    let streamFailure: Error | null = null;

    for await (const event of result.fullStream) {
      switch (event.type) {
        case "text-delta":
          fullText += event.text;
          onToken?.(event.text);
          break;

        case "tool-call":
          onToolCall?.({
            id: event.toolCallId,
            name: event.toolName,
            input:
              event.input && typeof event.input === "object"
                ? (event.input as Record<string, unknown>)
                : {},
          });
          break;

        case "tool-result": {
          const failure = getToolError(event.output);
          if (failure) {
            onToolError?.({
              id: event.toolCallId,
              name: event.toolName,
              error: failure.message,
              retryable: failure.retryable,
            });
          } else {
            onToolResult?.({
              id: event.toolCallId,
              name: event.toolName,
              output: event.output,
            });
          }
          break;
        }

        case "tool-error":
          onToolError?.({
            id: event.toolCallId,
            name: event.toolName,
            error: errorMessage(event.error),
            retryable: false,
          });
          break;

        case "source":
          if (event.sourceType === "url") {
            onSource?.({
              id: event.id,
              url: event.url,
              title: event.title,
            });
          }
          break;

        case "error":
          streamFailure = new Error(errorMessage(event.error));
          break;

        case "finish":
          if (event.finishReason === "error" && !streamFailure) {
            streamFailure = new Error(
              event.rawFinishReason || "The model stream ended with an error"
            );
          }
          break;
      }
    }

    if (streamFailure) throw streamFailure;
    if (hasRunningPlan()) {
      throw new Error(
        "The model stopped before every plan step was resolved and verified"
      );
    }

    onFinish?.(fullText);
    return fullText;
  } catch (error) {
    const normalized =
      error instanceof Error ? error : new Error(errorMessage(error));
    onError?.(normalized);
    throw normalized;
  }
}
