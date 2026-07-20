import { beforeEach, describe, expect, it } from "vitest";
import {
  hasFreshStudioReadback,
  hasStudioEvidenceAfter,
  useAgentStore,
} from "../agent";

describe("agent store", () => {
  beforeEach(() => {
    useAgentStore.getState().reset();
  });

  it("moves from planning through execution and completion", () => {
    useAgentStore.getState().beginRun("Build a shop", true);
    expect(useAgentStore.getState().phase).toBe("planning");

    useAgentStore.getState().setPlan({
      goal: "Build a shop",
      summary: "Inspect, build, and verify",
      steps: [
        {
          id: "build",
          title: "Build",
          description: "Create the shop",
          tools: ["roblox_create"],
          skillNames: ["roblox-gui"],
          successCriteria: "Shop exists",
          status: "pending",
        },
      ],
    });
    expect(useAgentStore.getState().phase).toBe("executing");

    expect(
      useAgentStore.getState().updateStep("build", "in_progress")
    ).toBe(true);
    expect(
      useAgentStore.getState().updateStep("build", "completed")
    ).toBe(true);
    useAgentStore.getState().completeRun("Done", "Read back from Studio");

    expect(useAgentStore.getState().phase).toBe("completed");
    expect(useAgentStore.getState().plan?.steps[0].status).toBe("completed");
    expect(useAgentStore.getState().plan?.verification).toBe(
      "Read back from Studio"
    );
  });

  it("rejects updates for unknown steps and records failures", () => {
    useAgentStore.getState().beginRun("Fix a script", true);
    expect(
      useAgentStore.getState().updateStep("missing", "completed")
    ).toBe(false);

    useAgentStore.getState().failRun("Script still errors");
    expect(useAgentStore.getState().phase).toBe("error");
    expect(useAgentStore.getState().lastError).toBe("Script still errors");
  });

  it("keeps append-only run events and rejects stale cross-run updates", () => {
    const firstRun = useAgentStore
      .getState()
      .beginRun("Inspect the first place", true);
    const secondRun = useAgentStore
      .getState()
      .beginRun("Inspect the second place", true);

    const accepted = useAgentStore.getState().setPlan(
      {
        goal: "Stale goal",
        summary: "This plan belongs to the first run",
        steps: [],
      },
      firstRun,
    );

    expect(accepted).toBe(false);
    expect(useAgentStore.getState().runId).toBe(secondRun);
    expect(useAgentStore.getState().events).toMatchObject([
      { runId: firstRun, type: "run_started" },
      { runId: secondRun, type: "run_started" },
    ]);
    expect(
      Object.isFrozen(useAgentStore.getState().events[0]?.details),
    ).toBe(true);
  });

  it("does not accept an overlapping read as post-mutation evidence", () => {
    useAgentStore.getState().beginRun("Change and inspect a part", true);
    const mutation = useAgentStore
      .getState()
      .beginStudioOperation(
        "roblox_set_property",
        "mutation",
        ["properties:game.Workspace.PartA"],
      );
    const overlappingRead = useAgentStore
      .getState()
      .beginStudioOperation(
        "roblox_get_properties",
        "readback",
        ["properties:game.Workspace.PartA"],
      );

    expect(mutation).not.toBeNull();
    expect(overlappingRead).not.toBeNull();
    useAgentStore.getState().completeStudioOperation(mutation!);
    useAgentStore.getState().completeStudioOperation(overlappingRead!);
    expect(
      hasFreshStudioReadback(useAgentStore.getState().studioEvidence)
    ).toBe(false);

    const laterRead = useAgentStore
      .getState()
      .beginStudioOperation(
        "roblox_get_properties",
        "readback",
        ["properties:game.Workspace.PartA"],
      );
    useAgentStore.getState().completeStudioOperation(laterRead!);
    expect(
      hasFreshStudioReadback(useAgentStore.getState().studioEvidence)
    ).toBe(true);
  });

  it("does not accept an in-flight operation as post-repair evidence", () => {
    useAgentStore.getState().beginRun("Repair and recheck a part", true);
    const inFlightRead = useAgentStore
      .getState()
      .beginStudioOperation("roblox_get_properties", "readback");
    expect(inFlightRead).not.toBeNull();

    useAgentStore.getState().requestRepair("Initial verification failed");
    const repairBarrier = useAgentStore.getState().repairEvidenceAfterOrder;
    useAgentStore.getState().completeStudioOperation(inFlightRead!);

    expect(
      hasStudioEvidenceAfter(
        useAgentStore.getState().studioEvidence,
        repairBarrier
      )
    ).toBe(false);

    const freshRead = useAgentStore
      .getState()
      .beginStudioOperation("roblox_get_properties", "readback");
    useAgentStore.getState().completeStudioOperation(freshRead!);
    expect(
      hasStudioEvidenceAfter(
        useAgentStore.getState().studioEvidence,
        repairBarrier
      )
    ).toBe(true);
  });
});
