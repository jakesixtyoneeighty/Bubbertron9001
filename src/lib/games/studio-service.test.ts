import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/roblox/client", () => ({
  studioRequest: vi.fn(),
  cancelStudioOperation: vi.fn(),
  getStudioOperationStatus: vi.fn(),
}))

import {
  cancelStudioOperation,
  getStudioOperationStatus,
  studioRequest,
} from "@/lib/roblox/client"
import {
  resetStudioMutationLaneForTests,
  withStudioMutationLease,
} from "@/lib/agent/mutation-lane"
import {
  STUDIO_SNAPSHOT_SCHEMA_VERSION,
  gameBuilderService,
  type ChangeSet,
  type GameBuildDraft,
  type GameMutationProgress,
  type PropertyValue,
  type StudioSnapshot,
} from "./index"

const studioRequestMock = vi.mocked(studioRequest)
const cancelOperationMock = vi.mocked(cancelStudioOperation)
const operationStatusMock = vi.mocked(getStudioOperationStatus)

const draft: GameBuildDraft = {
  templateId: "obby-starter",
  templateVersion: "1.0.0",
  options: {
    stages: 5,
    difficulty: "standard",
    visualStyle: "bright",
  },
  context: {
    runId: "run-live-game-test",
    agentId: "coordinator",
    planId: "plan-live-game-test",
    stepId: "install-starter",
  },
  generationId: "generation-live-game-test",
}

async function compileAt(revision: string, input: GameBuildDraft = draft) {
  return gameBuilderService.compile({
    ...input,
    base: { studioRevision: revision, contentHashes: {} },
  })
}

function blankSnapshot(changeSet: ChangeSet, revision = changeSet.base.studioRevision): StudioSnapshot {
  return {
    schemaVersion: STUDIO_SNAPSHOT_SCHEMA_VERSION,
    revision,
    completePaths: changeSet.claims.map((claim) => claim.path),
    contentHashes: {},
    instances: [],
  }
}

function installedSnapshot(changeSet: ChangeSet, revision: string): StudioSnapshot {
  const properties = new Map<string, Record<string, PropertyValue>>()
  const scriptHashes = new Map<string, string>()
  for (const operation of changeSet.operations) {
    if (operation.type === "set_property") {
      const values = properties.get(operation.targetPath) ?? {}
      values[operation.property] = operation.value
      properties.set(operation.targetPath, values)
    } else if (operation.type === "set_script_source") {
      scriptHashes.set(operation.targetPath, operation.sourceHash)
    }
  }
  return {
    ...blankSnapshot(changeSet, revision),
    instances: changeSet.operations.flatMap((operation) => (
      operation.type === "create_instance"
        ? [{
            path: operation.targetPath,
            className: operation.className,
            ownership: operation.ownership,
            properties: properties.get(operation.targetPath) ?? {},
            scriptHash: scriptHashes.get(operation.targetPath),
          }]
        : []
    )),
  }
}

function verificationIds(changeSet: ChangeSet) {
  return changeSet.verification.map((assertion) => assertion.assertionId)
}

