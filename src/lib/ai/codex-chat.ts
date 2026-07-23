import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { z } from "zod";
import { getValidAccessToken, getStoredAuth } from "@/lib/auth/codex";
import { robloxTools } from "@/lib/roblox";
import { skillTools } from "@/lib/skills";
import {
  createWorkerToolset,
  clearDelegationCrew,
  delegationTools,
  hasActivePlan,
  hasRunningPlan,
  isPlanReadyToFinish,
  planningTools,
  registerWorkerExecutor,
  type WorkerAssignment,
  type WorkerExecutionContext,
  type WorkerExecutor,
} from "@/lib/agent";
import { errorMessage, getToolError, isAbortError } from "./errors";
import { ASK_SYSTEM_PROMPT, ROBLOX_SYSTEM_PROMPT } from "./system-prompt";
import {
  buildWorkerSystemPrompt,
  workerOutputSchema,
  workerResultFromOutput,
} from "./worker-runtime";
import {
  WorkerToolCallBudget,
  executeCodexWorkerToolCallBatch,
} from "./worker-tool-budget";
import type {
  ChatCallbacks,
  ChatRunOptions,
  WebSource,
} from "./providers";
import {
  getAgentLoopStopReason,
  MAX_AGENT_ITERATIONS,
  type AgentLoopStep,
} from "./agent-loop-policy";

const CODEX_API_ENDPOINT =
  "https://chatgpt.com/backend-api/codex/responses";
const MAX_REQUEST_RETRIES = 2;
const MAX_ERROR_BODY_LENGTH = 1_500;

const agentTools = {
  ...robloxTools,
  ...skillTools,
  ...planningTools,
  ...delegationTools,
};
export const CODEX_WORKING_TOOL_NAMES = Object.keys(agentTools).filter(
  (name) => name !== "agent_finish_plan"
) as Array<keyof typeof agentTools>;

export interface CodexMessage {
  role: "user" | "assistant";
  content: string;
}

export interface CodexChatCallbacks extends ChatCallbacks, ChatRunOptions {
  runId?: string;
  planningRequired?: boolean;
}

interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

interface CodexStreamResult {
  text: string;
  toolCalls: ToolCall[];
  webSearchUsed: boolean;
}

type CodexStreamCallbacks = Pick<
  CodexChatCallbacks,
  "signal" | "onToken" | "onToolCall" | "onToolResult" | "onSource"
>;

class CodexStreamReadError extends Error {
  readonly retrySafe: boolean;

  constructor(message: string, retrySafe: boolean) {
    super(message);
    this.name = "CodexStreamReadError";
    this.retrySafe = retrySafe;
  }
}

type InputItem =
  | { role: "user"; content: Array<{ type: "input_text"; text: string }> }
  | {
      role: "assistant";
      content: Array<{ type: "output_text"; text: string }>;
    }
  | {
      type: "function_call";
      call_id: string;
      name: string;
      arguments: string;
    }
  | { type: "function_call_output"; call_id: string; output: string };

interface FunctionToolDefinition {
  type: "function";
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  strict: boolean;
}

interface WebSearchToolDefinition {
  type: "web_search";
  search_context_size: "medium";
  filters?: { allowed_domains: string[] };
}

type CodexToolDefinition =
  | FunctionToolDefinition
  | WebSearchToolDefinition;

type CodexToolChoice =
  | "auto"
  | "required"
  | {
      type: "allowed_tools";
      mode: "required";
      tools: Array<{ type: "web_search" }>;
    };

export const CODEX_FORCED_WEB_SEARCH_CHOICE = {
  type: "allowed_tools",
  mode: "required",
  tools: [{ type: "web_search" }],
} as const satisfies CodexToolChoice;

type ExecutableToolMap = Record<
  string,
  {
    description?: string;
    inputSchema?: z.ZodType;
    execute?: (
      input: unknown,
      options?: Record<string, unknown>,
    ) => Promise<unknown>;
  }
>;

function convertToolsToOpenAI(
  toolset: ExecutableToolMap,
  names: ReadonlyArray<string> = Object.keys(toolset),
) {
  return names.flatMap((name): FunctionToolDefinition[] => {
    const candidate = toolset[name];
    if (!candidate.inputSchema) return [];

    return [
      {
        type: "function",
        name,
        description: candidate.description || name,
        parameters: z.toJSONSchema(candidate.inputSchema, {
          unrepresentable: "any",
        }) as Record<string, unknown>,
        strict: false,
      },
    ];
  });
}

