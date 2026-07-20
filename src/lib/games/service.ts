import {
  cancelStudioOperation,
  getStudioOperationStatus,
  studioRequest,
  type StudioCapability,
  type StudioOperationStatus,
  type StudioRequestContext,
} from "@/lib/roblox/client"
import { withStudioMutationLease } from "@/lib/agent/mutation-lane"
import { compileGameTemplate } from "./compiler"
import { createRemovalPlan, preflightChangeSet } from "./preflight"
import {
  getGameCatalog,
  getGameTemplate,
  loadGameTemplate,
  requireGameTemplateId,
  type LoadedGameTemplate,
} from "./registry"
import {
  gameBuildDraftSchema,
  gameBuildRequestSchema,
  gameInstallReceiptSchema,
  gameRemovalReceiptSchema,
  gameVerificationReceiptSchema,
  sha256Schema,
  studioSnapshotSchema,
  type ChangeSet,
  type GameBuildDraft,
  type GameBuildPreflight,
  type GameBuildRequest,
  type GameInstallReceipt,
  type GameRemovalReceipt,
  type GameVerificationReceipt,
  type RemovalPlan,
  type StudioSnapshot,
} from "./schema"
import { hashStable } from "./sha256"

export interface PreparedGameBuild {
  changeSet: ChangeSet
  preflight: GameBuildPreflight
}

export interface PreparedStudioGameBuild extends PreparedGameBuild {
  /** The normalized draft used to compile this preview. It may contain a
   * recovered generation ID when reopening an existing B9 starter. */
  draft: GameBuildDraft
  snapshot: StudioSnapshot
  recoveredGenerationId?: string
}

export type GameStudioPhase =
  | "inspect"
  | "approval"
  | "install"
  | "verify"
  | "readback"
  | "remove"

export type GameMutationAction = "install" | "remove"

export type GameMutationProgressPhase =
  | "starting"
  | "stop_requested"
  | "may_complete"
  | "late_completed"
  | "reconciling"
  | "readback"

export interface GameMutationProgress {
  action: GameMutationAction
  phase: GameMutationProgressPhase
  operationId: string
  message: string
  operationStatus?: StudioOperationStatus
}

export type GameMutationProgressHandler = (progress: GameMutationProgress) => void

export interface GameMutationReconciliation {
  operationId: string
  operationStatus: StudioOperationStatus
  outcome: "cancelled" | "failed" | "late_completed" | "completed_after_error"
  readbackComplete: true
}

export type GameInstallResult =
  | {
      status: "blocked"
      reason: "conflicts" | "preview_changed"
      prepared: PreparedStudioGameBuild
    }
  | {
      status: "already_installed"
      prepared: PreparedStudioGameBuild
      verification: GameVerificationReceipt
      readback: StudioSnapshot
      postflight: PreparedStudioGameBuild
    }
  | {
      status: "installed"
      prepared: PreparedStudioGameBuild
      receipt: GameInstallReceipt
      verification: GameVerificationReceipt
      readback: StudioSnapshot
      postflight: PreparedStudioGameBuild
    }
  | {
      status: "partial_failure"
      phase: GameStudioPhase
      error: string
      prepared?: PreparedStudioGameBuild
      receipt?: GameInstallReceipt
      verification?: GameVerificationReceipt
      readback?: StudioSnapshot
      recovery?: PreparedStudioGameBuild
      reconciliation?: GameMutationReconciliation
    }

export type GameVerificationResult =
  | {
      status: "verified"
      prepared: PreparedStudioGameBuild
      verification: GameVerificationReceipt
      readback: StudioSnapshot
      postflight: PreparedStudioGameBuild
    }
  | {
      status: "not_verified"
      phase: "inspect" | "verify" | "readback"
      error: string
      prepared?: PreparedStudioGameBuild
      readback?: StudioSnapshot
      recovery?: PreparedStudioGameBuild
    }

