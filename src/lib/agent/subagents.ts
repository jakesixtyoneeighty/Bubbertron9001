/**
 * Provider-agnostic orchestration primitives for B9's read-only workers.
 *
 * This module intentionally does not import the provider runtime or Roblox
 * tools. Provider adapters must build worker toolsets through the allowlists
 * below, while the coordinator remains the only owner of root-plan and Studio
 * mutation capabilities.
 */

export const SUBAGENT_CONTRACT_VERSION = 1 as const;

export type WorkerRole =
  | "studio_explorer"
  | "roblox_researcher"
  | "plan_reviewer";

export type WorkerCapability =
  | "studio:read"
  | "skills:read"
  | "web:research"
  | "plan:review";

export const WORKER_CAPABILITY_ALLOWLISTS = {
  studio_explorer: ["studio:read"],
  roblox_researcher: ["skills:read", "web:research"],
  plan_reviewer: ["plan:review"],
} as const satisfies Record<WorkerRole, readonly WorkerCapability[]>;

export const WORKER_TOOL_ALLOWLISTS = {
  studio_explorer: [
    "roblox_get_playtest_state",
    "roblox_get_recent_logs",
    "roblox_get_script",
    "roblox_get_children",
    "roblox_get_properties",
    "roblox_search",
    "roblox_get_selection",
  ],
  roblox_researcher: ["skill_search", "skill_load", "web_search"],
  plan_reviewer: [],
} as const satisfies Record<WorkerRole, readonly string[]>;

export type WorkerToolName =
  (typeof WORKER_TOOL_ALLOWLISTS)[WorkerRole][number];

export const STUDIO_MUTATION_TOOL_NAMES = [
  "roblox_set_script",
  "roblox_edit_script",
  "roblox_set_property",
  "roblox_create",
  "roblox_delete",
  "roblox_clone",
  "roblox_run_code",
  "roblox_move",
  "roblox_bulk_create",
  "roblox_bulk_delete",
  "roblox_bulk_set_property",
  "roblox_insert_asset",
] as const;

export const COORDINATOR_ONLY_TOOL_NAMES = [
  "agent_create_plan",
  "agent_update_plan",
  "agent_finish_plan",
  "agent_delegate",
  "agent_manage_workers",
  "roblox_ask_user",
] as const;

export interface SubagentLimits {
  maxWorkers: number;
  maxConcurrent: number;
  maxDepth: number;
  maxAttemptsPerWorker: number;
  maxStepsPerWorker: number;
  maxProviderCallsPerWorker: number;
  maxWorkerRuntimeMs: number;
}

export const HARD_SUBAGENT_LIMITS: Readonly<SubagentLimits> = Object.freeze({
  maxWorkers: 2,
  maxConcurrent: 2,
  maxDepth: 1,
  maxAttemptsPerWorker: 2,
  maxStepsPerWorker: 12,
  maxProviderCallsPerWorker: 2,
  maxWorkerRuntimeMs: 120_000,
});

export const DEFAULT_SUBAGENT_LIMITS: Readonly<SubagentLimits> = Object.freeze({
  maxWorkers: 2,
  maxConcurrent: 2,
  maxDepth: 1,
  maxAttemptsPerWorker: 2,
  maxStepsPerWorker: 8,
  // Two calls allow one bounded tool round followed by the typed result.
  maxProviderCallsPerWorker: 2,
  maxWorkerRuntimeMs: 60_000,
});

export type SubagentPolicyErrorCode =
  | "ALREADY_STARTED"
  | "DUPLICATE_WORKER"
  | "INVALID_CONTEXT"
  | "INVALID_LIMIT"
  | "INVALID_REQUEST"
  | "INVALID_RESULT"
  | "MAX_ATTEMPTS"
  | "MAX_WORKERS"
  | "NESTING_FORBIDDEN"
  | "OWNERSHIP_MISMATCH"
  | "RUN_CANCELLED"
  | "TOOL_NOT_ALLOWED"
  | "UNKNOWN_WORKER"
  | "WORKER_NOT_RETRYABLE"
  | "WORKERS_NOT_TERMINAL";

export class SubagentPolicyError extends Error {
  readonly code: SubagentPolicyErrorCode;

  constructor(code: SubagentPolicyErrorCode, message: string) {
    super(message);
    this.name = "SubagentPolicyError";
    this.code = code;
  }
}