function webSearchTool(officialDocsOnly: boolean): WebSearchToolDefinition {
  return {
    type: "web_search",
    search_context_size: "medium",
    ...(officialDocsOnly
      ? { filters: { allowed_domains: ["create.roblox.com"] } }
      : {}),
  };
}

function convertToCodexInput(messages: CodexMessage[]): InputItem[] {
  return messages.map((message) =>
    message.role === "user"
      ? {
          role: "user" as const,
          content: [{ type: "input_text" as const, text: message.content }],
        }
      : {
          role: "assistant" as const,
          content: [
            { type: "output_text" as const, text: message.content },
          ],
        }
  );
}

function validationIssues(error: z.ZodError) {
  return error.issues.map((issue) => ({
    path: issue.path.join(".") || "input",
    message: issue.message,
  }));
}

async function executeTool(
  toolCall: ToolCall,
  signal: AbortSignal | undefined,
  toolset: ExecutableToolMap = agentTools as unknown as ExecutableToolMap,
  executionContext?: Record<string, unknown>,
): Promise<unknown> {
  const candidate = toolset[toolCall.name] as
    | {
        inputSchema?: {
          safeParse: (
            input: unknown
          ) =>
            | { success: true; data: unknown }
            | { success: false; error: z.ZodError };
        };
        execute?: (
          input: unknown,
          options?: Record<string, unknown>
        ) => Promise<unknown>;
      }
    | undefined;

  if (!candidate?.execute || !candidate.inputSchema) {
    return {
      error: `Unknown or non-executable tool: ${toolCall.name}`,
      retryable: false,
    };
  }

  let parsedArguments: unknown;
  try {
    parsedArguments = JSON.parse(toolCall.arguments);
  } catch {
    return {
      error: "Tool arguments were not valid JSON",
      retryable: true,
      received: toolCall.arguments.slice(0, 500),
    };
  }

  const validation = candidate.inputSchema.safeParse(parsedArguments);
  if (!validation.success) {
    return {
      error: "Tool arguments did not match the required schema",
      retryable: true,
      issues: validationIssues(validation.error),
    };
  }

  if (signal?.aborted) {
    throw new DOMException("Agent run cancelled", "AbortError");
  }

  try {
    return await candidate.execute(validation.data, {
      toolCallId: toolCall.id,
      abortSignal: signal,
      experimental_context: executionContext,
    });
  } catch (error) {
    return {
      error: errorMessage(error),
      retryable: false,
    };
  }
}

function retryableStatus(status: number) {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

function retryableCodexTransportError(error: unknown) {
  const message = errorMessage(error).toLowerCase();
  return [
    "error decoding response body",
    "failed to fetch",
    "network error",
    "connection reset",
    "connection closed",
    "unexpected eof",
    "failed to read response body",
    "chatgpt returned no response body",
    "chatgpt stream ended during a tool call",
    "chatgpt sent an invalid stream event",
  ].some((fragment) => message.includes(fragment));
}

async function abortableDelay(milliseconds: number, signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new DOMException("Agent run cancelled", "AbortError");
  }
  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(resolve, milliseconds);
    signal?.addEventListener(
      "abort",
      () => {
        window.clearTimeout(timeout);
        reject(new DOMException("Agent run cancelled", "AbortError"));
      },
      { once: true }
    );
  });
}

async function requestWithRetry(
  body: Record<string, unknown>,
  headers: Record<string, string>,
  signal?: AbortSignal
) {
  for (let attempt = 0; attempt <= MAX_REQUEST_RETRIES; attempt += 1) {
    const response = await tauriFetch(CODEX_API_ENDPOINT, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal,
    });

    if (response.ok) return response;

    const responseText = (await response.text()).slice(
      0,
      MAX_ERROR_BODY_LENGTH
    );
    const isLastAttempt = attempt === MAX_REQUEST_RETRIES;
    if (isLastAttempt || !retryableStatus(response.status)) {
      throw new Error(
        `ChatGPT request failed (${response.status}): ${responseText}`
      );
    }

    const retryAfter = Number(response.headers.get("retry-after"));
    const backoff = Number.isFinite(retryAfter)
      ? retryAfter * 1_000
      : 500 * 2 ** attempt;
    await abortableDelay(Math.min(backoff, 5_000), signal);
  }

  throw new Error("ChatGPT request exhausted its retry budget");
}