export type GameRemovalResult =
  | {
      status: "already_removed"
      prepared: PreparedStudioGameBuild
      plan: RemovalPlan
      readback: StudioSnapshot
    }
  | {
      status: "removed"
      prepared: PreparedStudioGameBuild
      plan: RemovalPlan
      receipt: GameRemovalReceipt
      readback: StudioSnapshot
      remainingOwnedPaths: string[]
    }
  | {
      status: "blocked"
      phase: "inspect" | "remove"
      error: string
      prepared?: PreparedStudioGameBuild
      plan?: RemovalPlan
    }
  | {
      status: "partial_failure"
      phase: "remove" | "readback"
      error: string
      prepared: PreparedStudioGameBuild
      plan: RemovalPlan
      receipt?: GameRemovalReceipt
      readback?: StudioSnapshot
      recovery?: PreparedStudioGameBuild
      reconciliation?: GameMutationReconciliation
    }

export interface CreateGameBuildDraftInput {
  templateId: string
  options: unknown
  generationId?: string
  context?: Partial<GameBuildDraft["context"]>
}

export class GameStudioRequestError extends Error {
  readonly phase: GameStudioPhase
  readonly endpoint: string
  readonly operationId?: string
  readonly operationStatus?: StudioOperationStatus | null

  constructor(
    phase: GameStudioPhase,
    endpoint: string,
    message: string,
    operationId?: string,
    operationStatus?: StudioOperationStatus | null,
  ) {
    super(message)
    this.name = "GameStudioRequestError"
    this.phase = phase
    this.endpoint = endpoint
    this.operationId = operationId
    this.operationStatus = operationStatus
  }
}

let draftCounter = 0
let operationCounter = 0

function createLocalId(prefix: string) {
  draftCounter += 1
  const entropy = hashStable({
    prefix,
    now: Date.now(),
    counter: draftCounter,
  }).slice(0, 20)
  return `${prefix}-${entropy}`
}