export interface CoordinatorContext {
  kind: "coordinator";
  runId: string;
  agentId: string;
  planId: string;
  depth: 0;
}

export interface WorkerAgentContext {
  kind: "worker";
  runId: string;
  agentId: string;
  coordinatorId: string;
  planId: string;
  stepId: string;
  role: WorkerRole;
  depth: 1;
}

export type AgentContext = CoordinatorContext | WorkerAgentContext;

export interface OwnershipClaim {
  runId: string;
  planId: string;
  stepId: string;
  ownerId: string;
}

export interface WorkerOwnership {
  runId: string;
  coordinatorId: string;
  workerId: string;
  planId: string;
  stepId: string;
}

export interface WorkerRequest {
  workerId: string;
  role: WorkerRole;
  stepId: string;
  task: string;
}

export interface WorkerAssignment {
  schemaVersion: typeof SUBAGENT_CONTRACT_VERSION;
  order: number;
  role: WorkerRole;
  task: string;
  ownership: WorkerOwnership;
}

export type WorkerFindingSeverity = "info" | "warning" | "critical";

export interface WorkerFinding {
  id: string;
  summary: string;
  detail: string;
  severity: WorkerFindingSeverity;
  resourceKeys: readonly string[];
  evidenceIds: readonly string[];
}

export type WorkerEvidenceKind =
  | "studio_readback"
  | "playtest_diagnostic"
  | "skill"
  | "web"
  | "plan_review";

export interface WorkerEvidenceReference {
  id: string;
  kind: WorkerEvidenceKind;
  summary: string;
  resourceKeys: readonly string[];
  ownership: WorkerOwnership;
}

export interface WorkerRisk {
  id: string;
  summary: string;
  severity: "low" | "medium" | "high";
  resourceKeys: readonly string[];
}

export interface WorkerUnresolvedQuestion {
  id: string;
  question: string;
  blocking: boolean;
  /** Workers report questions; only the coordinator may ask the user. */
  coordinatorAction: string;
}

/**
 * Read-only workers can describe a proposal, but this reference has no
 * executable operations and cannot enter the Studio mutation lane.
 */
export interface WorkerChangeProposal {
  id: string;
  summary: string;
  baseRevision: string;
  resourceClaims: readonly string[];
  requiresCoordinatorReview: true;
}

export interface WorkerFailure {
  code: string;
  message: string;
  retryable: boolean;
}

export type WorkerTerminalState =
  | "completed"
  | "failed"
  | "cancelled"
  | "timed_out"
  | "dismissed";

export type WorkerState = "queued" | "running" | WorkerTerminalState;

export const TERMINAL_WORKER_STATES: readonly WorkerTerminalState[] =
  Object.freeze([
    "completed",
    "failed",
    "cancelled",
    "timed_out",
    "dismissed",
  ]);

export function isWorkerTerminalState(
  state: WorkerState
): state is WorkerTerminalState {
  return TERMINAL_WORKER_STATES.includes(state as WorkerTerminalState);
}

export interface WorkerResult {
  schemaVersion: typeof SUBAGENT_CONTRACT_VERSION;
  role: WorkerRole;
  status: WorkerTerminalState;
  ownership: WorkerOwnership;
  summary: string;
  findings: readonly WorkerFinding[];
  evidence: readonly WorkerEvidenceReference[];
  risks: readonly WorkerRisk[];
  unresolvedQuestions: readonly WorkerUnresolvedQuestion[];
  changeProposals: readonly WorkerChangeProposal[];
  error?: WorkerFailure;
}

export interface WorkerResultInput {
  status?: Exclude<WorkerTerminalState, "dismissed">;
  summary: string;
  findings?: readonly WorkerFinding[];
  evidence?: readonly WorkerEvidenceReference[];
  risks?: readonly WorkerRisk[];
  unresolvedQuestions?: readonly WorkerUnresolvedQuestion[];
  changeProposals?: readonly WorkerChangeProposal[];
  error?: WorkerFailure;
}

export interface WorkerExecutionContext extends WorkerAgentContext {
  signal: AbortSignal;
  capabilities: readonly WorkerCapability[];
  allowedToolNames: readonly WorkerToolName[];
  limits: Readonly<
    Pick<
      SubagentLimits,
      | "maxDepth"
      | "maxStepsPerWorker"
      | "maxProviderCallsPerWorker"
      | "maxWorkerRuntimeMs"
    >
  >;
}