describe("GameBuilderService Studio gateway", () => {
  beforeEach(() => {
    studioRequestMock.mockReset()
    cancelOperationMock.mockReset()
    operationStatusMock.mockReset()
    cancelOperationMock.mockImplementation(async (operationId) => ({
      operation_id: operationId,
      request_id: `request-${operationId}`,
      status: "completed",
      leased: true,
      may_complete: false,
      completed_after_cancel: false,
    }))
  })

  afterEach(() => {
    resetStudioMutationLaneForTests()
  })

  it("creates a bounded draft without accepting a caller-supplied Studio base", () => {
    const created = gameBuilderService.createDraft({
      templateId: "obby-starter",
      options: draft.options,
    })

    expect(created).toMatchObject({
      templateId: "obby-starter",
      templateVersion: "1.0.0",
      context: {
        agentId: "coordinator",
        stepId: "install-starter",
      },
    })
    expect(created.generationId).toBeUndefined()
    expect(() => gameBuilderService.createDraft({
      templateId: "obby-starter",
      options: draft.options,
      context: { agentId: "explorer" },
    })).toThrow(/Only the coordinator/)
    expect(() => gameBuilderService.createDraft({
      templateId: "../obby",
      options: draft.options,
    })).toThrow(/Unknown game template/)
  })

  it("rechecks live Studio, installs only remaining operations, verifies, and reads back", async () => {
    const changeSet = await compileAt("revision-before-install")
    const blank = blankSnapshot(changeSet)
    const installed = installedSnapshot(changeSet, "revision-after-install")
    studioRequestMock
      .mockResolvedValueOnce({ success: true, data: blank })
      .mockResolvedValueOnce({
        success: true,
        data: {
          status: "installed",
          generationId: changeSet.ownership.marker.generationId,
          appliedOperationIds: changeSet.operations.map((operation) => operation.operationId),
          verifiedAssertionIds: verificationIds(changeSet),
          verified: true,
          completionLabel: "Ready to playtest",
          handoff: "playtest-and-fix",
        },
      })
      .mockResolvedValueOnce({
        success: true,
        data: { verified: true, verifiedAssertionIds: verificationIds(changeSet) },
      })
      .mockResolvedValueOnce({ success: true, data: installed })

    const result = await gameBuilderService.install(
      draft,
      changeSet.preview.fingerprint,
    )

    expect(result.status).toBe("installed")
    if (result.status !== "installed") throw new Error("Expected installation")
    expect(result.postflight.preflight.status).toBe("already_installed")
    expect(studioRequestMock).toHaveBeenCalledTimes(4)
    expect(studioRequestMock.mock.calls.map(([endpoint]) => endpoint)).toEqual([
      "/game/snapshot",
      "/game/install",
      "/game/verify",
      "/game/snapshot",
    ])
    expect(studioRequestMock.mock.calls[1]?.[1]).toMatchObject({
      operationIds: changeSet.operations.map((operation) => operation.operationId),
    })
    expect(studioRequestMock.mock.calls[1]?.[3]).toMatchObject({
      runId: draft.context.runId,
      ownerId: draft.context.agentId,
      stepId: draft.context.stepId,
      capability: "template_install",
      target: "game-template:obby-starter",
      timeoutMs: 60_000,
    })
  })

  it("rejects receipts that claim the wrong verification assertions", async () => {
    const changeSet = await compileAt("revision-wrong-assertions")
    const blank = blankSnapshot(changeSet)
    const wrongAssertionIds = verificationIds(changeSet)
    wrongAssertionIds[0] = "verify-forged"
    studioRequestMock
      .mockResolvedValueOnce({ success: true, data: blank })
      .mockResolvedValueOnce({
        success: true,
        data: {
          status: "installed",
          generationId: changeSet.ownership.marker.generationId,
          appliedOperationIds: changeSet.operations.map(
            (operation) => operation.operationId,
          ),
          verifiedAssertionIds: wrongAssertionIds,
          verified: true,
          completionLabel: "Ready to playtest",
          handoff: "playtest-and-fix",
        },
      })
      .mockResolvedValueOnce({ success: true, data: blank })

    await expect(
      gameBuilderService.install(draft, changeSet.preview.fingerprint),
    ).resolves.toMatchObject({
      status: "partial_failure",
      phase: "install",
      error: expect.stringContaining("exact starter assertions"),
    })
  })

  it("blocks a changed approval or live collision before requesting installation", async () => {
    const changeSet = await compileAt("revision-blocked")
    const collision = blankSnapshot(changeSet)
    collision.instances.push({
      path: "game.Workspace.B9_Obby",
      className: "Model",
    })
    studioRequestMock.mockResolvedValueOnce({ success: true, data: collision })

    const blocked = await gameBuilderService.install(
      draft,
      changeSet.preview.fingerprint,
    )

    expect(blocked.status).toBe("blocked")
    if (blocked.status !== "blocked") throw new Error("Expected blocked install")
    expect(blocked.reason).toBe("conflicts")
    expect(blocked.prepared.preflight.conflicts[0]?.code).toBe("name_collision")
    expect(studioRequestMock).toHaveBeenCalledTimes(1)
    expect(studioRequestMock.mock.calls[0]?.[3]).toMatchObject({ capability: "read" })
  })

  it("surfaces a failed mutation with a fresh recovery readback", async () => {
    const changeSet = await compileAt("revision-recovery")
    const blank = blankSnapshot(changeSet)
    const partial = installedSnapshot(changeSet, "revision-partial")
    partial.instances = partial.instances.slice(0, 3)
    studioRequestMock
      .mockResolvedValueOnce({ success: true, data: blank })
      .mockResolvedValueOnce({
        success: false,
        error: "install interrupted",
        operationId: "game-install-interrupted",
        operationStatus: {
          operation_id: "game-install-interrupted",
          request_id: "request-install-interrupted",
          status: "failed",
          leased: true,
          may_complete: false,
          completed_after_cancel: false,
        },
      })
      .mockResolvedValueOnce({ success: true, data: partial })

    const result = await gameBuilderService.install(
      draft,
      changeSet.preview.fingerprint,
    )

    expect(result).toMatchObject({
      status: "partial_failure",
      phase: "install",
      error: "install interrupted",
      recovery: { preflight: { status: "resume_available" } },
    })
    expect(studioRequestMock.mock.calls.map(([endpoint]) => endpoint)).toEqual([
      "/game/snapshot",
      "/game/install",
      "/game/snapshot",
    ])
  })

  it("holds the mutation lane through leased cancellation, late completion, and readback", async () => {
    const changeSet = await compileAt("revision-before-stop")
    const blank = blankSnapshot(changeSet)
    const installed = installedSnapshot(changeSet, "revision-after-late-completion")
    let resolveFinalStatus!: (status: {
      operation_id: string
      request_id: string
      status: "completed"
      leased: boolean
      may_complete: boolean
      completed_after_cancel: boolean
    }) => void
    operationStatusMock.mockReturnValueOnce(new Promise((resolve) => {
      resolveFinalStatus = resolve
    }))
    cancelOperationMock.mockImplementationOnce(async (operationId) => ({
      operation_id: operationId,
      request_id: "request-leased-install",
      status: "cancel_requested",
      leased: true,
      may_complete: true,
      completed_after_cancel: false,
    }))
    studioRequestMock
      .mockResolvedValueOnce({ success: true, data: blank })
      .mockImplementationOnce(async (_endpoint, _data, signal, context) => {
        await new Promise<void>((resolve) => {
          signal?.addEventListener("abort", () => resolve(), { once: true })
        })
        return {
          success: false as const,
          error: "Agent run cancelled",
          operationId: context?.operationId ?? "missing-operation",
          operationStatus: {
            operation_id: context?.operationId ?? "missing-operation",
            request_id: "request-leased-install",
            status: "cancel_requested" as const,
            leased: true,
            may_complete: true,
            completed_after_cancel: false,
          },
        }
      })
      .mockResolvedValueOnce({ success: true, data: installed })

    const progress: GameMutationProgress[] = []
    const controller = new AbortController()
    const pending = gameBuilderService.install(
      draft,
      changeSet.preview.fingerprint,
      controller.signal,
      (update) => progress.push(update),
    )
    await vi.waitFor(() => expect(studioRequestMock).toHaveBeenCalledTimes(2))
    controller.abort()
    await vi.waitFor(() => expect(
      progress.some((update) => update.phase === "may_complete"),
    ).toBe(true))

    let nextMutationStarted = false
    const nextMutation = withStudioMutationLease(
      { ownerId: "coordinator" },
      async () => {
        nextMutationStarted = true
      },
    )
    await Promise.resolve()
    expect(nextMutationStarted).toBe(false)

    const operationId = progress.find((update) => update.operationId)?.operationId
      ?? "missing-operation"
    resolveFinalStatus({
      operation_id: operationId,
      request_id: "request-leased-install",
      status: "completed",
      leased: true,
      may_complete: false,
      completed_after_cancel: true,
    })

    const result = await pending
    await nextMutation
    expect(nextMutationStarted).toBe(true)
    expect(result).toMatchObject({
      status: "partial_failure",
      reconciliation: {
        outcome: "late_completed",
        readbackComplete: true,
        operationStatus: { completed_after_cancel: true },
      },
      recovery: { preflight: { status: "already_installed" } },
    })
    expect(progress.map((update) => update.phase)).toEqual(
      expect.arrayContaining([
        "starting",
        "stop_requested",
        "may_complete",
        "late_completed",
        "readback",
      ]),
    )
  })

  it("recovers the single matching owned generation after reopening the launcher", async () => {
    const original = await compileAt("revision-existing")
    const reopened: GameBuildDraft = {
      ...draft,
      generationId: undefined,
      context: {
        runId: "run-reopened-launcher",
        agentId: "game-builder",
        planId: "plan-reopened-launcher",
        stepId: "install-starter",
      },
    }
    studioRequestMock.mockResolvedValueOnce({
      success: true,
      data: installedSnapshot(original, "revision-existing"),
    })

    const prepared = await gameBuilderService.prepareAgainstStudio(reopened)

    expect(prepared.recoveredGenerationId).toBe(draft.generationId)
    expect(prepared.draft.generationId).toBe(draft.generationId)
    expect(prepared.preflight.status).toBe("already_installed")
  })

  it("removes only the planned owned paths and confirms the post-removal readback", async () => {
    const changeSet = await compileAt("revision-before-remove")
    const installed = installedSnapshot(changeSet, "revision-before-remove")
    const plan = await gameBuilderService.planRemoval(changeSet, installed)
    const removedSnapshot = blankSnapshot(changeSet, "revision-after-remove")
    studioRequestMock
      .mockResolvedValueOnce({ success: true, data: installed })
      .mockResolvedValueOnce({
        success: true,
        data: {
          status: "removed",
          generationId: changeSet.ownership.marker.generationId,
          removed: plan.paths,
          preserved: plan.preservedParentPaths,
          skipped: plan.skippedMissingPaths,
          failures: [],
          verified: true,
        },
      })
      .mockResolvedValueOnce({ success: true, data: removedSnapshot })

    const result = await gameBuilderService.remove(draft)

    expect(result.status).toBe("removed")
    if (result.status !== "removed") throw new Error("Expected removal")
    expect(result.receipt.removed).toEqual(plan.paths)
    expect(result.remainingOwnedPaths).toEqual([])
    expect(studioRequestMock.mock.calls.map(([endpoint]) => endpoint)).toEqual([
      "/game/snapshot",
      "/game/remove",
      "/game/snapshot",
    ])
  })

  it("surfaces structured partial removal failures with a recovery snapshot", async () => {
    const changeSet = await compileAt("revision-partial-remove")
    const installed = installedSnapshot(changeSet, "revision-partial-remove")
    const plan = await gameBuilderService.planRemoval(changeSet, installed)
    const failedPath = plan.paths[0]!
    studioRequestMock
      .mockResolvedValueOnce({ success: true, data: installed })
      .mockResolvedValueOnce({
        success: true,
        data: {
          status: "partial",
          generationId: changeSet.ownership.marker.generationId,
          removed: [],
          preserved: [],
          skipped: [],
          failures: [{ path: failedPath, error: "Studio refused deletion" }],
          verified: false,
        },
      })
      .mockResolvedValueOnce({ success: true, data: installed })

    await expect(gameBuilderService.remove(draft)).resolves.toMatchObject({
      status: "partial_failure",
      phase: "remove",
      error: expect.stringContaining("Studio refused deletion"),
      recovery: { snapshot: { revision: "revision-partial-remove" } },
    })
  })
})