function extractSources(value: unknown): WebSource[] {
  if (!value || typeof value !== "object" || !("content" in value)) {
    return [];
  }

  const content = value.content;
  if (!Array.isArray(content)) return [];

  const sources: WebSource[] = [];
  for (const part of content) {
    if (!part || typeof part !== "object" || !("annotations" in part)) {
      continue;
    }
    const annotations = part.annotations;
    if (!Array.isArray(annotations)) continue;
    for (const annotation of annotations) {
      if (
        annotation &&
        typeof annotation === "object" &&
        annotation.type === "url_citation" &&
        typeof annotation.url === "string"
      ) {
        sources.push({
          id:
            typeof annotation.id === "string"
              ? annotation.id
              : annotation.url,
          url: annotation.url,
          title:
            typeof annotation.title === "string"
              ? annotation.title
              : undefined,
        });
      }
    }
  }
  return sources;
}

async function consumeCodexResponse(
  response: Response,
  callbacks: CodexStreamCallbacks,
  deferEffects: boolean,
): Promise<CodexStreamResult> {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new CodexStreamReadError(
      "ChatGPT returned no response body",
      true,
    );
  }

  const decoder = new TextDecoder();
  let text = "";
  let buffer = "";
  let receivedTextDelta = false;
  let terminalError: Error | null = null;
  let invalidStreamEvent = false;
  let effectsExposed = false;
  let webSearchUsed = false;
  const deferredEffects: Array<() => void> = [];
  const toolCalls: ToolCall[] = [];
  const pendingToolCalls = new Map<
    string,
    { name: string; arguments: string }
  >();

  const expose = (effect: () => void) => {
    if (deferEffects) {
      deferredEffects.push(effect);
      return;
    }
    effectsExposed = true;
    effect();
  };
  const emitToken = (token: string) => {
    if (!token || !callbacks.onToken) return;
    expose(() => callbacks.onToken?.(token));
  };

  while (true) {
    let chunk: ReadableStreamReadResult<Uint8Array>;
    try {
      chunk = await reader.read();
    } catch (error) {
      if (isAbortError(error) || callbacks.signal?.aborted) throw error;
      throw new CodexStreamReadError(
        errorMessage(error),
        !effectsExposed,
      );
    }
    if (chunk.done) break;

    buffer += decoder.decode(chunk.value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trimStart();
      if (!data || data === "[DONE]") continue;

      let event: Record<string, unknown>;
      try {
        event = JSON.parse(data) as Record<string, unknown>;
      } catch {
        invalidStreamEvent = true;
        continue;
      }

      const type = typeof event.type === "string" ? event.type : "";
      const item =
        event.item && typeof event.item === "object"
          ? (event.item as Record<string, unknown>)
          : null;

      if (type === "response.output_text.delta") {
        const delta = typeof event.delta === "string" ? event.delta : "";
        receivedTextDelta = true;
        text += delta;
        emitToken(delta);
      }

      if (
        type === "response.output_item.added" &&
        item?.type === "function_call"
      ) {
        const callId = String(item.call_id || item.id || "");
        pendingToolCalls.set(callId, {
          name: String(item.name || ""),
          arguments: "",
        });
      }

      if (type === "response.function_call_arguments.delta") {
        const callId = String(event.call_id || event.item_id || "");
        const pending = pendingToolCalls.get(callId);
        if (pending) {
          pending.arguments +=
            typeof event.delta === "string" ? event.delta : "";
        }
      }

      if (
        type === "response.output_item.done" &&
        item?.type === "function_call"
      ) {
        const callId = String(item.call_id || item.id || "");
        const pending = pendingToolCalls.get(callId);
        toolCalls.push({
          id: callId,
          name: String(item.name || pending?.name || ""),
          arguments: String(item.arguments || pending?.arguments || "{}"),
        });
        pendingToolCalls.delete(callId);
      }

      if (
        type === "response.output_item.added" &&
        item?.type === "web_search_call"
      ) {
        webSearchUsed = true;
        if (callbacks.onToolCall) {
          expose(() => callbacks.onToolCall?.({
            id: String(item.id || "web_search"),
            name: "web_search",
            input: {},
          }));
        }
      }

      if (
        type === "response.output_item.done" &&
        item?.type === "web_search_call"
      ) {
        webSearchUsed = true;
        if (callbacks.onToolResult) {
          expose(() => callbacks.onToolResult?.({
            id: String(item.id || "web_search"),
            name: "web_search",
            output: { searched: true, status: item.status || "completed" },
          }));
        }
      }

      if (type === "response.output_item.done" && item) {
        for (const source of extractSources(item)) {
          if (callbacks.onSource) {
            expose(() => callbacks.onSource?.(source));
          }
        }

        if (
          !receivedTextDelta &&
          item.type === "message" &&
          Array.isArray(item.content)
        ) {
          for (const part of item.content) {
            if (
              part &&
              typeof part === "object" &&
              part.type === "output_text" &&
              typeof part.text === "string"
            ) {
              text += part.text;
              emitToken(part.text);
            }
          }
        }
      }

      if (type === "response.failed" || type === "error") {
        terminalError = new Error(
          errorMessage(
            event.error ||
              (event.response &&
              typeof event.response === "object" &&
              "error" in event.response
                ? event.response.error
                : "ChatGPT response failed")
          )
        );
      }
    }
  }

  if (pendingToolCalls.size > 0) {
    throw new CodexStreamReadError(
      "ChatGPT stream ended during a tool call",
      !effectsExposed,
    );
  }
  if (invalidStreamEvent) {
    throw new CodexStreamReadError(
      "ChatGPT sent an invalid stream event",
      !effectsExposed,
    );
  }
  if (terminalError) {
    throw new CodexStreamReadError(
      terminalError.message,
      !effectsExposed,
    );
  }

  try {
    for (const effect of deferredEffects) effect();
  } catch (error) {
    throw new CodexStreamReadError(errorMessage(error), false);
  }

  return { text, toolCalls, webSearchUsed };
}