export type WorkerExecutor = (
  assignment: WorkerAssignment,
  context: WorkerExecutionContext
) => Promise<WorkerResult>;

export interface WorkerRecordSnapshot {
  assignment: WorkerAssignment;
  state: WorkerState;
  attempts: number;
  result?: WorkerResult;
}

export type WorkerDisposition =
  | "merged"
  | "dismissed"
  | "surfaced_failure";

export interface MergedWorkerResult {
  schemaVersion: typeof SUBAGENT_CONTRACT_VERSION;
  runId: string;
  coordinatorId: string;
  planId: string;
  status: "completed" | "partial" | "failed" | "cancelled";
  results: readonly WorkerResult[];
  dispositions: readonly {
    workerId: string;
    disposition: WorkerDisposition;
  }[];
  findings: readonly WorkerFinding[];
  evidence: readonly WorkerEvidenceReference[];
  risks: readonly WorkerRisk[];
  unresolvedQuestions: readonly WorkerUnresolvedQuestion[];
  changeProposals: readonly WorkerChangeProposal[];
}

export interface VerificationTarget extends OwnershipClaim {
  resourceKeys: readonly string[];
}

const RESULT_LIMITS = Object.freeze({
  summaryLength: 2_000,
  findings: 50,
  evidence: 50,
  risks: 30,
  unresolvedQuestions: 20,
  changeProposals: 10,
});

const forbiddenWorkerTools = new Set<string>([
  ...STUDIO_MUTATION_TOOL_NAMES,
  ...COORDINATOR_ONLY_TOOL_NAMES,
]);

for (const tools of Object.values(WORKER_TOOL_ALLOWLISTS)) {
  for (const toolName of tools) {
    if (forbiddenWorkerTools.has(toolName)) {
      throw new Error(`Worker allowlist contains forbidden tool ${toolName}`);
    }
  }
}

function requireScopedId(value: string, label: string) {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 128) {
    throw new SubagentPolicyError(
      "INVALID_CONTEXT",
      `${label} must contain 1-128 characters`
    );
  }
  return trimmed;
}

function requireBoundedText(
  value: string,
  label: string,
  maxLength: number,
  code: SubagentPolicyErrorCode = "INVALID_RESULT"
) {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) {
    throw new SubagentPolicyError(
      code,
      `${label} must contain 1-${maxLength} characters`
    );
  }
  return trimmed;
}

function sameWorkerOwnership(
  expected: WorkerOwnership,
  actual: WorkerOwnership
) {
  return (
    expected.runId === actual.runId &&
    expected.coordinatorId === actual.coordinatorId &&
    expected.workerId === actual.workerId &&
    expected.planId === actual.planId &&
    expected.stepId === actual.stepId
  );
}

export function assertWorkerOwnership(
  expected: WorkerOwnership,
  actual: WorkerOwnership,
  subject = "Worker-owned value"
) {
  if (!sameWorkerOwnership(expected, actual)) {
    throw new SubagentPolicyError(
      "OWNERSHIP_MISMATCH",
      `${subject} does not belong to its assigned run, coordinator, worker, plan, and step`
    );
  }
}

export function assertPlanStepOwnership(
  actor: AgentContext,
  claim: OwnershipClaim
) {
  if (
    actor.runId !== claim.runId ||
    actor.planId !== claim.planId ||
    actor.agentId !== claim.ownerId ||
    (actor.kind === "worker" && actor.stepId !== claim.stepId)
  ) {
    throw new SubagentPolicyError(
      "OWNERSHIP_MISMATCH",
      "Plan update does not belong to the actor's run, plan, owner, and step"
    );
  }
}

export function canEvidenceVerifyTarget(
  evidence: WorkerEvidenceReference,
  target: VerificationTarget
) {
  const evidenceClaim: OwnershipClaim = {
    runId: evidence.ownership.runId,
    planId: evidence.ownership.planId,
    stepId: evidence.ownership.stepId,
    ownerId: evidence.ownership.workerId,
  };
  if (
    evidenceClaim.runId !== target.runId ||
    evidenceClaim.planId !== target.planId ||
    evidenceClaim.stepId !== target.stepId ||
    evidenceClaim.ownerId !== target.ownerId
  ) {
    return false;
  }

  const coveredResources = new Set(evidence.resourceKeys);
  return (
    target.resourceKeys.length > 0 &&
    target.resourceKeys.every((resourceKey) =>
      coveredResources.has(resourceKey)
    )
  );
}

