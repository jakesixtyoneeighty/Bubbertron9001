import { create } from "zustand";
import {
  isWorkerTerminalState,
  type MergedWorkerResult,
  type WorkerRecordSnapshot,
} from "@/lib/agent/subagents";

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
  id: string;
  goal: string;
  summary: string;
  steps: AgentPlanStep[];
  createdAt: number;
  completedAt?: number;
  completionSummary?: string;
  verification?: string;
}

export type AgentEventType =
  | "run_started"
  | "plan_created"
  | "plan_step_updated"
  | "workers_updated"
  | "workers_merged"
  | "studio_operation_started"
  | "studio_operation_completed"
  | "repair_requested"
  | "run_completed"
  | "run_failed"
  | "run_cancelled";

export interface AgentEvent {
  id: string;
  runId: string;
  ownerId: string;
  type: AgentEventType;
  timestamp: number;
  details: Readonly<Record<string, string | number | boolean | null>>;
}

export type StudioEvidenceKind = "mutation" | "readback";

export interface StudioEvidenceEvent {
  runId: string;
  operationId: string;
  ownerId: "coordinator";
  toolName: string;
  kind: StudioEvidenceKind;
  resourceKeys: readonly string[];
  status: "passed";
  startedOrder: number;
  completedOrder: number;
}

export interface StudioOperationToken {
  runId: string;
  operationId: string;
  ownerId: "coordinator";
  toolName: string;
  kind: StudioEvidenceKind;
  resourceKeys: readonly string[];
  startedOrder: number;
}

export interface StudioRunEvidence {
  clock: number;
  mutationCount: number;
  readbackCount: number;
  lastMutation: StudioEvidenceEvent | null;
  lastReadback: StudioEvidenceEvent | null;
  events: readonly StudioEvidenceEvent[];
}

const initialStudioEvidence: StudioRunEvidence = {
  clock: 0,
  mutationCount: 0,
  readbackCount: 0,
  lastMutation: null,
  lastReadback: null,
  events: [],
};

function parseResourceKey(resourceKey: string) {
  const separator = resourceKey.indexOf(":");
  if (separator < 1) return { scope: "exact", value: resourceKey };
  return {
    scope: resourceKey.slice(0, separator),
    value: resourceKey.slice(separator + 1),
  };
}

function readbackCoversResource(readbackKey: string, mutationKey: string) {
  if (readbackKey === mutationKey) return true;
  const readback = parseResourceKey(readbackKey);
  const mutation = parseResourceKey(mutationKey);
  if (mutation.scope === "studio" && mutation.value === "any") {
    return readback.scope !== "studio" || readback.value !== "playtest";
  }
  if (readback.scope !== "tree") return false;
  if (mutation.scope !== "children") {
    return false;
  }
  return mutation.value === readback.value || mutation.value.startsWith(`${readback.value}.`);
}

function readbackVerifiesResource(
  mutation: StudioEvidenceEvent,
  readback: StudioEvidenceEvent,
  mutationKey: string,
) {
  return (
    readback.kind === "readback" &&
    readback.ownerId === mutation.ownerId &&
    readback.startedOrder > mutation.completedOrder &&
    readback.resourceKeys.some((readbackKey) =>
      readbackCoversResource(readbackKey, mutationKey),
    )
  );
}

export function getUnverifiedStudioResourceKeys(evidence: StudioRunEvidence) {
  return [...new Set(
    evidence.events
      .filter((event) => event.kind === "mutation")
      .flatMap((mutation) => {
        const mutationKeys = mutation.resourceKeys.length > 0
          ? mutation.resourceKeys
          : [`studio:unscoped:${mutation.operationId}`];
        return mutationKeys.filter((mutationKey) =>
          !evidence.events.some((readback) =>
            readbackVerifiesResource(mutation, readback, mutationKey),
          ),
        );
      }),
  )].sort();
}