export async function consumeCodexResponseWithRetry(
  createResponse: () => Promise<Response>,
  callbacks: CodexStreamCallbacks = {},
  retryDelay: (
    milliseconds: number,
    signal?: AbortSignal,
  ) => Promise<void> = abortableDelay,
  deferEffects = false,
): Promise<CodexStreamResult> {
  for (let attempt = 0; attempt <= MAX_REQUEST_RETRIES; attempt += 1) {
    try {
      const response = await createResponse();
      return await consumeCodexResponse(response, callbacks, deferEffects);
    } catch (error) {
      if (isAbortError(error) || callbacks.signal?.aborted) throw error;
      const retrySafe =
        !(error instanceof CodexStreamReadError) || error.retrySafe;
      const retryable =
        retrySafe && retryableCodexTransportError(error);
      const isLastAttempt = attempt === MAX_REQUEST_RETRIES;
      if (!retryable || isLastAttempt) {
        if (retryable && isLastAttempt) {
          throw new Error(
            `ChatGPT response stream was interrupted after ${MAX_REQUEST_RETRIES + 1} attempts: ${errorMessage(error)}`
          );
        }
        throw error;
      }

      await retryDelay(
        Math.min(500 * 2 ** attempt, 2_000),
        callbacks.signal,
      );
    }
  }

  throw new Error("ChatGPT response stream exhausted its retry budget");
}

async function makeCodexRequest(
  model: string,
  input: InputItem[],
  tools: CodexToolDefinition[],
  toolChoice: CodexToolChoice,
  callbacks: Pick<
    CodexChatCallbacks,
    "signal" | "onToken" | "onToolCall" | "onToolResult" | "onSource"
  >,
  instructions = ROBLOX_SYSTEM_PROMPT,
  deferEffects = false,
): Promise<CodexStreamResult> {
  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    throw new Error("Not authenticated with ChatGPT Plus/Pro");
  }

  const auth = getStoredAuth();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  };
  if (auth?.accountId) {
    headers["ChatGPT-Account-Id"] = auth.accountId;
  }

  const requestBody = {
    model,
    instructions,
    input,
    tools,
    tool_choice: toolChoice,
    stream: true,
    store: false,
  };

  return consumeCodexResponseWithRetry(
    () => requestWithRetry(requestBody, headers, callbacks.signal),
    callbacks,
    abortableDelay,
    deferEffects,
  );
}

function parseWorkerOutput(text: string) {
  const unfenced = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  if (start === -1 || end < start) {
    throw new Error("Worker did not return a JSON result");
  }
  return workerOutputSchema.parse(
    JSON.parse(unfenced.slice(start, end + 1)),
  );
}

