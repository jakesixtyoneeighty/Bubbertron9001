import {
  hasFreshStudioReadback,
  hasSettledWorkerCrew,
  hasStudioEvidenceAfter,
  useAgentStore,
} from "@/stores/agent";

const COMPLEX_TASK_PATTERN =
  /\b(add|build|change|create|debug|delete|design|edit|fix|implement|insert|make|migrate|move|optimi[sz]e|publish|refactor|remove|replace|review|set up|update|write)\b/i;

export function shouldCreatePlan(message: string, forced = false) {
  if (forced) return true;
  const trimmed = message.trim();
  return (
    COMPLEX_TASK_PATTERN.test(trimmed) ||
    trimmed.length > 240 ||
    trimmed.split(/\s+/).length > 40
  );
}

export function beginAgentRun(
  message: string,
  planningRequired = shouldCreatePlan(message)
) {
  return useAgentStore.getState().beginRun(message, planningRequired);
}

export function hasActivePlan(expectedRunId?: string) {
  const { runId, plan } = useAgentStore.getState();
  return (!expectedRunId || runId === expectedRunId) && plan !== null;
}

export function hasRunningPlan(expectedRunId?: string) {
  const { runId, plan, phase } = useAgentStore.getState();
  return (
    (!expectedRunId || runId === expectedRunId) &&
    plan !== null &&
    phase !== "completed" &&
    phase !== "error" &&
    phase !== "cancelled"
  );
}

export function isPlanReadyToFinish(expectedRunId?: string) {
  const {
    runId,
    plan,
    phase,
    studioEvidence,
    repairEvidenceAfterOrder,
    workers,
    workerMerge,
  } = useAgentStore.getState();
  return (
    (!expectedRunId || runId === expectedRunId) &&
    plan !== null &&
    phase !== "completed" &&
    phase !== "error" &&
    phase !== "cancelled" &&
    hasSettledWorkerCrew(workers, workerMerge) &&
    hasStudioEvidenceAfter(studioEvidence, repairEvidenceAfterOrder) &&
    hasFreshStudioReadback(studioEvidence) &&
    plan.steps.every(
      (step) => step.status === "completed" || step.status === "skipped"
    )
  );
}
