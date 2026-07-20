import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAgentStore } from "@/stores/agent";
import {
  agentDelegate,
  agentManageWorkers,
  clearDelegationCrew,
} from "../delegation";
import { createWorkerResult, type WorkerExecutor } from "../subagents";
import {
  clearWorkerExecutors,
  registerWorkerExecutor,
} from "../worker-runtime";

function executeTool(
  definition: unknown,
  input: Record<string, unknown>,
  runId: string,
) {
  const candidate = definition as {
    execute: (
      value: Record<string, unknown>,
      options: Record<string, unknown>,
    ) => Promise<unknown>;
  };
  return candidate.execute(input, {
    experimental_context: { runId, ownerId: "coordinator" },
  });
}

function startRun() {
  const runId = useAgentStore.getState().beginRun("Inspect Studio", true);
  useAgentStore.getState().setPlan(
    {
      goal: "Inspect Studio",
      summary: "Use one bounded worker",
      steps: [
        {
          id: "inspect",
          title: "Inspect",
          description: "Inspect the relevant hierarchy",
          tools: ["roblox_get_children"],
          skillNames: [],
          successCriteria: "The hierarchy is understood",
          status: "pending",
        },
      ],
    },
    runId,
  );
  return runId;
}

const request = {
  workerId: "explorer",
  role: "studio_explorer",
  stepId: "inspect",
  task: "Inspect the current hierarchy",
} as const;

describe("delegation tools", () => {
  beforeEach(() => {
    useAgentStore.getState().reset();
    clearDelegationCrew();
    clearWorkerExecutors();
  });

  afterEach(() => {
    clearDelegationCrew();
    clearWorkerExecutors();
  });

  it("lets the active coordinator retry a surfaced worker failure", async () => {
    const runId = startRun();
    const executor = vi
      .fn<WorkerExecutor>()
      .mockRejectedValueOnce(new Error("Temporary provider failure"))
      .mockImplementationOnce(async (assignment) =>
        createWorkerResult(assignment, {
          summary: "Inspection completed after retry",
        }),
      );
    registerWorkerExecutor(runId, executor);

    await expect(
      executeTool(agentDelegate, { workers: [request] }, runId),
    ).resolves.toMatchObject({
      status: "failed",
      results: [{ status: "failed" }],
    });
    await expect(
      executeTool(
        agentManageWorkers,
        { action: "retry", workerId: "explorer" },
        runId,
      ),
    ).resolves.toMatchObject({
      status: "completed",
      results: [{ status: "completed" }],
    });
    expect(executor).toHaveBeenCalledTimes(2);
    expect(useAgentStore.getState().workers[0]?.attempts).toBe(2);
  });

  it("can dismiss a terminal failure while preserving its visible disposition", async () => {
    const runId = startRun();
    registerWorkerExecutor(runId, async () => {
      throw new Error("Review unavailable");
    });

    await executeTool(agentDelegate, { workers: [request] }, runId);
    await expect(
      executeTool(
        agentManageWorkers,
        {
          action: "dismiss",
          workerId: "explorer",
          reason: "The lead completed the inspection directly",
        },
        runId,
      ),
    ).resolves.toMatchObject({
      status: "partial",
      results: [{ status: "dismissed" }],
      dispositions: [{ workerId: "explorer", disposition: "dismissed" }],
    });
  });

  it("rejects worker management from a stale run", async () => {
    const runId = startRun();
    const result = await executeTool(
      agentManageWorkers,
      { action: "surface" },
      `${runId}_stale`,
    );
    expect(result).toEqual({
      error: "Only the active coordinator can manage workers",
      retryable: false,
    });
  });
});
