import { beforeEach, describe, expect, it } from "vitest";
import {
  agentCreatePlan,
  agentFinishPlan,
  agentUpdatePlan,
  hasRunningPlan,
  isPlanReadyToFinish,
  shouldCreatePlan,
} from "../planning";
import { useAgentStore } from "@/stores/agent";

function execute(
  agentTool: unknown,
  input: Record<string, unknown>
): Promise<unknown> {
  const candidate = agentTool as {
    execute: (value: Record<string, unknown>) => Promise<unknown>;
  };
  return candidate.execute(input);
}

describe("planning tools", () => {
  beforeEach(() => {
    useAgentStore.getState().reset();
    useAgentStore.getState().beginRun("Build an obby", true);
  });

  it("creates, updates, and finishes a visible plan", async () => {
    await execute(agentCreatePlan, {
      goal: "Build an obby",
      summary: "Create and verify platforms",
      steps: [
        {
          id: "build",
          title: "Build platforms",
          description: "Create five platforms",
          tools: ["roblox_bulk_create"],
          skillNames: ["roblox-building"],
          successCriteria: "Five platforms exist",
        },
      ],
    });

    expect(useAgentStore.getState().plan?.steps).toHaveLength(1);

    await execute(agentUpdatePlan, {
      stepId: "build",
      status: "completed",
      notes: "Five platforms read back",
    });
    expect(useAgentStore.getState().plan?.steps[0].status).toBe("completed");
    expect(hasRunningPlan()).toBe(true);
    expect(isPlanReadyToFinish()).toBe(true);

    await execute(agentFinishPlan, {
      summary: "Obby created",
      verification: "Five platforms are present",
      success: true,
    });
    expect(useAgentStore.getState().phase).toBe("completed");
    expect(hasRunningPlan()).toBe(false);
    expect(isPlanReadyToFinish()).toBe(false);
  });

  it("plans mutating and long tasks while allowing simple questions", () => {
    expect(shouldCreatePlan("What does TweenService do?")).toBe(false);
    expect(shouldCreatePlan("Create a secure currency saving system")).toBe(
      true
    );
    expect(shouldCreatePlan("A simple question", true)).toBe(true);
  });

  it("refuses to finish while plan steps are unresolved", async () => {
    await execute(agentCreatePlan, {
      goal: "Build an obby",
      summary: "Create and verify platforms",
      steps: [
        {
          id: "build",
          title: "Build platforms",
          description: "Create five platforms",
          tools: ["roblox_bulk_create"],
          skillNames: ["roblox-building"],
          successCriteria: "Five platforms exist",
        },
      ],
    });

    const result = await execute(agentFinishPlan, {
      summary: "Obby created",
      verification: "Five platforms are present",
      success: true,
    });

    expect(result).toMatchObject({ finished: false, retryable: true });
    expect(useAgentStore.getState().phase).toBe("repairing");
    expect(hasRunningPlan()).toBe(true);
    expect(useAgentStore.getState().plan?.steps[0].status).toBe("pending");
  });

  it("requires fresh successful Studio evidence after failed verification", async () => {
    await execute(agentCreatePlan, {
      goal: "Build an obby",
      summary: "Create and verify platforms",
      steps: [
        {
          id: "build",
          title: "Build platforms",
          description: "Create five platforms",
          tools: ["roblox_bulk_create"],
          skillNames: ["roblox-building"],
          successCriteria: "Five platforms exist",
        },
      ],
    });
    await execute(agentUpdatePlan, {
      stepId: "build",
      status: "completed",
      notes: "Initial verification ran",
    });

    const mutation = useAgentStore
      .getState()
      .beginStudioOperation("roblox_bulk_create", "mutation");
    expect(mutation).not.toBeNull();
    useAgentStore.getState().completeStudioOperation(mutation!);
    const readback = useAgentStore
      .getState()
      .beginStudioOperation("roblox_get_children", "readback");
    expect(readback).not.toBeNull();
    useAgentStore.getState().completeStudioOperation(readback!);
    expect(isPlanReadyToFinish()).toBe(true);

    await execute(agentFinishPlan, {
      summary: "Verification failed",
      verification: "The expected platform spacing was wrong",
      success: false,
    });

    expect(useAgentStore.getState().phase).toBe("repairing");
    expect(isPlanReadyToFinish()).toBe(false);

    const prematureRetry = await execute(agentFinishPlan, {
      summary: "Obby created",
      verification: "No new verification was run",
      success: true,
    });
    expect(prematureRetry).toMatchObject({
      finished: false,
      retryable: true,
    });

    const repairReadback = useAgentStore
      .getState()
      .beginStudioOperation("roblox_get_children", "readback");
    expect(repairReadback).not.toBeNull();
    useAgentStore.getState().completeStudioOperation(repairReadback!);
    expect(isPlanReadyToFinish()).toBe(true);

    await execute(agentFinishPlan, {
      summary: "Obby verified",
      verification: "Fresh platform readback passed",
      success: true,
    });
    expect(useAgentStore.getState().phase).toBe("completed");
  });

  it("returns failed verification to the repair loop", async () => {
    const result = await execute(agentFinishPlan, {
      summary: "Verification failed",
      verification: "The expected part was not present",
      success: false,
    });

    expect(result).toMatchObject({ finished: false, retryable: true });
    expect(useAgentStore.getState().phase).toBe("repairing");
    expect(useAgentStore.getState().lastError).toBe(
      "The expected part was not present",
    );
  });
});
