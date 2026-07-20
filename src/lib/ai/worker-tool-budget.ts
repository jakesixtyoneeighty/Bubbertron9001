import type { ToolExecutionOptions, ToolSet } from "ai";

interface NamedToolCall {
  name: string;
}

interface StandardToolCall {
  toolName: string;
  providerExecuted?: boolean;
}

type UnknownToolExecute = (
  input: unknown,
  options: ToolExecutionOptions,
) => unknown | PromiseLike<unknown>;

export class WorkerToolCallBudgetError extends Error {
  readonly code = "WORKER_TOOL_CALL_LIMIT" as const;
  readonly limit: number;
  readonly toolName: string;

  constructor(limit: number, toolName: string) {
    super(
      `Worker tool-call limit of ${limit} was reached before ${toolName}`,
    );
    this.name = "WorkerToolCallBudgetError";
    this.limit = limit;
    this.toolName = toolName;
  }
}

/**
 * Counts actual tool-call attempts across every provider response in one worker
 * execution. Overflow attempts fail before a local tool implementation runs.
 */
export class WorkerToolCallBudget {
  readonly limit: number;

  private consumed = 0;
  private overflowToolName: string | null = null;

  constructor(limit: number) {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error("Worker tool-call limit must be a positive integer");
    }
    this.limit = limit;
  }

  get used() {
    return this.consumed;
  }

  consume(toolName: string) {
    if (this.consumed >= this.limit) {
      this.overflowToolName ??= toolName;
      throw new WorkerToolCallBudgetError(this.limit, toolName);
    }
    this.consumed += 1;
  }

  assertNotExceeded() {
    if (this.overflowToolName) {
      throw new WorkerToolCallBudgetError(
        this.limit,
        this.overflowToolName,
      );
    }
  }
}

/** Wrap client-executed AI SDK tools so batched calls share one hard budget. */
export function wrapStandardWorkerToolsWithBudget(
  tools: ToolSet,
  budget: WorkerToolCallBudget,
): ToolSet {
  return Object.fromEntries(
    Object.entries(tools).map(([toolName, definition]) => {
      const candidate = definition as ToolSet[string] & {
        execute?: UnknownToolExecute;
      };
      const execute = candidate.execute;
      if (typeof execute !== "function") return [toolName, definition];

      return [
        toolName,
        {
          ...definition,
          execute: async (input: unknown, options: ToolExecutionOptions) => {
            budget.consume(toolName);
            return await execute(input, options);
          },
        },
      ];
    }),
  ) as ToolSet;
}

/** Provider-executed tools have no client execute callback, so count them once
 * the provider reports the completed step. */
export function recordProviderExecutedStandardToolCalls(
  calls: readonly StandardToolCall[],
  budget: WorkerToolCallBudget,
) {
  for (const call of calls) {
    if (call.providerExecuted === true) budget.consume(call.toolName);
  }
}

/** Execute a Codex function-call batch in response order, stopping before the
 * first call that would exceed the worker's total budget. */
export async function executeCodexWorkerToolCallBatch<T extends NamedToolCall>(
  calls: readonly T[],
  budget: WorkerToolCallBudget,
  execute: (call: T) => Promise<void>,
  signal?: AbortSignal,
) {
  for (const call of calls) {
    if (signal?.aborted) {
      throw new DOMException("Worker cancelled", "AbortError");
    }
    budget.consume(call.name);
    await execute(call);
  }
}