export function isWorkerToolAllowed(
  role: WorkerRole,
  toolName: string
): toolName is WorkerToolName {
  return (WORKER_TOOL_ALLOWLISTS[role] as readonly string[]).includes(
    toolName
  );
}

export function assertWorkerToolAllowed(
  role: WorkerRole,
  toolName: string
) {
  if (!isWorkerToolAllowed(role, toolName)) {
    throw new SubagentPolicyError(
      "TOOL_NOT_ALLOWED",
      `${toolName} is not allowed for ${role}`
    );
  }
}

export function createWorkerToolset<T>(
  role: WorkerRole,
  availableTools: Readonly<Record<string, T>>
): Readonly<Partial<Record<WorkerToolName, T>>> {
  const selected: Partial<Record<WorkerToolName, T>> = {};
  for (const toolName of WORKER_TOOL_ALLOWLISTS[role]) {
    if (Object.prototype.hasOwnProperty.call(availableTools, toolName)) {
      selected[toolName] = availableTools[toolName];
    }
  }
  return Object.freeze(selected);
}

function resolveLimits(
  requested: Partial<SubagentLimits> | undefined
): Readonly<SubagentLimits> {
  const limits = { ...DEFAULT_SUBAGENT_LIMITS, ...requested };
  for (const [name, value] of Object.entries(limits) as Array<
    [keyof SubagentLimits, number]
  >) {
    const hardMaximum = HARD_SUBAGENT_LIMITS[name];
    if (!Number.isInteger(value) || value < 1 || value > hardMaximum) {
      throw new SubagentPolicyError(
        "INVALID_LIMIT",
        `${name} must be an integer between 1 and ${hardMaximum}`
      );
    }
  }
  if (limits.maxConcurrent > limits.maxWorkers) {
    throw new SubagentPolicyError(
      "INVALID_LIMIT",
      "maxConcurrent cannot exceed maxWorkers"
    );
  }
  return Object.freeze(limits);
}

function assertCoordinatorContext(
  context: AgentContext
): asserts context is CoordinatorContext {
  if (context.kind !== "coordinator" || context.depth !== 0) {
    throw new SubagentPolicyError(
      "NESTING_FORBIDDEN",
      "Only the depth-zero coordinator can create workers"
    );
  }
  requireScopedId(context.runId, "runId");
  requireScopedId(context.agentId, "agentId");
  requireScopedId(context.planId, "planId");
}

function validateRequest(request: WorkerRequest) {
  requireScopedId(request.workerId, "workerId");
  requireScopedId(request.stepId, "stepId");
  requireBoundedText(request.task, "task", 2_000, "INVALID_REQUEST");
  if (!(request.role in WORKER_TOOL_ALLOWLISTS)) {
    throw new SubagentPolicyError(
      "INVALID_REQUEST",
      `Unknown worker role ${String(request.role)}`
    );
  }
}

function assignmentFor(
  coordinator: CoordinatorContext,
  request: WorkerRequest,
  order: number
): WorkerAssignment {
  validateRequest(request);
  return Object.freeze({
    schemaVersion: SUBAGENT_CONTRACT_VERSION,
    order,
    role: request.role,
    task: request.task.trim(),
    ownership: Object.freeze({
      runId: coordinator.runId,
      coordinatorId: coordinator.agentId,
      workerId: request.workerId,
      planId: coordinator.planId,
      stepId: request.stepId,
    }),
  });
}

