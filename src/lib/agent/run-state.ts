import {
  hasFreshStudioReadback,
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
  useAgentStore.getState().beginRun(message, planningRequired);
  return planningRequired;
}

export function hasActivePlan() {
  return useAgentStore.getState().plan !== null;
}

export function hasRunningPlan() {
  const { plan, phase } = useAgentStore.getState();
  return (
    plan !== null &&
    phase !== "completed" &&
    phase !== "error" &&
    phase !== "cancelled"
  );
}

export function isPlanReadyToFinish() {
  const {
    plan,
    phase,
    studioEvidence,
    repairEvidenceAfterOrder,
  } = useAgentStore.getState();
  return (
    plan !== null &&
    phase !== "completed" &&
    phase !== "error" &&
    phase !== "cancelled" &&
    hasStudioEvidenceAfter(studioEvidence, repairEvidenceAfterOrder) &&
    hasFreshStudioReadback(studioEvidence) &&
    plan.steps.every(
      (step) => step.status === "completed" || step.status === "skipped"
    )
  );
}