export function hasFreshStudioReadback(evidence: StudioRunEvidence) {
  if (!evidence.lastMutation) return true;
  return getUnverifiedStudioResourceKeys(evidence).length === 0;
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

export function hasSettledWorkerCrew(
  workers: readonly WorkerRecordSnapshot[],
  merge: MergedWorkerResult | null,
) {
  return (
    workers.every((worker) => isWorkerTerminalState(worker.state)) &&
    (workers.length === 0 || merge !== null)
  );
}

interface AgentState {
  runId: string | null;
  phase: AgentPhase;
  plan: AgentPlan | null;
  workers: readonly WorkerRecordSnapshot[];
  workerMerge: MergedWorkerResult | null;
  events: readonly AgentEvent[];
  studioEvidence: StudioRunEvidence;
  repairEvidenceAfterOrder: number | null;
  planningRequired: boolean;
  lastError: string | null;
  beginRun: (goal: string, planningRequired: boolean) => string;
  setPlan: (
    plan: Omit<AgentPlan, "id" | "createdAt">,
    expectedRunId?: string,
  ) => boolean;
  updateStep: (
    stepId: string,
    status: PlanStepStatus,
    notes?: string,
    expectedRunId?: string,
  ) => boolean;
  setWorkers: (
    runId: string,
    workers: readonly WorkerRecordSnapshot[],
  ) => boolean;
  setWorkerMerge: (runId: string, merge: MergedWorkerResult) => boolean;
  setPhase: (phase: AgentPhase) => void;
  beginStudioOperation: (
    toolName: string,
    kind: StudioEvidenceKind,
    resourceKeys?: readonly string[],
  ) => StudioOperationToken | null;
  completeStudioOperation: (
    token: StudioOperationToken,
    resourceKeys?: readonly string[],
  ) => boolean;
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
  workers: [] as readonly WorkerRecordSnapshot[],
  workerMerge: null as MergedWorkerResult | null,
  events: [] as readonly AgentEvent[],
  studioEvidence: initialStudioEvidence,
  repairEvidenceAfterOrder: null,
  planningRequired: false,
  lastError: null,
};

let fallbackRunCounter = 0;
let fallbackEventCounter = 0;

function createRunId() {
  fallbackRunCounter += 1;
  return (
    crypto.randomUUID?.() ??
    `run_${Date.now().toString(36)}_${fallbackRunCounter.toString(36)}`
  );
}

function appendAgentEvent(
  events: readonly AgentEvent[],
  runId: string,
  type: AgentEventType,
  details: AgentEvent["details"] = {},
  ownerId = "coordinator",
) {
  fallbackEventCounter += 1;
  return [
    ...events,
    {
      id: `event_${fallbackEventCounter.toString(36)}`,
      runId,
      ownerId,
      type,
      timestamp: Date.now(),
      details: Object.freeze({ ...details }),
    },
  ];
}

export const useAgentStore = create<AgentState>()((set, get) => ({
  ...initialState,

  beginRun: (goal, planningRequired) => {
    const runId = createRunId();
    set((state) => ({
      runId,
      phase: planningRequired ? "planning" : "executing",
      plan: null,
      workers: [],
      workerMerge: null,
      studioEvidence: initialStudioEvidence,
      repairEvidenceAfterOrder: null,
      planningRequired,
      lastError: null,
      events: appendAgentEvent(state.events, runId, "run_started", {
        goal,
        planningRequired,
      }),
    }));
    return runId;
  },

  setPlan: (plan, expectedRunId) => {
    const runId = get().runId;
    if (!runId || (expectedRunId && expectedRunId !== runId)) return false;
    set((state) => ({
      plan: {
        ...plan,
        id: `plan_${runId}`,
        createdAt: Date.now(),
      },
      phase: "executing",
      lastError: null,
      events: appendAgentEvent(state.events, runId, "plan_created", {
        planId: `plan_${runId}`,
        stepCount: plan.steps.length,
      }),
    }));
    return true;
  },

  updateStep: (stepId, status, notes, expectedRunId) => {
    if (expectedRunId && expectedRunId !== get().runId) return false;
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

    const runId = get().runId;
    if (!runId) return false;
    set((state) => ({
      phase,
      plan: {
        ...current,
        steps: current.steps.map((step) =>
          step.id === stepId
            ? { ...step, status, notes: notes ?? step.notes }
            : step
        ),
      },
      events: appendAgentEvent(state.events, runId, "plan_step_updated", {
        stepId,
        status,
      }),
    }));
    return true;
  },

  setWorkers: (runId, workers) => {
    if (runId !== get().runId) return false;
    set((state) => ({
      workers: [...workers],
      events: appendAgentEvent(state.events, runId, "workers_updated", {
        workerCount: workers.length,
        terminalCount: workers.filter((worker) =>
          isWorkerTerminalState(worker.state),
        ).length,
      }),
    }));
    return true;
  },

  setWorkerMerge: (runId, merge) => {
    if (
      runId !== get().runId ||
      merge.runId !== runId ||
      merge.planId !== get().plan?.id
    ) {
      return false;
    }
    set((state) => ({
      workerMerge: merge,
      events: appendAgentEvent(state.events, runId, "workers_merged", {
        status: merge.status,
        resultCount: merge.results.length,
      }),
    }));
    return true;
  },

  setPhase: (phase) => set({ phase }),

  beginStudioOperation: (toolName, kind, resourceKeys = []) => {
    const { runId, studioEvidence } = get();
    if (!runId) return null;

    const startedOrder = studioEvidence.clock + 1;
    set((state) => ({
      studioEvidence: {
        ...studioEvidence,
        clock: startedOrder,
      },
      events: appendAgentEvent(
        state.events,
        runId,
        "studio_operation_started",
        {
          toolName,
          kind,
          startedOrder,
          resourceKeys: resourceKeys.join(","),
        },
      ),
    }));
    return {
      runId,
      operationId: `studio_${runId}_${startedOrder.toString(36)}`,
      ownerId: "coordinator",
      toolName,
      kind,
      resourceKeys: [...resourceKeys],
      startedOrder,
    };
  },

  completeStudioOperation: (token, resourceKeys = token.resourceKeys) => {
    const { runId, studioEvidence } = get();
    if (!runId || runId !== token.runId) return false;

    const completedOrder = studioEvidence.clock + 1;
    const event: StudioEvidenceEvent = {
      ...token,
      resourceKeys: [...resourceKeys],
      status: "passed",
      completedOrder,
    };

    if (token.kind === "mutation") {
      set((state) => ({
        studioEvidence: {
          ...studioEvidence,
          clock: completedOrder,
          mutationCount: studioEvidence.mutationCount + 1,
          lastMutation: event,
          events: [...studioEvidence.events, event],
        },
        events: appendAgentEvent(
          state.events,
          runId,
          "studio_operation_completed",
          {
            toolName: token.toolName,
            kind: token.kind,
            startedOrder: token.startedOrder,
            completedOrder,
            operationId: token.operationId,
            ownerId: token.ownerId,
            resourceKeys: resourceKeys.join(","),
          },
        ),
      }));
      return true;
    }

    const lastReadback =
      !studioEvidence.lastReadback ||
      event.startedOrder > studioEvidence.lastReadback.startedOrder
        ? event
        : studioEvidence.lastReadback;
    set((state) => ({
      studioEvidence: {
        ...studioEvidence,
        clock: completedOrder,
        readbackCount: studioEvidence.readbackCount + 1,
        lastReadback,
        events: [...studioEvidence.events, event],
      },
      events: appendAgentEvent(
        state.events,
        runId,
        "studio_operation_completed",
        {
          toolName: token.toolName,
          kind: token.kind,
          startedOrder: token.startedOrder,
          completedOrder,
          operationId: token.operationId,
          ownerId: token.ownerId,
          resourceKeys: resourceKeys.join(","),
        },
      ),
    }));
    return true;
  },

  completeRun: (summary, verification) => {
    const { plan: current, runId } = get();
    set((state) => ({
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
      events: runId
        ? appendAgentEvent(state.events, runId, "run_completed", {
            summary,
            verification: verification ?? null,
          })
        : state.events,
    }));
  },

  requestRepair: (message) => {
    const { studioEvidence, runId } = get();
    set((state) => ({
      phase: "repairing",
      repairEvidenceAfterOrder: studioEvidence.clock,
      lastError: message,
      events: runId
        ? appendAgentEvent(state.events, runId, "repair_requested", {
            message,
            evidenceOrder: studioEvidence.clock,
          })
        : state.events,
    }));
  },

  failRun: (message) =>
    set((state) => ({
      phase: "error",
      lastError: message,
      events: state.runId
        ? appendAgentEvent(state.events, state.runId, "run_failed", {
            message,
          })
        : state.events,
    })),

  cancelRun: () =>
    set((state) => ({
      phase: "cancelled",
      events: state.runId
        ? appendAgentEvent(state.events, state.runId, "run_cancelled")
        : state.events,
    })),

  reset: () => set(initialState),
}));