function validateWorkerResult(
  assignment: WorkerAssignment,
  result: WorkerResult
) {
  if (
    result.schemaVersion !== SUBAGENT_CONTRACT_VERSION ||
    result.role !== assignment.role ||
    !isWorkerTerminalState(result.status) ||
    result.status === "dismissed"
  ) {
    throw new SubagentPolicyError(
      "INVALID_RESULT",
      "Worker returned an unsupported contract version, role, or status"
    );
  }
  if (result.status !== "completed" && !result.error) {
    throw new SubagentPolicyError(
      "INVALID_RESULT",
      `Worker status ${result.status} requires a typed error`
    );
  }
  assertWorkerOwnership(
    assignment.ownership,
    result.ownership,
    "Worker result"
  );
  requireBoundedText(result.summary, "result summary", RESULT_LIMITS.summaryLength);

  const boundedCollections: Array<
    [string, readonly unknown[], number]
  > = [
    ["findings", result.findings, RESULT_LIMITS.findings],
    ["evidence", result.evidence, RESULT_LIMITS.evidence],
    ["risks", result.risks, RESULT_LIMITS.risks],
    [
      "unresolvedQuestions",
      result.unresolvedQuestions,
      RESULT_LIMITS.unresolvedQuestions,
    ],
    [
      "changeProposals",
      result.changeProposals,
      RESULT_LIMITS.changeProposals,
    ],
  ];
  for (const [label, collection, maximum] of boundedCollections) {
    if (!Array.isArray(collection) || collection.length > maximum) {
      throw new SubagentPolicyError(
        "INVALID_RESULT",
        `${label} must contain at most ${maximum} items`
      );
    }
  }

  const evidenceIds = new Set<string>();
  for (const evidence of result.evidence) {
    requireScopedId(evidence.id, "evidence id");
    assertWorkerOwnership(
      assignment.ownership,
      evidence.ownership,
      `Evidence ${evidence.id}`
    );
    if (evidenceIds.has(evidence.id)) {
      throw new SubagentPolicyError(
        "INVALID_RESULT",
        `Duplicate evidence id ${evidence.id}`
      );
    }
    evidenceIds.add(evidence.id);
  }

  for (const finding of result.findings) {
    requireScopedId(finding.id, "finding id");
    if (
      finding.evidenceIds.some((evidenceId) => !evidenceIds.has(evidenceId))
    ) {
      throw new SubagentPolicyError(
        "INVALID_RESULT",
        `Finding ${finding.id} references evidence outside its worker result`
      );
    }
  }

  for (const proposal of result.changeProposals) {
    if (
      proposal.requiresCoordinatorReview !== true ||
      proposal.resourceClaims.length === 0
    ) {
      throw new SubagentPolicyError(
        "INVALID_RESULT",
        `Proposal ${proposal.id} must remain coordinator-reviewed and resource-scoped`
      );
    }
  }
}

export function createWorkerResult(
  assignment: WorkerAssignment,
  input: WorkerResultInput
): WorkerResult {
  const result: WorkerResult = Object.freeze({
    schemaVersion: SUBAGENT_CONTRACT_VERSION,
    role: assignment.role,
    status: input.status ?? "completed",
    ownership: assignment.ownership,
    summary: input.summary.trim(),
    findings: Object.freeze([...(input.findings ?? [])]),
    evidence: Object.freeze([...(input.evidence ?? [])]),
    risks: Object.freeze([...(input.risks ?? [])]),
    unresolvedQuestions: Object.freeze([
      ...(input.unresolvedQuestions ?? []),
    ]),
    changeProposals: Object.freeze([...(input.changeProposals ?? [])]),
    ...(input.error ? { error: Object.freeze({ ...input.error }) } : {}),
  });
  validateWorkerResult(assignment, result);
  return result;
}

function terminalResult(
  assignment: WorkerAssignment,
  status: Exclude<WorkerTerminalState, "completed" | "dismissed">,
  code: string,
  message: string,
  retryable: boolean
) {
  return createWorkerResult(assignment, {
    status,
    summary: message,
    error: { code, message, retryable },
  });
}

function dismissedResult(assignment: WorkerAssignment, reason: string) {
  const message = requireBoundedText(
    reason,
    "dismissal reason",
    RESULT_LIMITS.summaryLength,
    "INVALID_REQUEST"
  );
  const result: WorkerResult = Object.freeze({
    schemaVersion: SUBAGENT_CONTRACT_VERSION,
    role: assignment.role,
    status: "dismissed",
    ownership: assignment.ownership,
    summary: message,
    findings: Object.freeze([]),
    evidence: Object.freeze([]),
    risks: Object.freeze([]),
    unresolvedQuestions: Object.freeze([]),
    changeProposals: Object.freeze([]),
    error: Object.freeze({
      code: "DISMISSED",
      message,
      retryable: false,
    }),
  });
  return result;
}

class WorkerCancelledError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AbortError";
  }
}

class WorkerTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TimeoutError";
  }
}

function errorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return "Worker execution failed";
}

function abortReason(signal: AbortSignal) {
  return signal.reason instanceof Error
    ? signal.reason
    : new WorkerCancelledError(
        typeof signal.reason === "string"
          ? signal.reason
          : "Parent run cancelled"
      );
}

function raceWithAbort<T>(promise: Promise<T>, signal: AbortSignal) {
  if (signal.aborted) return Promise.reject(abortReason(signal));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      reject(abortReason(signal));
    };
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        cleanup();
        reject(error);
      }
    );
  });
}

interface MutableWorkerRecord {
  assignment: WorkerAssignment;
  state: WorkerState;
  attempts: number;
  result?: WorkerResult;
}

export interface ReadonlySubagentCoordinatorOptions {
  parentSignal?: AbortSignal;
  limits?: Partial<SubagentLimits>;
  onWorkersChanged?: (workers: readonly WorkerRecordSnapshot[]) => void;
}

export class ReadonlySubagentCoordinator {
  readonly context: CoordinatorContext;
  readonly limits: Readonly<SubagentLimits>;

  private readonly controller = new AbortController();
  private readonly records = new Map<string, MutableWorkerRecord>();
  private readonly activeControllers = new Map<string, AbortController>();
  private readonly detachParentAbort?: () => void;
  private readonly onWorkersChanged?: ReadonlySubagentCoordinatorOptions["onWorkersChanged"];
  private cancelled = false;

  constructor(
    context: AgentContext,
    options: ReadonlySubagentCoordinatorOptions = {}
  ) {
    assertCoordinatorContext(context);
    this.context = Object.freeze({ ...context });
    this.limits = resolveLimits(options.limits);
    this.onWorkersChanged = options.onWorkersChanged;

    const parentSignal = options.parentSignal;
    if (parentSignal?.aborted) {
      this.cancel(errorMessage(parentSignal.reason));
    } else if (parentSignal) {
      const onAbort = () => this.cancel(errorMessage(parentSignal.reason));
      parentSignal.addEventListener("abort", onAbort, { once: true });
      this.detachParentAbort = () =>
        parentSignal.removeEventListener("abort", onAbort);
    }
  }

  cancel(reason = "Parent run cancelled") {
    if (this.cancelled) return;
    this.cancelled = true;
    const cancellation = new WorkerCancelledError(reason);
    this.controller.abort(cancellation);
    for (const record of this.records.values()) {
      if (record.state !== "queued") continue;
      record.state = "cancelled";
      record.result = terminalResult(
        record.assignment,
        "cancelled",
        "PARENT_CANCELLED",
        reason,
        false
      );
    }
    for (const controller of this.activeControllers.values()) {
      controller.abort(cancellation);
    }
    this.emitWorkersChanged();
  }

  dispose() {
    this.detachParentAbort?.();
  }

  getWorkerSnapshots(): readonly WorkerRecordSnapshot[] {
    return [...this.records.values()]
      .sort((left, right) =>
        left.assignment.order - right.assignment.order
      )
      .map((record) => ({
        assignment: record.assignment,
        state: record.state,
        attempts: record.attempts,
        ...(record.result ? { result: record.result } : {}),
      }));
  }

  async run(
    requests: readonly WorkerRequest[],
    executor: WorkerExecutor
  ): Promise<MergedWorkerResult> {
    if (this.records.size > 0) {
      throw new SubagentPolicyError(
        "ALREADY_STARTED",
        "This coordinator has already assigned its worker crew"
      );
    }
    if (this.cancelled) {
      throw new SubagentPolicyError(
        "RUN_CANCELLED",
        "Cannot start workers after parent cancellation"
      );
    }
    if (requests.length < 1) {
      throw new SubagentPolicyError(
        "INVALID_REQUEST",
        "At least one worker request is required"
      );
    }
    if (requests.length > this.limits.maxWorkers) {
      throw new SubagentPolicyError(
        "MAX_WORKERS",
        `A run may assign at most ${this.limits.maxWorkers} workers`
      );
    }

    const workerIds = new Set<string>();
    const assignments = requests.map((request, order) => {
      if (workerIds.has(request.workerId)) {
        throw new SubagentPolicyError(
          "DUPLICATE_WORKER",
          `Worker id ${request.workerId} is already assigned`
        );
      }
      workerIds.add(request.workerId);
      return assignmentFor(this.context, request, order);
    });
    for (const assignment of assignments) {
      const workerId = assignment.ownership.workerId;
      this.records.set(workerId, {
        assignment,
        state: "queued",
        attempts: 0,
      });
    }
    this.emitWorkersChanged();

    const queue = [...this.records.values()];
    let nextIndex = 0;
    const runNext = async () => {
      while (nextIndex < queue.length) {
        const record = queue[nextIndex];
        nextIndex += 1;
        if (this.cancelled) return;
        await this.executeRecord(record, executor);
      }
    };

    const runnerCount = Math.min(this.limits.maxConcurrent, queue.length);
    await Promise.all(
      Array.from({ length: runnerCount }, () => runNext())
    );
    return this.mergeResults();
  }

