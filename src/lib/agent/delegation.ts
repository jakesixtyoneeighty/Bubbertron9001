import { tool, type ToolExecutionOptions } from "ai";
import { z } from "zod";
import { useAgentStore } from "@/stores/agent";
import {
  ReadonlySubagentCoordinator,
  SubagentPolicyError,
  type CoordinatorContext,
  type WorkerRequest,
} from "./subagents";
import { getWorkerExecutor } from "./worker-runtime";

const workerRequestSchema = z.object({
  workerId: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[a-zA-Z0-9_-]+$/)
    .describe("Stable short worker ID, such as explorer or reviewer"),
  role: z.enum([
    "studio_explorer",
    "roblox_researcher",
    "plan_reviewer",
  ]),
  stepId: z.string().min(1).max(40),
  task: z.string().min(1).max(2_000),
});

const delegateInputSchema = z.object({
  workers: z.array(workerRequestSchema).min(1).max(2),
});

const manageWorkersInputSchema = z.object({
  action: z.enum(["retry", "dismiss", "surface"]),
  workerId: z.string().min(1).max(40).optional(),
  reason: z.string().min(1).max(2_000).optional(),
});

const activeCrews = new Map<string, ReadonlySubagentCoordinator>();

export function clearDelegationCrew(runId?: string) {
  if (runId) {
    activeCrews.get(runId)?.dispose();
    activeCrews.delete(runId);
    return;
  }
  for (const crew of activeCrews.values()) crew.dispose();
  activeCrews.clear();
}

function toolContext(options?: ToolExecutionOptions) {
  const candidate =
    options?.experimental_context &&
    typeof options.experimental_context === "object"
      ? (options.experimental_context as Record<string, unknown>)
      : {};
  return {
    runId:
      typeof candidate.runId === "string"
        ? candidate.runId
        : useAgentStore.getState().runId,
    ownerId:
      typeof candidate.ownerId === "string"
        ? candidate.ownerId
        : "coordinator",
  };
}

export const agentDelegate = tool({
  description: `Delegate bounded, read-only work to one or two visible workers.

Use this only after creating the root plan. Studio Explorer may inspect Studio,
Roblox Researcher may search skills or the web, and Plan Reviewer may review the
plan. Workers cannot ask questions, change Studio, update or finish the root
plan, or create more workers. Their typed results return to the coordinator in
the same order they were assigned.`,
  inputSchema: delegateInputSchema,
  execute: async (
    { workers }: { workers: WorkerRequest[] },
    options?: ToolExecutionOptions,
  ) => {
    const context = toolContext(options);
    const state = useAgentStore.getState();
    if (
      !context.runId ||
      context.runId !== state.runId ||
      context.ownerId !== "coordinator"
    ) {
      return {
        error: "Only the active coordinator can delegate workers",
        retryable: false,
      };
    }
    if (!state.plan) {
      return {
        error: "Create the root plan before delegating workers",
        retryable: true,
      };
    }
    if (state.workers.length > 0) {
      return {
        error: "This run already assigned its bounded worker crew",
        retryable: false,
      };
    }

    const stepIds = new Set(state.plan.steps.map((step) => step.id));
    const unknownSteps = workers
      .map((worker) => worker.stepId)
      .filter((stepId) => !stepIds.has(stepId));
    if (unknownSteps.length > 0) {
      return {
        error: `Workers reference unknown plan steps: ${unknownSteps.join(", ")}`,
        retryable: true,
      };
    }

    const executor = getWorkerExecutor(context.runId);
    if (!executor) {
      return {
        error: "The selected provider did not initialize worker execution",
        retryable: true,
      };
    }

    const coordinatorContext: CoordinatorContext = {
      kind: "coordinator",
      runId: context.runId,
      agentId: "coordinator",
      planId: state.plan.id,
      depth: 0,
    };
    const coordinator = new ReadonlySubagentCoordinator(coordinatorContext, {
      parentSignal: options?.abortSignal,
      onWorkersChanged: (snapshots) => {
        useAgentStore.getState().setWorkers(context.runId!, snapshots);
      },
    });
    activeCrews.set(context.runId, coordinator);

    try {
      const merged = await coordinator.run(workers, executor);
      if (!useAgentStore.getState().setWorkerMerge(context.runId, merged)) {
        clearDelegationCrew(context.runId);
        return {
          error: "Worker results arrived after their root run was replaced",
          retryable: false,
        };
      }
      return merged;
    } catch (error) {
      clearDelegationCrew(context.runId);
      return {
        error:
          error instanceof Error ? error.message : "Worker delegation failed",
        retryable: error instanceof SubagentPolicyError,
      };
    }
  },
});

export const agentManageWorkers = tool({
  description: `Resolve a worker result after delegation.

Retry a failed or timed-out worker once, dismiss a terminal result with a clear
reason, or explicitly surface the current failure to continue with the lead.
Only the active coordinator can manage the crew.`,
  inputSchema: manageWorkersInputSchema,
  execute: async (
    input: z.infer<typeof manageWorkersInputSchema>,
    options?: ToolExecutionOptions,
  ) => {
    const context = toolContext(options);
    const state = useAgentStore.getState();
    if (
      !context.runId ||
      context.runId !== state.runId ||
      context.ownerId !== "coordinator"
    ) {
      return {
        error: "Only the active coordinator can manage workers",
        retryable: false,
      };
    }

    const coordinator = activeCrews.get(context.runId);
    if (!coordinator) {
      return {
        error: "No worker crew is available for this run",
        retryable: false,
      };
    }

    try {
      if (input.action === "retry") {
        if (!input.workerId) {
          return { error: "Retry requires a workerId", retryable: true };
        }
        const executor = getWorkerExecutor(context.runId);
        if (!executor) {
          return {
            error: "The selected provider is no longer available for retry",
            retryable: false,
          };
        }
        await coordinator.retry(input.workerId, executor);
      } else if (input.action === "dismiss") {
        if (!input.workerId || !input.reason) {
          return {
            error: "Dismiss requires a workerId and reason",
            retryable: true,
          };
        }
        coordinator.dismiss(input.workerId, input.reason);
      }

      const workers = coordinator.getWorkerSnapshots();
      const merged = coordinator.mergeResults();
      useAgentStore.getState().setWorkers(context.runId, workers);
      if (!useAgentStore.getState().setWorkerMerge(context.runId, merged)) {
        return {
          error: "Worker results belong to a stale or different run",
          retryable: false,
        };
      }
      return merged;
    } catch (error) {
      return {
        error:
          error instanceof Error ? error.message : "Worker management failed",
        retryable:
          error instanceof SubagentPolicyError &&
          error.code !== "RUN_CANCELLED" &&
          error.code !== "MAX_ATTEMPTS",
      };
    }
  },
});

export const delegationTools = {
  agent_delegate: agentDelegate,
  agent_manage_workers: agentManageWorkers,
};
