import { describe, expect, it, vi } from "vitest";
import {
  HARD_SUBAGENT_LIMITS,
  ReadonlySubagentCoordinator,
  STUDIO_MUTATION_TOOL_NAMES,
  SubagentPolicyError,
  WORKER_TOOL_ALLOWLISTS,
  assertPlanStepOwnership,
  assertWorkerToolAllowed,
  canEvidenceVerifyTarget,
  createWorkerResult,
  createWorkerToolset,
  isWorkerTerminalState,
  type CoordinatorContext,
  type MergedWorkerResult,
  type WorkerAgentContext,
  type WorkerAssignment,
  type WorkerEvidenceReference,
  type WorkerRequest,
  type WorkerResult,
} from "../subagents";

const coordinatorContext: CoordinatorContext = {
  kind: "coordinator",
  runId: "run_alpha",
  agentId: "lead",
  planId: "plan_alpha",
  depth: 0,
};

const workerRequests: readonly WorkerRequest[] = [
  {
    workerId: "explorer",
    role: "studio_explorer",
    stepId: "inspect",
    task: "Inspect the current Studio hierarchy",
  },
  {
    workerId: "reviewer",
    role: "plan_reviewer",
    stepId: "review",
    task: "Review the plan and verification coverage",
  },
];

function completedResult(
  assignment: WorkerAssignment,
  label = assignment.ownership.workerId
): WorkerResult {
  const evidence: WorkerEvidenceReference = {
    id: `${label}_evidence`,
    kind:
      assignment.role === "studio_explorer"
        ? "studio_readback"
        : "plan_review",
    summary: `${label} evidence`,
    resourceKeys: [`resource:${label}`],
    ownership: assignment.ownership,
  };
  return createWorkerResult(assignment, {
    summary: `${label} completed`,
    evidence: [evidence],
    findings: [
      {
        id: `${label}_finding`,
        summary: `${label} finding`,
        detail: `${label} detail`,
        severity: "info",
        resourceKeys: [`resource:${label}`],
        evidenceIds: [evidence.id],
      },
    ],
  });
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function waitForWorkerCount(
  coordinator: ReadonlySubagentCoordinator,
  state: "running" | "cancelled",
  count: number
) {
  await vi.waitFor(() => {
    expect(
      coordinator
        .getWorkerSnapshots()
        .filter((worker) => worker.state === state)
    ).toHaveLength(count);
  });
}

describe("read-only worker policy", () => {
  it("builds role toolsets only from explicit read-only allowlists", () => {
    const availableTools = {
      roblox_get_script: { name: "get" },
      roblox_set_script: { name: "set" },
      roblox_ask_user: { name: "ask" },
      skill_search: { name: "skills" },
      web_search: { name: "web" },
    };

    expect(
      Object.keys(createWorkerToolset("studio_explorer", availableTools))
    ).toEqual(["roblox_get_script"]);
    expect(
      Object.keys(createWorkerToolset("roblox_researcher", availableTools))
    ).toEqual(["skill_search", "web_search"]);
    expect(
      Object.keys(createWorkerToolset("plan_reviewer", availableTools))
    ).toEqual([]);

    for (const role of Object.keys(WORKER_TOOL_ALLOWLISTS) as Array<
      keyof typeof WORKER_TOOL_ALLOWLISTS
    >) {
      for (const mutationTool of STUDIO_MUTATION_TOOL_NAMES) {
        expect(() =>
          assertWorkerToolAllowed(role, mutationTool)
        ).toThrowError(
          expect.objectContaining({ code: "TOOL_NOT_ALLOWED" })
        );
      }
    }
    expect(() =>
      assertWorkerToolAllowed("studio_explorer", "roblox_ask_user")
    ).toThrowError(expect.objectContaining({ code: "TOOL_NOT_ALLOWED" }));
  });

  it("rejects worker-created coordinators so workers cannot nest", () => {
    const workerContext: WorkerAgentContext = {
      kind: "worker",
      runId: "run_alpha",
      agentId: "explorer",
      coordinatorId: "lead",
      planId: "plan_alpha",
      stepId: "inspect",
      role: "studio_explorer",
      depth: 1,
    };

    expect(() => new ReadonlySubagentCoordinator(workerContext)).toThrowError(
      expect.objectContaining({ code: "NESTING_FORBIDDEN" })
    );
  });

  it("keeps worker and provider budgets under immutable hard limits", () => {
    expect(HARD_SUBAGENT_LIMITS).toMatchObject({
      maxWorkers: 2,
      maxConcurrent: 2,
      maxDepth: 1,
    });
    expect(
      () =>
        new ReadonlySubagentCoordinator(coordinatorContext, {
          limits: { maxWorkers: 3 },
        })
    ).toThrowError(expect.objectContaining({ code: "INVALID_LIMIT" }));
  });
});

describe("read-only worker orchestration", () => {
  it("runs no more than two workers and rejects a third assignment", async () => {
    const coordinator = new ReadonlySubagentCoordinator(coordinatorContext);
    let active = 0;
    let maximumActive = 0;
    const gates = new Map(workerRequests.map((request) => [request.workerId, deferred()]));

    const run = coordinator.run(workerRequests, async (assignment) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await gates.get(assignment.ownership.workerId)!.promise;
      active -= 1;
      return completedResult(assignment);
    });

    await waitForWorkerCount(coordinator, "running", 2);
    gates.get("reviewer")!.resolve();
    gates.get("explorer")!.resolve();
    await run;
    expect(maximumActive).toBe(2);

    const oversized = new ReadonlySubagentCoordinator({
      ...coordinatorContext,
      runId: "run_oversized",
    });
    await expect(
      oversized.run(
        [
          ...workerRequests,
          {
            workerId: "researcher",
            role: "roblox_researcher",
            stepId: "research",
            task: "Research current Roblox guidance",
          },
        ],
        async (assignment) => completedResult(assignment)
      )
    ).rejects.toMatchObject({ code: "MAX_WORKERS" });
  });

  it("merges by assignment order regardless of completion order", async () => {
    async function runInCompletionOrder(
      first: "explorer" | "reviewer"
    ): Promise<MergedWorkerResult> {
      const coordinator = new ReadonlySubagentCoordinator(
        coordinatorContext
      );
      const gates = new Map(
        workerRequests.map((request) => [request.workerId, deferred()])
      );
      const run = coordinator.run(workerRequests, async (assignment) => {
        await gates.get(assignment.ownership.workerId)!.promise;
        return completedResult(assignment);
      });
      await waitForWorkerCount(coordinator, "running", 2);
      gates.get(first)!.resolve();
      await vi.waitFor(() => {
        expect(
          coordinator
            .getWorkerSnapshots()
            .find((worker) =>
              worker.assignment.ownership.workerId === first
            )?.state
        ).toBe("completed");
      });
      gates.get(first === "explorer" ? "reviewer" : "explorer")!.resolve();
      return run;
    }

    const reviewerFirst = await runInCompletionOrder("reviewer");
    const explorerFirst = await runInCompletionOrder("explorer");

    expect(reviewerFirst).toEqual(explorerFirst);
    expect(
      reviewerFirst.results.map((result) => result.ownership.workerId)
    ).toEqual(["explorer", "reviewer"]);
    expect(reviewerFirst.findings.map((finding) => finding.id)).toEqual([
      "explorer_finding",
      "reviewer_finding",
    ]);
  });

  it("propagates parent cancellation and leaves every worker terminal", async () => {
    const parent = new AbortController();
    const coordinator = new ReadonlySubagentCoordinator(
      coordinatorContext,
      { parentSignal: parent.signal }
    );
    const workerSignals: AbortSignal[] = [];
    const run = coordinator.run(workerRequests, async (_assignment, context) => {
      workerSignals.push(context.signal);
      await new Promise<void>(() => undefined);
      throw new Error("unreachable");
    });

    await waitForWorkerCount(coordinator, "running", 2);
    parent.abort(new Error("Stop requested"));
    const merged = await run;

    expect(merged.status).toBe("cancelled");
    expect(merged.results.map((result) => result.status)).toEqual([
      "cancelled",
      "cancelled",
    ]);
    expect(workerSignals.every((signal) => signal.aborted)).toBe(true);
    expect(
      coordinator
        .getWorkerSnapshots()
        .every((worker) => isWorkerTerminalState(worker.state))
    ).toBe(true);
    await expect(
      coordinator.retry("explorer", async (assignment) =>
        completedResult(assignment)
      )
    ).rejects.toMatchObject({ code: "RUN_CANCELLED" });
  });

  it("turns forged worker ownership into a typed terminal failure", async () => {
    const coordinator = new ReadonlySubagentCoordinator(
      coordinatorContext
    );
    const merged = await coordinator.run(
      [workerRequests[0]],
      async (assignment) => {
        const forgedAssignment: WorkerAssignment = {
          ...assignment,
          ownership: {
            ...assignment.ownership,
            runId: "another_run",
          },
        };
        return completedResult(forgedAssignment);
      }
    );

    expect(merged.status).toBe("failed");
    expect(merged.results[0]).toMatchObject({
      status: "failed",
      error: { code: "OWNERSHIP_MISMATCH", retryable: true },
    });
  });

  it("can retry a failed worker or dismiss it without losing the run", async () => {
    const retried = new ReadonlySubagentCoordinator(coordinatorContext);
    const initial = await retried.run(
      [workerRequests[0]],
      async () => {
        throw new Error("temporary provider failure");
      }
    );
    expect(initial.status).toBe("failed");

    const retryResult = await retried.retry(
      "explorer",
      async (assignment) => completedResult(assignment)
    );
    expect(retryResult.status).toBe("completed");
    expect(retried.mergeResults().status).toBe("completed");
    expect(retried.getWorkerSnapshots()[0].attempts).toBe(2);

    const dismissed = new ReadonlySubagentCoordinator({
      ...coordinatorContext,
      runId: "run_dismissed",
    });
    await dismissed.run([workerRequests[0]], async () => {
      throw new Error("non-blocking review failure");
    });
    dismissed.dismiss("explorer", "Coordinator accepted the missing review");
    expect(dismissed.mergeResults()).toMatchObject({
      status: "partial",
      results: [{ status: "dismissed" }],
      dispositions: [{ disposition: "dismissed" }],
    });
  });
});