function createCodexWorkerExecutor(model: string): WorkerExecutor {
  return async (
    assignment: WorkerAssignment,
    context: WorkerExecutionContext,
  ) => {
    const availableTools = {
      ...robloxTools,
      ...skillTools,
    } as unknown as ExecutableToolMap;
    const workerTools = createWorkerToolset(
      assignment.role,
      availableTools,
    ) as ExecutableToolMap;
    const functionTools = convertToolsToOpenAI(workerTools);
    const toolDefinitions: CodexToolDefinition[] =
      assignment.role === "roblox_researcher"
        ? [...functionTools, webSearchTool(false)]
        : functionTools;
    const history: InputItem[] = [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: `${assignment.task}\n\nReturn only JSON matching this schema:\n${JSON.stringify(
              z.toJSONSchema(workerOutputSchema),
            )}`,
          },
        ],
      },
    ];
    const executionContext = {
      runId: context.runId,
      ownerId: context.agentId,
      stepId: context.stepId,
    };
    let lastParseError = "";
    const toolCallBudget = new WorkerToolCallBudget(
      context.limits.maxStepsPerWorker,
    );

    const providerCallLimit = Math.min(
      context.limits.maxStepsPerWorker,
      context.limits.maxProviderCallsPerWorker,
    );
    for (
      let iteration = 0;
      iteration < providerCallLimit;
      iteration += 1
    ) {
      if (context.signal.aborted) {
        throw new DOMException("Worker cancelled", "AbortError");
      }
      const result = await makeCodexRequest(
        model,
        history,
        toolDefinitions,
        "auto",
        { signal: context.signal },
        buildWorkerSystemPrompt(assignment, context),
      );

      if (result.text) {
        history.push({
          role: "assistant",
          content: [{ type: "output_text", text: result.text }],
        });
      }

      if (result.toolCalls.length === 0) {
        try {
          return workerResultFromOutput(
            assignment,
            parseWorkerOutput(result.text),
          );
        } catch (error) {
          lastParseError = errorMessage(error);
          history.push({
            role: "user",
            content: [
              {
                type: "input_text",
                text: `Your result was invalid (${lastParseError}). Return only a complete JSON object matching the requested schema.`,
              },
            ],
          });
          continue;
        }
      }

      await executeCodexWorkerToolCallBatch(
        result.toolCalls,
        toolCallBudget,
        async (toolCall) => {
          history.push({
            type: "function_call",
            call_id: toolCall.id,
            name: toolCall.name,
            arguments: toolCall.arguments,
          });
          const output = await executeTool(
            toolCall,
            context.signal,
            workerTools,
            executionContext,
          );
          history.push({
            type: "function_call_output",
            call_id: toolCall.id,
            output: JSON.stringify(output),
          });
        },
        context.signal,
      );
    }

    throw new Error(
      lastParseError ||
        `Worker stopped after ${providerCallLimit} bounded provider calls`,
    );
  };
}