  async retry(workerId: string, executor: WorkerExecutor) {
    if (this.cancelled) {
      throw new SubagentPolicyError(
        "RUN_CANCELLED",
        "Cannot retry a worker after parent cancellation"
      );
    }
    const record = this.records.get(workerId);
    if (!record) {
      throw new SubagentPolicyError(
        "UNKNOWN_WORKER",
        `Unknown worker ${workerId}`
      );
    }
    if (record.state !== "failed" && record.state !== "timed_out") {
      throw new SubagentPolicyError(
        "WORKER_NOT_RETRYABLE",
        `Worker ${workerId} is ${record.state}, not failed or timed out`
      );
    }
    if (record.attempts >= this.limits.maxAttemptsPerWorker) {
      throw new SubagentPolicyError(
        "MAX_ATTEMPTS",
        `Worker ${workerId} reached its attempt limit`
      );
    }

    record.state = "queued";
    record.result = undefined;
    this.emitWorkersChanged();
    return this.executeRecord(record, executor);
  }

  dismiss(workerId: string, reason: string) {
    const record = this.records.get(workerId);
    if (!record) {
      throw new SubagentPolicyError(
        "UNKNOWN_WORKER",
        `Unknown worker ${workerId}`
      );
    }
    if (!isWorkerTerminalState(record.state)) {
      throw new SubagentPolicyError(
        "WORKERS_NOT_TERMINAL",
        `Worker ${workerId} cannot be dismissed while ${record.state}`
      );
    }
    record.state = "dismissed";
    record.result = dismissedResult(record.assignment, reason);
    this.emitWorkersChanged();
    return record.result;
  }

  mergeResults(): MergedWorkerResult {
    const records = [...this.records.values()].sort(
      (left, right) => left.assignment.order - right.assignment.order
    );
    if (
      records.length === 0 ||
      records.some((record) => !isWorkerTerminalState(record.state))
    ) {
      throw new SubagentPolicyError(
        "WORKERS_NOT_TERMINAL",
        "Every assigned worker must be terminal before results are merged"
      );
    }

    const results = records.map((record) => record.result as WorkerResult);
    const contributionResults = results.filter(
      (result) =>
        result.status !== "dismissed" && result.status !== "cancelled"
    );
    const completedCount = results.filter(
      (result) => result.status === "completed"
    ).length;
    const failedCount = results.filter(
      (result) =>
        result.status === "failed" || result.status === "timed_out"
    ).length;

    let status: MergedWorkerResult["status"];
    if (this.cancelled) status = "cancelled";
    else if (completedCount === results.length) status = "completed";
    else if (completedCount > 0) status = "partial";
    else if (failedCount > 0) status = "failed";
    else if (results.some((result) => result.status === "cancelled")) {
      status = "cancelled";
    } else status = "partial";

    return Object.freeze({
      schemaVersion: SUBAGENT_CONTRACT_VERSION,
      runId: this.context.runId,
      coordinatorId: this.context.agentId,
      planId: this.context.planId,
      status,
      results: Object.freeze(results),
      dispositions: Object.freeze(
        results.map((result) => ({
          workerId: result.ownership.workerId,
          disposition:
            result.status === "completed"
              ? ("merged" as const)
              : result.status === "dismissed"
                ? ("dismissed" as const)
                : ("surfaced_failure" as const),
        }))
      ),
      findings: Object.freeze(
        contributionResults.flatMap((result) => result.findings)
      ),
      evidence: Object.freeze(
        contributionResults.flatMap((result) => result.evidence)
      ),
      risks: Object.freeze(
        contributionResults.flatMap((result) => result.risks)
      ),
      unresolvedQuestions: Object.freeze(
        contributionResults.flatMap(
          (result) => result.unresolvedQuestions
        )
      ),
      changeProposals: Object.freeze(
        contributionResults.flatMap((result) => result.changeProposals)
      ),
    });
  }