describe("ownership-scoped evidence", () => {
  it("rejects cross-run and cross-worker plan updates", () => {
    const actor: WorkerAgentContext = {
      kind: "worker",
      runId: "run_alpha",
      agentId: "explorer",
      coordinatorId: "lead",
      planId: "plan_alpha",
      stepId: "inspect",
      role: "studio_explorer",
      depth: 1,
    };

    expect(() =>
      assertPlanStepOwnership(actor, {
        runId: "another_run",
        planId: "plan_alpha",
        stepId: "inspect",
        ownerId: "explorer",
      })
    ).toThrowError(expect.objectContaining({ code: "OWNERSHIP_MISMATCH" }));
    expect(() =>
      assertPlanStepOwnership(actor, {
        runId: "run_alpha",
        planId: "plan_alpha",
        stepId: "review",
        ownerId: "reviewer",
      })
    ).toThrowError(expect.objectContaining({ code: "OWNERSHIP_MISMATCH" }));
  });

  it("requires both matching ownership and complete resource coverage", () => {
    const ownership = {
      runId: "run_alpha",
      coordinatorId: "lead",
      workerId: "explorer",
      planId: "plan_alpha",
      stepId: "inspect",
    };
    const evidence: WorkerEvidenceReference = {
      id: "tree_readback",
      kind: "studio_readback",
      summary: "Read back two owned paths",
      resourceKeys: ["game.Workspace.B9", "game.ReplicatedStorage.B9"],
      ownership,
    };

    expect(
      canEvidenceVerifyTarget(evidence, {
        runId: "run_alpha",
        planId: "plan_alpha",
        stepId: "inspect",
        ownerId: "explorer",
        resourceKeys: ["game.Workspace.B9"],
      })
    ).toBe(true);
    expect(
      canEvidenceVerifyTarget(evidence, {
        runId: "run_alpha",
        planId: "plan_alpha",
        stepId: "inspect",
        ownerId: "reviewer",
        resourceKeys: ["game.Workspace.B9"],
      })
    ).toBe(false);
    expect(
      canEvidenceVerifyTarget(evidence, {
        runId: "run_alpha",
        planId: "plan_alpha",
        stepId: "inspect",
        ownerId: "explorer",
        resourceKeys: ["game.ServerScriptService.Unrelated"],
      })
    ).toBe(false);
  });
});

describe("SubagentPolicyError", () => {
  it("keeps a stable machine-readable policy code", () => {
    const error = new SubagentPolicyError(
      "TOOL_NOT_ALLOWED",
      "Mutation denied"
    );
    expect(error).toMatchObject({
      name: "SubagentPolicyError",
      code: "TOOL_NOT_ALLOWED",
      message: "Mutation denied",
    });
  });
});