export async function codexChat(
  model: string,
  messages: CodexMessage[],
  callbacks: CodexChatCallbacks = {}
): Promise<string> {
  const conversationHistory = convertToCodexInput(messages);
  const askMode = callbacks.mode === "ask";
  const workingFunctionTools = convertToolsToOpenAI(
    agentTools as unknown as ExecutableToolMap,
    CODEX_WORKING_TOOL_NAMES,
  );
  let fullText = "";
  let webSearchUsed = false;
  let planContinuationAttempts = 0;
  const toolStepHistory: AgentLoopStep[] = [];
  const unregisterWorkerExecutor = callbacks.runId && !askMode
    ? registerWorkerExecutor(
        callbacks.runId,
        createCodexWorkerExecutor(model),
      )
    : undefined;

  try {
    for (
      let iteration = 0;
      iteration < MAX_AGENT_ITERATIONS;
      iteration += 1
    ) {
      if (callbacks.signal?.aborted) {
        throw new DOMException("Agent run cancelled", "AbortError");
      }

      const needsPlan =
        !askMode && callbacks.planningRequired === true && !hasActivePlan(callbacks.runId);
      const needsForcedSearch =
        callbacks.forceWebSearch === true && !webSearchUsed;
      const needsFinish = !askMode && isPlanReadyToFinish(callbacks.runId);
      const planStillRunning = !askMode && hasRunningPlan(callbacks.runId);
      const tools: CodexToolDefinition[] = askMode
        ? needsForcedSearch
          ? [webSearchTool(callbacks.officialDocsOnly === true)]
          : []
        : needsPlan
        ? convertToolsToOpenAI(
            agentTools as unknown as ExecutableToolMap,
            ["agent_create_plan"],
          )
        : needsFinish && !needsForcedSearch
          ? convertToolsToOpenAI(
              agentTools as unknown as ExecutableToolMap,
              ["agent_finish_plan"],
            )
          : [
              ...workingFunctionTools,
              webSearchTool(callbacks.officialDocsOnly === true),
            ];
      const toolChoice: CodexToolChoice = needsPlan
        ? "required"
        : needsForcedSearch
          ? CODEX_FORCED_WEB_SEARCH_CHOICE
          : planStillRunning
            ? "required"
            : "auto";

      const result = await makeCodexRequest(
        model,
        conversationHistory,
        tools,
        toolChoice,
        callbacks,
        askMode ? ASK_SYSTEM_PROMPT : ROBLOX_SYSTEM_PROMPT,
        !askMode,
      );
      fullText += result.text;
      webSearchUsed ||= result.webSearchUsed;

      if (result.text) {
        conversationHistory.push({
          role: "assistant",
          content: [{ type: "output_text", text: result.text }],
        });
      }

      if (result.toolCalls.length === 0) {
        if (hasRunningPlan(callbacks.runId)) {
          planContinuationAttempts += 1;
          if (planContinuationAttempts > 2) {
            throw new Error(
              "The model stopped before every plan step was resolved and verified"
            );
          }
          conversationHistory.push({
            role: "user",
            content: [
              {
                type: "input_text",
                text: result.webSearchUsed
                  ? "Continue executing and verifying the current plan using the research above. Do not finish with prose; call the required plan and Studio tools."
                  : "The plan is still active. Continue with a required tool call, resolve every step, verify the result, and call agent_finish_plan before answering.",
              },
            ],
          });
          continue;
        }
        callbacks.onFinish?.(fullText);
        return fullText;
      }

      const iterationOutputs: unknown[] = [];
      for (const toolCall of result.toolCalls) {
        conversationHistory.push({
          type: "function_call",
          call_id: toolCall.id,
          name: toolCall.name,
          arguments: toolCall.arguments,
        });

        let displayInput: Record<string, unknown> = {};
        try {
          const parsed = JSON.parse(toolCall.arguments);
          if (parsed && typeof parsed === "object") {
            displayInput = parsed as Record<string, unknown>;
          }
        } catch {
          // Validation below returns the actionable parse error.
        }
        callbacks.onToolCall?.({
          id: toolCall.id,
          name: toolCall.name,
          input: displayInput,
        });

        const output = await executeTool(
          toolCall,
          callbacks.signal,
          agentTools as unknown as ExecutableToolMap,
          { runId: callbacks.runId, ownerId: "coordinator" },
        );
        iterationOutputs.push(output);
        const failure = getToolError(output);
        if (failure) {
          callbacks.onToolError?.({
            id: toolCall.id,
            name: toolCall.name,
            error: failure.message,
            retryable: failure.retryable,
          });
        } else {
          callbacks.onToolResult?.({
            id: toolCall.id,
            name: toolCall.name,
            output,
          });
        }

        conversationHistory.push({
          type: "function_call_output",
          call_id: toolCall.id,
          output: JSON.stringify(output),
        });
      }

      toolStepHistory.push({
        toolResults: iterationOutputs.map((output) => ({ output })),
      });
      const loopStopReason = getAgentLoopStopReason(toolStepHistory);
      if (
        loopStopReason &&
        !(hasActivePlan(callbacks.runId) && !hasRunningPlan(callbacks.runId))
      ) {
        throw new Error(loopStopReason);
      }
    }

    if (hasActivePlan(callbacks.runId) && !hasRunningPlan(callbacks.runId)) {
      callbacks.onFinish?.(fullText);
      return fullText;
    }

    throw new Error(
      `Agent stopped after ${MAX_AGENT_ITERATIONS} steps to prevent an unsafe loop`
    );
  } catch (error) {
    const normalized =
      error instanceof Error ? error : new Error(errorMessage(error));
    callbacks.onError?.(normalized);
    throw normalized;
  } finally {
    if (callbacks.runId) clearDelegationCrew(callbacks.runId);
    unregisterWorkerExecutor?.();
  }
}
