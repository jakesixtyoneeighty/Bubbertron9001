import { tool } from "ai";
import { z } from "zod";
import {
  hasFreshStudioReadback,
  hasStudioEvidenceAfter,
  useAgentStore,
  type AgentPlanStep,
  type PlanStepStatus,
} from "@/stores/agent";

const stepInputSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[a-zA-Z0-9_-]+$/)
    .optional()
    .describe("Stable short ID, such as inspect_scripts or verify_shop"),
  title: z.string().min(1).max(100),
  description: z.string().min(1).max(500),
  tools: z.array(z.string().max(80)).max(12).default([]),
  skillNames: z.array(z.string().max(80)).max(6).default([]),
  successCriteria: z.string().min(1).max(500),
});

const createPlanInputSchema = z.object({
  goal: z.string().min(1).max(500),
  summary: z.string().min(1).max(800),
  steps: z.array(stepInputSchema).min(1).max(8),
});

const updatePlanInputSchema = z.object({
  stepId: z.string().min(1).max(40),
  status: z.enum([
    "pending",
    "in_progress",
    "completed",
    "error",
    "skipped",
  ]),
  notes: z.string().max(800).optional(),
});

const finishPlanInputSchema = z.object({
  summary: z.string().min(1).max(1_200),
  verification: z
    .string()
    .min(1)
    .max(1_200)
    .describe("Concrete read-back, playtest, or source checks that passed"),
  success: z.boolean().default(true),
});

function uniqueStepId(
  requested: string | undefined,
  index: number,
  used: Set<string>
) {
  const base = requested || `step_${index + 1}`;
  let id = base;
  let suffix = 2;
  while (used.has(id)) {
    id = `${base}_${suffix}`;
    suffix += 1;
  }
  used.add(id);
  return id;
}

export const agentCreatePlan = tool({
  description: `Create the visible execution plan before changing Roblox Studio.

Call this first for builds, edits, debugging workflows, or any multi-step task.
Keep the plan focused: inspect, implement, and verify. Include the Roblox skills
and tools each step expects to use.`,
  inputSchema: createPlanInputSchema,
  execute: async ({ goal, summary, steps }) => {
    const used = new Set<string>();
    const normalized: AgentPlanStep[] = steps.map((step, index) => ({
      id: uniqueStepId(step.id, index, used),
      title: step.title,
      description: step.description,
      tools: step.tools,
      skillNames: step.skillNames,
      successCriteria: step.successCriteria,
      status: "pending",
    }));

    useAgentStore.getState().setPlan({ goal, summary, steps: normalized });
    return {
      planned: true,
      goal,
      stepCount: normalized.length,
      steps: normalized,
    };
  },
});

export const agentUpdatePlan = tool({
  description: `Update a plan step while working.

Mark a step in_progress before its main work, completed after read-back
verification, or error when it needs a corrected approach.`,
  inputSchema: updatePlanInputSchema,
  execute: async ({
    stepId,
    status,
    notes,
  }: {
    stepId: string;
    status: PlanStepStatus;
    notes?: string;
  }) => {
    const updated = useAgentStore
      .getState()
      .updateStep(stepId, status, notes);
    if (!updated) {
      return {
        error: `Unknown plan step "${stepId}". Load the current plan and use one of its IDs.`,
        retryable: true,
      };
    }
    return { updated: true, stepId, status, notes };
  },
});

export const agentFinishPlan = tool({
  description: `Finish the plan only after verifying the resulting Studio state.

Report what was verified. If verification failed, set success=false so the
workflow enters repair instead of claiming completion.`,
  inputSchema: finishPlanInputSchema,
  execute: async ({
    summary,
    verification,
    success,
  }: {
    summary: string;
    verification: string;
    success: boolean;
  }) => {
    if (!success) {
      useAgentStore
        .getState()
        .requestRepair(verification || "Verification did not pass");
      return {
        finished: false,
        error: verification || "Verification did not pass",
        retryable: true,
      };
    }

    const plan = useAgentStore.getState().plan;
    const unfinished =
      plan?.steps.filter(
        (step) =>
          step.status !== "completed" && step.status !== "skipped"
      ) || [];
    if (!plan || unfinished.length > 0) {
      const message = !plan
        ? "No active plan exists to finish"
        : `Complete or skip every plan step before finishing: ${unfinished
            .map((step) => step.id)
            .join(", ")}`;
      useAgentStore.getState().requestRepair(message);
      return {
        finished: false,
        error: message,
        retryable: true,
      };
    }

    const {
      studioEvidence: evidence,
      repairEvidenceAfterOrder,
    } = useAgentStore.getState();
    if (!hasStudioEvidenceAfter(evidence, repairEvidenceAfterOrder)) {
      const message =
        "Repair verification is incomplete: no successful Studio mutation or readback completed after the last failed finish attempt. Continue the repair or run a fresh Studio verification, then retry agent_finish_plan.";
      useAgentStore.getState().requestRepair(message);
      return {
        finished: false,
        error: message,
        retryable: true,
      };
    }

    if (!hasFreshStudioReadback(evidence)) {
      const mutation = evidence.lastMutation;
      const message = `Studio verification is incomplete: ${mutation?.toolName || "a mutation"} succeeded, but no successful Studio readback started after it completed. Run roblox_get_script, roblox_get_children, roblox_get_properties, roblox_search, or roblox_get_selection, then retry agent_finish_plan.`;
      useAgentStore.getState().requestRepair(message);
      return {
        finished: false,
        error: message,
        retryable: true,
        evidence: {
          mutationCount: evidence.mutationCount,
          readbackCount: evidence.readbackCount,
          lastMutation: evidence.lastMutation,
          lastReadback: evidence.lastReadback,
        },
      };
    }

    useAgentStore.getState().completeRun(summary, verification);
    return { finished: true, summary, verification };
  },
});

export const planningTools = {
  agent_create_plan: agentCreatePlan,
  agent_update_plan: agentUpdatePlan,
  agent_finish_plan: agentFinishPlan,
};

export {
  beginAgentRun,
  hasActivePlan,
  hasRunningPlan,
  isPlanReadyToFinish,
  shouldCreatePlan,
} from "./run-state";