  private async executeRecord(
    record: MutableWorkerRecord,
    executor: WorkerExecutor
  ): Promise<WorkerResult> {
    if (this.cancelled) {
      record.state = "cancelled";
      record.result = terminalResult(
        record.assignment,
        "cancelled",
        "PARENT_CANCELLED",
        "Parent run cancelled",
        false
      );
      return record.result;
    }

    record.state = "running";
    record.attempts += 1;
    this.emitWorkersChanged();
    const workerId = record.assignment.ownership.workerId;
    const workerController = new AbortController();
    this.activeControllers.set(workerId, workerController);
    let timedOut = false;

    const relayCancellation = () =>
      workerController.abort(abortReason(this.controller.signal));
    this.controller.signal.addEventListener("abort", relayCancellation, {
      once: true,
    });
    const timeout = setTimeout(() => {
      timedOut = true;
      workerController.abort(
        new WorkerTimeoutError(
          `Worker exceeded ${this.limits.maxWorkerRuntimeMs}ms runtime limit`
        )
      );
    }, this.limits.maxWorkerRuntimeMs);

    const context: WorkerExecutionContext = Object.freeze({
      kind: "worker",
      runId: record.assignment.ownership.runId,
      agentId: workerId,
      coordinatorId: record.assignment.ownership.coordinatorId,
      planId: record.assignment.ownership.planId,
      stepId: record.assignment.ownership.stepId,
      role: record.assignment.role,
      depth: 1,
      signal: workerController.signal,
      capabilities: Object.freeze([
        ...WORKER_CAPABILITY_ALLOWLISTS[record.assignment.role],
      ]),
      allowedToolNames: Object.freeze([
        ...WORKER_TOOL_ALLOWLISTS[record.assignment.role],
      ]),
      limits: Object.freeze({
        maxDepth: this.limits.maxDepth,
        maxStepsPerWorker: this.limits.maxStepsPerWorker,
        maxProviderCallsPerWorker:
          this.limits.maxProviderCallsPerWorker,
        maxWorkerRuntimeMs: this.limits.maxWorkerRuntimeMs,
      }),
    });

    try {
      const execution = Promise.resolve().then(() =>
        executor(record.assignment, context)
      );
      const result = await raceWithAbort(
        execution,
        workerController.signal
      );
      validateWorkerResult(record.assignment, result);
      record.state = result.status;
      record.result = result;
      this.emitWorkersChanged();
    } catch (error) {
      if (timedOut) {
        const message = `Worker exceeded ${this.limits.maxWorkerRuntimeMs}ms runtime limit`;
        record.state = "timed_out";
        record.result = terminalResult(
          record.assignment,
          "timed_out",
          "WORKER_TIMEOUT",
          message,
          true
        );
        this.emitWorkersChanged();
      } else if (this.cancelled || workerController.signal.aborted) {
        const message = this.cancelled
          ? "Parent run cancelled"
          : errorMessage(error);
        record.state = "cancelled";
        record.result = terminalResult(
          record.assignment,
          "cancelled",
          "WORKER_CANCELLED",
          message,
          false
        );
        this.emitWorkersChanged();
      } else {
        const message = errorMessage(error);
        record.state = "failed";
        record.result = terminalResult(
          record.assignment,
          "failed",
          error instanceof SubagentPolicyError
            ? error.code
            : "WORKER_FAILED",
          message,
          true
        );
        this.emitWorkersChanged();
      }
    } finally {
      clearTimeout(timeout);
      this.controller.signal.removeEventListener(
        "abort",
        relayCancellation
      );
      this.activeControllers.delete(workerId);
    }

    if (!record.result) {
      throw new SubagentPolicyError(
        "INVALID_RESULT",
        `Worker ${workerId} did not reach a terminal result`
      );
    }
    return record.result;
  }

  private emitWorkersChanged() {
    this.onWorkersChanged?.(this.getWorkerSnapshots());
  }
}
