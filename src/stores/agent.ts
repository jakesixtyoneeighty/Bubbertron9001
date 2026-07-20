import { create } from "zustand";

export type AgentPhase =
  | "idle"
  | "planning"
  | "executing"
  | "verifying"
  | "repairing"
  | "completed"
  | "error"
  | "cancelled";

export type PlanStepStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "error"
  | "skipped";

export interface AgentPlanStep {
  id: string;
  title: string;
  description: string;
  tools: string[];
  skillNames: string[];
  successCriteria: string;
  status: PlanStepStatus;
  notes?: string;
}

export interface AgentPlan {
  goal: string;
  summary: string;
  steps: AgentPlanStep[];
  createdAt: number;
  completedAt?: number;
  completionSummary?: string;
  verification?: string;
}

export type StudioEvidenceKind = "mutation" | "readback";

export interface StudioEvidenceEvent {
  runId: string;
  toolName: string;
  kind: StudioEvidenceKind;
  startedOrder: number;
  completedOrder: number;
}

export interface StudioOperationToken {
  runId: string;
  toolName: string;
  kind: StudioEvidenceKind;
  startedOrder: number;
}

export interface StudioRunEvidence {
  clock: number;
  mutationCount: number;
  readbackCount: number;
  lastMutation: StudioEvidenceEvent | null;
  lastReadback: StudioEvidenceEvent | null;
}

const initialStudioEvidence: StudioRunEvidence = {
  clock: 0,
  mutationCount: 0,
  readbackCount: 0,
  lastMutation: null,
  lastReadback: null,
};

export function hasFreshStudioReadback(evidence: StudioRunEvidence) {
  if (!evidence.lastMutation) return true;
  return Boolean(
    evidence.lastReadback &&
      evidence.lastReadback.startedOrder >
        evidence.lastMutation.completedOrder
  );
}

export function hasStudioEvidenceAfter(
  evidence: StudioRunEvidence,
  startedAfterOrder: number | null
) {
  if (startedAfterOrder === null) return true;
  return Boolean(
    (evidence.lastMutation &&
      evidence.lastMutation.startedOrder > startedAfterOrder) ||
      (evidence.lastReadback &&
        evidence.lastReadback.startedOrder > startedAfterOrder)
  );
}

interface AgentState {
  runId: string | null;
  phase: AgentPhase;
  plan: AgentPlan | null;
  studioEvidence: StudioRunEvidence;
  repairEvidenceAfterOrder: number | null;
  planningRequired: boolean;
  lastError: string | null;
  beginRun: (goal: string, planningRequired: boolean) => string;
  setPlan: (plan: Omit<AgentPlan, "createdAt">) => void;
  updateStep: (
    stepId: string,
    status: PlanStepStatus,
    notes?: string
  ) => boolean;
  setPhase: (phase: AgentPhase) => void;
  beginStudioOperation: (
    toolName: string,
    kind: StudioEvidenceKind
  ) => StudioOperationToken | null;
  completeStudioOperation: (token: StudioOperationToken) => boolean;
  completeRun: (summary: string, verification?: string) => void;
  requestRepair: (message: string) => void;
  failRun: (message: string) => void;
  cancelRun: () => void;
  reset: () => void;
}

const initialState = {
  runId: null,
  phase: "idle" as AgentPhase,
  plan: null,
  studioEvidence: initialStudioEvidence,
  repairEvidenceAfterOrder: null,
  planningRequired: false,
  lastError: null,
};

let fallbackRunCounter = 0;

function createRunId() {
  fallbackRunCounter += 1;
  return (
    crypto.randomUUID?.() ??
    `run_${Date.now().toString(36)}_${fallbackRunCounter.toString(36)}`
  );
}

export const useAgentStore = create<AgentState>()((set, get) => ({
  ...initialState,

  beginRun: (_goal, planningRequired) => {
    const runId = createRunId();
    set({
      runId,
      phase: planningRequired ? "planning" : "executing",
      plan: null,
      studioEvidence: initialStudioEvidence,
      repairEvidenceAfterOrder: null,
      planningRequired,
      lastError: null,
    });
    return runId;
  },

  setPlan: (plan) => {
    set({
      plan: {
        ...plan,
        createdAt: Date.now(),
      },
      phase: "executing",
      lastError: null,
    });
  },

  updateStep: (stepId, status, notes) => {
    const current = get().plan;
    if (!current || !current.steps.some((step) => step.id === stepId)) {
      return false;
    }

    const phase =
      status === "error"
        ? "repairing"
        : status === "in_progress"
          ? "executing"
          : get().phase;

    set({
      phase,
      plan: {
        ...current,
        steps: current.steps.map((step) =>
          step.id === stepId
            ? { ...step, status, notes: notes ?? step.notes }
            : step
        ),
      },
    });
    return true;
  },

  setPhase: (phase) => set({ phase }),

  beginStudioOperation: (toolName, kind) => {
    const { runId, studioEvidence } = get();
    if (!runId) return null;

    const startedOrder = studioEvidence.clock + 1;
    set({
      studioEvidence: {
        ...studioEvidence,
        clock: startedOrder,
      },
    });
    return { runId, toolName, kind, startedOrder };
  },

  completeStudioOperation: (token) => {
    const { runId, studioEvidence } = get();
    if (!runId || runId !== token.runId) return false;

    const completedOrder = studioEvidence.clock + 1;
    const event: StudioEvidenceEvent = {
      ...token,
      completedOrder,
    };

    if (token.kind === "mutation") {
      set({
        studioEvidence: {
          ...studioEvidence,
          clock: completedOrder,
          mutationCount: studioEvidence.mutationCount + 1,
          lastMutation: event,
        },
      });
      return true;
    }

    const lastReadback =
      !studioEvidence.lastReadback ||
      event.startedOrder > studioEvidence.lastReadback.startedOrder
        ? event
        : studioEvidence.lastReadback;
    set({
      studioEvidence: {
        ...studioEvidence,
        clock: completedOrder,
        readbackCount: studioEvidence.readbackCount + 1,
        lastReadback,
      },
    });
    return true;
  },

  completeRun: (summary, verification) => {
    const current = get().plan;
    set({
      phase: "completed",
      plan: current
        ? {
            ...current,
            completedAt: Date.now(),
            completionSummary: summary,
            verification,
          }
        : null,
      repairEvidenceAfterOrder: null,
      lastError: null,
    });
  },

  requestRepair: (message) => {
    const { studioEvidence } = get();
    set({
      phase: "repairing",
      repairEvidenceAfterOrder: studioEvidence.clock,
      lastError: message,
    });
  },

  failRun: (message) => set({ phase: "error", lastError: message }),

  cancelRun: () => set({ phase: "cancelled" }),

  reset: () => set(initialState),
}));
