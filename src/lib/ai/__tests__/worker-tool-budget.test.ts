import { describe, expect, it, vi } from "vitest";
import type { ToolExecutionOptions, ToolSet } from "ai";
import {
  WorkerToolCallBudget,
  WorkerToolCallBudgetError,
  executeCodexWorkerToolCallBatch,
  recordProviderExecutedStandardToolCalls,
  wrapStandardWorkerToolsWithBudget,
} from "../worker-tool-budget";

function executableTool(execute: (value: unknown) => unknown) {
  return {
    inputSchema: {
      _type: undefined,
      jsonSchema: {},
      validate: async (value: unknown) => ({
        success: true as const,
        value,
      }),
    },
    execute,
  } as unknown as ToolSet[string];
}

describe("standard worker tool-call budget", () => {
  it("stops a concurrent batched response before executing overflow calls", async () => {
    const execute = vi.fn(async (value: unknown) => value);
    const budget = new WorkerToolCallBudget(2);
    const tools = wrapStandardWorkerToolsWithBudget(
      { inspect: executableTool(execute) },
      budget,
    );
    const run = tools.inspect.execute as (
      value: unknown,
      options: ToolExecutionOptions,
    ) => Promise<unknown>;

    const results = await Promise.allSettled([
      run("one", { toolCallId: "call_1", messages: [] }),
      run("two", { toolCallId: "call_2", messages: [] }),
      run("three", { toolCallId: "call_3", messages: [] }),
    ]);

    expect(results.map((result) => result.status)).toEqual([
      "fulfilled",
      "fulfilled",
      "rejected",
    ]);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(budget.used).toBe(2);
    expect(() => budget.assertNotExceeded()).toThrow(
      WorkerToolCallBudgetError,
    );
  });

  it("counts provider-executed calls against the same total", () => {
    const budget = new WorkerToolCallBudget(2);
    budget.consume("skill_search");

    expect(() =>
      recordProviderExecutedStandardToolCalls(
        [
          { toolName: "web_search", providerExecuted: true },
          { toolName: "web_search", providerExecuted: true },
        ],
        budget,
      ),
    ).toThrow(WorkerToolCallBudgetError);
    expect(budget.used).toBe(2);
  });
});

describe("Codex worker tool-call budget", () => {
  it("counts calls across responses and stops before a batched overflow", async () => {
    const execute = vi.fn(async (_call: { name: string }) => undefined);
    const budget = new WorkerToolCallBudget(3);

    await executeCodexWorkerToolCallBatch(
      [{ name: "first" }, { name: "second" }],
      budget,
      execute,
    );
    await expect(
      executeCodexWorkerToolCallBatch(
        [{ name: "third" }, { name: "overflow" }],
        budget,
        execute,
      ),
    ).rejects.toMatchObject({
      code: "WORKER_TOOL_CALL_LIMIT",
      limit: 3,
      toolName: "overflow",
    });

    expect(execute.mock.calls.map(([call]) => call.name)).toEqual([
      "first",
      "second",
      "third",
    ]);
    expect(budget.used).toBe(3);
  });
});
