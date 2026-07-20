import { beforeEach, describe, expect, it } from "vitest";
import {
  agentCreatePlan,
  agentFinishPlan,
  agentUpdatePlan,
} from "@/lib/agent/planning";
import { useAgentStore } from "@/stores/agent";
import { getStandardStepPolicy } from "../providers";

function execute(
  agentTool: unknown,
  input: Record<string, unknown>
): Promise<unknown> {
  return (
    agentTool as {
      execute: (value: Record<string, unknown>) => Promise<unknown>;
    }
  ).execute(input);
}

describe("standard provider repair policy", () => {
  beforeEach(() => {
    useAgentStore.getState().reset();
    useAgentStore.getState().beginRun("Repair an obby", true);
  });

  it("reopens working tools after failed finish and withholds finish until fresh evidence", async () => {
    await execute(agentCreatePlan, {
      goal: "Repair an obby",
      summary: "Inspect, repair, and verify",
      steps: [
        {
          id: "repair",
          title: "Repair platforms",
          description: "Correct platform spacing",
          tools: ["roblox_set_property", "roblox_get_properties"],
          skillNames: ["roblox-building"],
          successCriteria: "Spacing is correct",
        },
      ],
    });
    await execute(agentUpdatePlan, {
      stepId: "repair",
      status: "completed",
    });

    const initialReadback = useAgentStore
      .getState()
      .beginStudioOperation("roblox_get_properties", "readback");
    useAgentStore.getState().completeStudioOperation(initialReadback!);
    await execute(agentFinishPlan, {
      summary: "Repair did not pass",
      verification: "Spacing is still wrong",
      success: false,
    });

    const toolNames = [
      "roblox_set_property",
      "roblox_get_properties",
      "agent_update_plan",
      "agent_finish_plan",
    ];
    const repairPolicy = getStandardStepPolicy({
      steps: [],
      planningRequired: true,
      forceWebSearch: false,
      toolNames,
    });
    expect(repairPolicy).toMatchObject({ toolChoice: "required" });
    expect(repairPolicy.activeTools).toContain("roblox_set_property");
    expect(repairPolicy.activeTools).toContain("roblox_get_properties");
    expect(repairPolicy.activeTools).not.toContain("agent_finish_plan");

    const freshReadback = useAgentStore
      .getState()
      .beginStudioOperation("roblox_get_properties", "readback");
    useAgentStore.getState().completeStudioOperation(freshReadback!);

    expect(
      getStandardStepPolicy({
        steps: [],
        planningRequired: true,
        forceWebSearch: false,
        toolNames,
      })
    ).toEqual({
      activeTools: ["agent_finish_plan"],
      toolChoice: {
        type: "tool",
        toolName: "agent_finish_plan",
      },
    });
  });
});