function createOperationId(action: string, draft: GameBuildDraft) {
  operationCounter += 1
  return `game-${action}-${hashStable({
    action,
    runId: draft.context.runId,
    counter: operationCounter,
    now: Date.now(),
  }).slice(0, 24)}`
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function isPathWithin(path: string, root: string) {
  return path === root || path.startsWith(`${root}.`)
}

function sameStrings(left: readonly string[], right: readonly string[]) {
  const sortedLeft = [...left].sort()
  const sortedRight = [...right].sort()
  return left.length === right.length
    && sortedLeft.every((value, index) => value === sortedRight[index])
}

function requestBase(snapshot: StudioSnapshot) {
  return {
    studioRevision: snapshot.revision,
    contentHashes: { ...snapshot.contentHashes },
  }
}

function requestContext(
  action: string,
  draft: GameBuildDraft,
  capability: StudioCapability,
): StudioRequestContext & { operationId: string } {
  return {
    operationId: createOperationId(action, draft),
    runId: draft.context.runId,
    ownerId: draft.context.agentId,
    stepId: draft.context.stepId,
    capability,
    target: `game-template:${draft.templateId}`,
    timeoutMs: action === "install" ? 60_000 : undefined,
  }
}

function waitForReconciliation(delayMs = 250) {
  return new Promise<void>((resolve) => setTimeout(resolve, delayMs))
}

function isTerminalOperation(status: StudioOperationStatus | null | undefined) {
  return Boolean(
    status
    && !status.may_complete
    && ["completed", "failed", "cancelled"].includes(status.status),
  )
}

function reconciliationOutcome(status: StudioOperationStatus) {
  if (status.completed_after_cancel) return "late_completed" as const
  if (status.status === "completed") return "completed_after_error" as const
  if (status.status === "cancelled") return "cancelled" as const
  return "failed" as const
}

function templateClaimRoots(template: LoadedGameTemplate) {
  return [
    template.manifest.generator.workspaceRoot,
    template.manifest.generator.serverScriptPath,
    template.manifest.generator.progressGuiRoot,
  ]
}

function recoverExistingGeneration(
  draft: GameBuildDraft,
  snapshot: StudioSnapshot,
  template: LoadedGameTemplate,
) {
  if (draft.generationId) return undefined
  const roots = templateClaimRoots(template)
  const generationIds = new Set(
    snapshot.instances.flatMap((instance) => {
      const ownership = instance.ownership
      if (
        !ownership
        || ownership.templateId !== template.manifest.id
        || ownership.templateVersion !== template.manifest.version
        || !roots.some((root) => isPathWithin(instance.path, root))
      ) {
        return []
      }
      return [ownership.generationId]
    }),
  )
  return generationIds.size === 1 ? [...generationIds][0] : undefined
}

/** The sole public coordinator for curated starter games. It accepts an
 * allowlisted template ID and user options, never a caller-supplied manifest. */
export class GameBuilderService {
  getCatalog() {
    return getGameCatalog()
  }

  createDraft(input: CreateGameBuildDraftInput): GameBuildDraft {
    const templateId = requireGameTemplateId(input.templateId)
    const catalogEntry = getGameTemplate(templateId)
    if (!catalogEntry) {
      throw new Error(`Game catalog entry is unavailable: ${templateId}`)
    }
    const workflowId = createLocalId("one-click-game")
    const agentId = input.context?.agentId ?? "coordinator"
    if (agentId !== "coordinator") {
      throw new Error("Only the coordinator can own a starter-game workflow")
    }
    return gameBuildDraftSchema.parse({
      templateId,
      templateVersion: catalogEntry.version,
      options: input.options,
      generationId: input.generationId,
      context: {
        runId: input.context?.runId ?? workflowId,
        agentId,
        planId: input.context?.planId ?? `${workflowId}-plan`,
        stepId: input.context?.stepId ?? "install-starter",
      },
    })
  }

  async getDefaultOptions(templateId: string) {
    const template = await loadGameTemplate(requireGameTemplateId(templateId))
    return {
      stages: template.manifest.options.stages.default,
      difficulty: template.manifest.options.difficulty.default,
      visualStyle: template.manifest.options.visualStyle.default,
    }
  }

  async compile(input: GameBuildRequest): Promise<ChangeSet> {
    const request = gameBuildRequestSchema.parse(input)
    const templateId = requireGameTemplateId(request.templateId)
    const template = await loadGameTemplate(templateId)
    return compileGameTemplate(template, request)
  }

  async prepare(
    input: GameBuildRequest,
    studioSnapshot: unknown,
  ): Promise<PreparedGameBuild> {
    const request = gameBuildRequestSchema.parse(input)
    const template = await loadGameTemplate(requireGameTemplateId(request.templateId))
    const changeSet = compileGameTemplate(template, request)
    return {
      changeSet,
      preflight: preflightChangeSet(changeSet, studioSnapshot, template.scripts),
    }
  }

  async inspect(input: GameBuildDraft, signal?: AbortSignal): Promise<StudioSnapshot> {
    const draft = gameBuildDraftSchema.parse(input)
    await loadGameTemplate(requireGameTemplateId(draft.templateId))
    return this.inspectDraft(draft, signal)
  }

  async prepareAgainstStudio(
    input: GameBuildDraft,
    signal?: AbortSignal,
  ): Promise<PreparedStudioGameBuild> {
    const draft = gameBuildDraftSchema.parse(input)
    const template = await loadGameTemplate(requireGameTemplateId(draft.templateId))
    const snapshot = await this.inspectDraft(draft, signal)
    return this.prepareFromSnapshot(draft, snapshot, template)
  }

  async install(
    input: GameBuildDraft,
    approvedPreviewFingerprint: string,
    signal?: AbortSignal,
    onProgress?: GameMutationProgressHandler,
  ): Promise<GameInstallResult> {
    const approved = sha256Schema.safeParse(approvedPreviewFingerprint)
    if (!approved.success) {
      return {
        status: "partial_failure",
        phase: "approval",
        error: "The approved starter preview fingerprint is invalid",
      }
    }
    let draft: GameBuildDraft
    try {
      draft = gameBuildDraftSchema.parse(input)
    } catch (error) {
      return {
        status: "partial_failure",
        phase: "inspect",
        error: errorMessage(error),
      }
    }

    try {
      return await withStudioMutationLease(
        {
          runId: draft.context.runId,
          ownerId: draft.context.agentId,
          signal,
        },
        async () => {
          let prepared: PreparedStudioGameBuild
          try {
            prepared = await this.prepareAgainstStudio(draft, signal)
          } catch (error) {
            return {
              status: "partial_failure",
              phase: error instanceof GameStudioRequestError ? error.phase : "inspect",
              error: errorMessage(error),
            }
          }

          if (prepared.changeSet.preview.fingerprint !== approvedPreviewFingerprint) {
            return { status: "blocked", reason: "preview_changed", prepared }
          }
          if (prepared.preflight.status === "blocked") {
            return { status: "blocked", reason: "conflicts", prepared }
          }

          if (prepared.preflight.status === "already_installed") {
            const verified = await this.verifyPrepared(prepared, signal)
            if (verified.status !== "verified") {
              return {
                status: "partial_failure",
                phase: verified.phase,
                error: verified.error,
                prepared,
                readback: verified.readback,
                recovery: verified.recovery,
              }
            }
            return {
              status: "already_installed",
              prepared: verified.prepared,
              verification: verified.verification,
              readback: verified.readback,
              postflight: verified.postflight,
            }
          }

          if (prepared.preflight.remainingOperationIds.length === 0) {
            return {
              status: "partial_failure",
              phase: "install",
              error: "Live preflight allowed installation but returned no operations",
              prepared,
            }
          }

          const operationContext = requestContext(
            "install",
            prepared.draft,
            "template_install",
          )
          onProgress?.({
            action: "install",
            phase: "starting",
            operationId: operationContext.operationId,
            message: "Studio is applying the approved starter game.",
          })
          const onStopRequested = () => onProgress?.({
            action: "install",
            phase: "stop_requested",
            operationId: operationContext.operationId,
            message: "Stop requested. B9 is checking whether Studio had already started.",
          })
          signal?.addEventListener("abort", onStopRequested, { once: true })

          let receipt: GameInstallReceipt
          try {
            const response = await studioRequest<unknown>(
              "/game/install",
              {
                changeSet: prepared.changeSet,
                operationIds: prepared.preflight.remainingOperationIds,
              },
              signal,
              operationContext,
            )
            if (!response.success) {
              throw new GameStudioRequestError(
                "install",
                "/game/install",
                response.error,
                response.operationId,
                response.operationStatus,
              )
            }
            receipt = gameInstallReceiptSchema.parse(response.data)
            this.assertInstallReceipt(prepared, receipt)
          } catch (error) {
            const reconciled = await this.reconcileMutation(
              "install",
              prepared.draft,
              operationContext.operationId,
              error,
              onProgress,
            )
            return {
              status: "partial_failure",
              phase: "install",
              error: errorMessage(error),
              prepared,
              readback: reconciled.recovery.snapshot,
              recovery: reconciled.recovery,
              reconciliation: reconciled.reconciliation,
            }
          } finally {
            signal?.removeEventListener("abort", onStopRequested)
          }

          const verified = await this.verifyPrepared(prepared, signal)
          if (verified.status !== "verified") {
            const recovery = verified.recovery ?? await this.recoverUntilReadback(
              "install",
              prepared.draft,
              operationContext.operationId,
              onProgress,
            )
            return {
              status: "partial_failure",
              phase: verified.phase,
              error: verified.error,
              prepared,
              receipt,
              readback: recovery.snapshot,
              recovery,
            }
          }
          return {
            status: "installed",
            prepared: verified.prepared,
            receipt,
            verification: verified.verification,
            readback: verified.readback,
            postflight: verified.postflight,
          }
        },
      )
    } catch (error) {
      return {
        status: "partial_failure",
        phase: "install",
        error: errorMessage(error),
      }
    }
  }

  async verify(
    input: GameBuildDraft,
    signal?: AbortSignal,
  ): Promise<GameVerificationResult> {
    let prepared: PreparedStudioGameBuild
    try {
      prepared = await this.prepareAgainstStudio(input, signal)
    } catch (error) {
      return {
        status: "not_verified",
        phase: "inspect",
        error: errorMessage(error),
      }
    }
    if (prepared.preflight.status !== "already_installed") {
      return {
        status: "not_verified",
        phase: "verify",
        error: prepared.preflight.status === "blocked"
          ? "Studio conflicts block starter verification"
          : "The starter is not completely installed",
        prepared,
        readback: prepared.snapshot,
        recovery: prepared,
      }
    }
    return this.verifyPrepared(prepared, signal)
  }

  async remove(
    input: GameBuildDraft,
    signal?: AbortSignal,
    onProgress?: GameMutationProgressHandler,
  ): Promise<GameRemovalResult> {
    let draft: GameBuildDraft
    try {
      draft = gameBuildDraftSchema.parse(input)
    } catch (error) {
      return {
        status: "blocked",
        phase: "inspect",
        error: errorMessage(error),
      }
    }

    try {
      return await withStudioMutationLease(
        {
          runId: draft.context.runId,
          ownerId: draft.context.agentId,
          signal,
        },
        async () => {
          let prepared: PreparedStudioGameBuild
          try {
            prepared = await this.prepareAgainstStudio(draft, signal)
          } catch (error) {
            return {
              status: "blocked",
              phase: "inspect",
              error: errorMessage(error),
            }
          }

          let plan: RemovalPlan
          try {
            plan = await this.planRemoval(prepared.changeSet, prepared.snapshot)
          } catch (error) {
            return {
              status: "blocked",
              phase: "remove",
              error: errorMessage(error),
              prepared,
            }
          }
          if (plan.paths.length === 0 && plan.preservedParentPaths.length === 0) {
            return {
              status: "already_removed",
              prepared,
              plan,
              readback: prepared.snapshot,
            }
          }

          const operationContext = requestContext(
            "remove",
            prepared.draft,
            "template_install",
          )
          onProgress?.({
            action: "remove",
            phase: "starting",
            operationId: operationContext.operationId,
            message: "Studio is removing the generated starter game.",
          })
          const onStopRequested = () => onProgress?.({
            action: "remove",
            phase: "stop_requested",
            operationId: operationContext.operationId,
            message: "Stop requested. B9 is checking whether Studio had already started.",
          })
          signal?.addEventListener("abort", onStopRequested, { once: true })

          let receipt: GameRemovalReceipt
          try {
            const response = await studioRequest<unknown>(
              "/game/remove",
              { changeSet: prepared.changeSet },
              signal,
              operationContext,
            )
            if (!response.success) {
              throw new GameStudioRequestError(
                "remove",
                "/game/remove",
                response.error,
                response.operationId,
                response.operationStatus,
              )
            }
            receipt = gameRemovalReceiptSchema.parse(response.data)
          } catch (error) {
            const reconciled = await this.reconcileMutation(
              "remove",
              prepared.draft,
              operationContext.operationId,
              error,
              onProgress,
            )
            return {
              status: "partial_failure",
              phase: "remove",
              error: errorMessage(error),
              prepared,
              plan,
              readback: reconciled.recovery.snapshot,
              recovery: reconciled.recovery,
              reconciliation: reconciled.reconciliation,
            }
          } finally {
            signal?.removeEventListener("abort", onStopRequested)
          }

          if (receipt.status === "partial" || !receipt.verified) {
            const details = receipt.failures
              .map((failure) => `${failure.path}: ${failure.error}`)
              .join("; ")
            const recovery = await this.recoverUntilReadback(
              "remove",
              prepared.draft,
              operationContext.operationId,
              onProgress,
            )
            return {
              status: "partial_failure",
              phase: "remove",
              error: details || "Studio reported a partial starter-game removal",
              prepared,
              plan,
              receipt,
              readback: recovery.snapshot,
              recovery,
            }
          }
          this.assertRemovalReceipt(prepared, plan, receipt)

          try {
            onProgress?.({
              action: "remove",
              phase: "readback",
              operationId: operationContext.operationId,
              message: "Removal finished. B9 is checking what remains in Studio.",
            })
            const readback = await this.inspectDraft(prepared.draft, signal)
            for (const path of receipt.removed) {
              if (readback.instances.some((instance) => isPathWithin(instance.path, path))) {
                throw new Error(`Removed starter path is still present: ${path}`)
              }
            }
            for (const path of receipt.preserved) {
              if (!readback.instances.some((instance) => instance.path === path)) {
                throw new Error(`Preserved starter path is missing: ${path}`)
              }
            }
            const marker = prepared.changeSet.ownership.marker
            const remainingOwnedPaths = readback.instances
              .filter((instance) => (
                instance.ownership?.generationId === marker.generationId
                && instance.ownership.templateId === marker.templateId
                && instance.ownership.templateVersion === marker.templateVersion
              ))
              .map((instance) => instance.path)
              .sort()
            return {
              status: "removed",
              prepared,
              plan,
              receipt,
              readback,
              remainingOwnedPaths,
            }
          } catch (error) {
            const recovery = await this.recoverUntilReadback(
              "remove",
              prepared.draft,
              operationContext.operationId,
              onProgress,
            )
            return {
              status: "partial_failure",
              phase: "readback",
              error: errorMessage(error),
              prepared,
              plan,
              receipt,
              readback: recovery.snapshot,
              recovery,
            }
          }
        },
      )
    } catch (error) {
      return {
        status: "blocked",
        phase: "remove",
        error: errorMessage(error),
      }
    }
  }

  async planRemoval(
    changeSet: ChangeSet,
    studioSnapshot: unknown,
  ): Promise<RemovalPlan> {
    const template = await loadGameTemplate(
      requireGameTemplateId(changeSet.source.templateId),
    )
    if (template.manifest.version !== changeSet.source.templateVersion) {
      throw new Error("The bundled template version required for removal is unavailable")
    }
    return createRemovalPlan(changeSet, studioSnapshot, template.scripts)
  }

  private async inspectDraft(draft: GameBuildDraft, signal?: AbortSignal) {
    const response = await studioRequest<unknown>(
      "/game/snapshot",
      { templateId: draft.templateId },
      signal,
      requestContext("inspect", draft, "read"),
    )
    if (!response.success) {
      throw new GameStudioRequestError("inspect", "/game/snapshot", response.error)
    }
    try {
      return studioSnapshotSchema.parse(response.data)
    } catch (error) {
      throw new GameStudioRequestError(
        "inspect",
        "/game/snapshot",
        `Studio returned an invalid starter readback: ${errorMessage(error)}`,
      )
    }
  }

  private prepareFromSnapshot(
    input: GameBuildDraft,
    snapshot: StudioSnapshot,
    template: LoadedGameTemplate,
  ): PreparedStudioGameBuild {
    const recoveredGenerationId = recoverExistingGeneration(input, snapshot, template)
    const draft = recoveredGenerationId
      ? gameBuildDraftSchema.parse({ ...input, generationId: recoveredGenerationId })
      : input
    const request = gameBuildRequestSchema.parse({
      ...draft,
      base: requestBase(snapshot),
    })
    const changeSet = compileGameTemplate(template, request)
    return {
      draft,
      snapshot,
      changeSet,
      recoveredGenerationId,
      preflight: preflightChangeSet(changeSet, snapshot, template.scripts),
    }
  }

  private async verifyPrepared(
    prepared: PreparedStudioGameBuild,
    signal?: AbortSignal,
  ): Promise<GameVerificationResult> {
    let verification: GameVerificationReceipt
    try {
      const response = await studioRequest<unknown>(
        "/game/verify",
        { changeSet: prepared.changeSet },
        signal,
        requestContext("verify", prepared.draft, "read"),
      )
      if (!response.success) {
        throw new GameStudioRequestError("verify", "/game/verify", response.error)
      }
      verification = gameVerificationReceiptSchema.parse(response.data)
      const expectedAssertionIds = prepared.changeSet.verification.map(
        (assertion) => assertion.assertionId,
      )
      if (!sameStrings(verification.verifiedAssertionIds, expectedAssertionIds)) {
        throw new Error("Studio verification did not cover the exact starter assertions")
      }
    } catch (error) {
      const recovery = await this.recoverAfterFailure(prepared.draft)
      return {
        status: "not_verified",
        phase: "verify",
        error: errorMessage(error),
        prepared,
        readback: recovery?.snapshot,
        recovery,
      }
    }

    try {
      const template = await loadGameTemplate(
        requireGameTemplateId(prepared.draft.templateId),
      )
      const readback = await this.inspectDraft(prepared.draft, signal)
      const postflight = this.prepareFromSnapshot(prepared.draft, readback, template)
      if (postflight.preflight.status !== "already_installed") {
        return {
          status: "not_verified",
          phase: "readback",
          error: "Studio readback does not match the complete starter after verification",
          prepared,
          readback,
          recovery: postflight,
        }
      }
      return {
        status: "verified",
        prepared,
        verification,
        readback,
        postflight,
      }
    } catch (error) {
      const recovery = await this.recoverAfterFailure(prepared.draft)
      return {
        status: "not_verified",
        phase: "readback",
        error: errorMessage(error),
        prepared,
        readback: recovery?.snapshot,
        recovery,
      }
    }
  }

  private async reconcileMutation(
    action: GameMutationAction,
    draft: GameBuildDraft,
    expectedOperationId: string,
    error: unknown,
    onProgress?: GameMutationProgressHandler,
  ) {
    const requestError = error instanceof GameStudioRequestError ? error : undefined
    const operationId = requestError?.operationId ?? expectedOperationId
    let operationStatus = requestError?.operationStatus ?? null

    if (!isTerminalOperation(operationStatus)) {
      operationStatus = await cancelStudioOperation(operationId) ?? operationStatus
    }

    while (!isTerminalOperation(operationStatus)) {
      if (
        !operationStatus
        || operationStatus.status === "queued"
        || operationStatus.status === "leased"
      ) {
        operationStatus = await cancelStudioOperation(operationId) ?? operationStatus
        if (isTerminalOperation(operationStatus)) break
      }
      const mayComplete = Boolean(
        operationStatus?.may_complete
        || operationStatus?.status === "leased"
        || operationStatus?.status === "cancel_requested",
      )
      onProgress?.({
        action,
        phase: mayComplete ? "may_complete" : "reconciling",
        operationId,
        operationStatus: operationStatus ?? undefined,
        message: mayComplete
          ? "Studio had already started. It may still finish, so B9 is waiting for a final result."
          : "B9 is confirming that the stopped Studio operation cannot run.",
      })
      await waitForReconciliation()
      operationStatus = await getStudioOperationStatus(operationId) ?? operationStatus
    }

    if (!operationStatus) {
      throw new Error("Studio operation reconciliation ended without a final status")
    }
    if (operationStatus.completed_after_cancel) {
      onProgress?.({
        action,
        phase: "late_completed",
        operationId,
        operationStatus,
        message: "Studio finished after Stop. B9 is reading the place back before continuing.",
      })
    } else {
      onProgress?.({
        action,
        phase: "reconciling",
        operationId,
        operationStatus,
        message: operationStatus.status === "cancelled"
          ? "The Studio operation was stopped before it could finish."
          : "The Studio operation ended. B9 is checking the place before continuing.",
      })
    }

    const recovery = await this.recoverUntilReadback(
      action,
      draft,
      operationId,
      onProgress,
    )
    return {
      reconciliation: {
        operationId,
        operationStatus,
        outcome: reconciliationOutcome(operationStatus),
        readbackComplete: true,
      } satisfies GameMutationReconciliation,
      recovery,
    }
  }

  private async recoverUntilReadback(
    action: GameMutationAction,
    draft: GameBuildDraft,
    operationId: string,
    onProgress?: GameMutationProgressHandler,
  ): Promise<PreparedStudioGameBuild> {
    onProgress?.({
      action,
      phase: "readback",
      operationId,
      message: "B9 is checking Studio one more time before it is safe to continue.",
    })
    while (true) {
      try {
        return await this.prepareAgainstStudio(draft)
      } catch {
        await waitForReconciliation(500)
      }
    }
  }

  private async recoverAfterFailure(draft: GameBuildDraft) {
    try {
      return await this.prepareAgainstStudio(draft)
    } catch {
      return undefined
    }
  }

  private assertInstallReceipt(
    prepared: PreparedStudioGameBuild,
    receipt: GameInstallReceipt,
  ) {
    if (receipt.generationId !== prepared.changeSet.ownership.marker.generationId) {
      throw new Error("Studio installed a different starter generation")
    }
    if (!sameStrings(
      receipt.appliedOperationIds,
      prepared.preflight.remainingOperationIds,
    )) {
      throw new Error("Studio did not report the exact approved starter operations")
    }
    const expectedAssertionIds = prepared.changeSet.verification.map(
      (assertion) => assertion.assertionId,
    )
    if (!sameStrings(receipt.verifiedAssertionIds, expectedAssertionIds)) {
      throw new Error("Studio did not verify the exact starter assertions after installation")
    }
  }

  private assertRemovalReceipt(
    prepared: PreparedStudioGameBuild,
    plan: RemovalPlan,
    receipt: GameRemovalReceipt,
  ) {
    if (receipt.generationId !== prepared.changeSet.ownership.marker.generationId) {
      throw new Error("Studio removed a different starter generation")
    }
    if (!sameStrings(receipt.removed, plan.paths)) {
      throw new Error("Studio did not report the exact owned removal paths")
    }
    if (!sameStrings(receipt.preserved, plan.preservedParentPaths)) {
      throw new Error("Studio did not preserve the expected customized parent paths")
    }
  }
}

export const gameBuilderService = new GameBuilderService()
