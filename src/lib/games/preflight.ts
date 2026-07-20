import {
  gameBuildPreflightSchema,
  removalPlanSchema,
  studioSnapshotSchema,
  type GameBuildPreflight,
  type OwnershipMarker,
  type PreviewConflict,
  type RemovalPlan,
  type StudioSnapshot,
} from "./schema"
import { stableSerialize } from "./sha256"
import {
  validateChangeSet,
  type ChangeSetValidationError,
} from "./compiler"
import type { LoadedTrustedScript } from "./registry"

function isPathWithin(path: string, root: string) {
  return path === root || path.startsWith(`${root}.`)
}

function valuesEqual(left: unknown, right: unknown) {
  return stableSerialize(left) === stableSerialize(right)
}

function ownershipMatches(
  actual: OwnershipMarker | undefined,
  expected: OwnershipMarker,
) {
  return actual !== undefined && valuesEqual(actual, expected)
}

function sortConflicts(conflicts: PreviewConflict[]) {
  return conflicts.sort((left, right) => (
    left.code.localeCompare(right.code)
    || (left.path ?? "").localeCompare(right.path ?? "")
    || left.message.localeCompare(right.message)
  ))
}

function hasCompleteReadback(snapshot: StudioSnapshot, claimPath: string) {
  return snapshot.completePaths.some((path) => isPathWithin(claimPath, path))
}

export function preflightChangeSet(
  input: unknown,
  snapshotInput: unknown,
  trustedScripts: readonly LoadedTrustedScript[],
): GameBuildPreflight {
  const changeSet = validateChangeSet(input, trustedScripts)
  const snapshot = studioSnapshotSchema.parse(snapshotInput)
  const conflicts: PreviewConflict[] = []
  const blockingCodes = new Set<PreviewConflict["code"]>([
    "stale_revision",
    "stale_content",
    "incomplete_snapshot",
    "name_collision",
    "ownership_conflict",
    "invalid_existing_instance",
  ])

  if (snapshot.revision !== changeSet.base.studioRevision) {
    conflicts.push({
      code: "stale_revision",
      message: `Preview used Studio revision ${changeSet.base.studioRevision}, but the current revision is ${snapshot.revision}.`,
    })
  }
  for (const claim of changeSet.claims) {
    if (!hasCompleteReadback(snapshot, claim.path)) {
      conflicts.push({
        code: "incomplete_snapshot",
        path: claim.path,
        message: `A complete readback is required for ${claim.path}.`,
      })
    }
  }
  for (const [path, expectedHash] of Object.entries(changeSet.base.contentHashes)) {
    if (snapshot.contentHashes[path] !== expectedHash) {
      conflicts.push({
        code: "stale_content",
        path,
        message: `Content at ${path} changed after the preview was created.`,
      })
    }
  }

  const instanceByPath = new Map<string, StudioSnapshot["instances"][number]>()
  for (const instance of snapshot.instances) {
    if (instanceByPath.has(instance.path)) {
      conflicts.push({
        code: "invalid_existing_instance",
        path: instance.path,
        message: `Studio returned duplicate readback entries for ${instance.path}.`,
      })
      continue
    }
    instanceByPath.set(instance.path, instance)
  }

  const expectedPaths = new Set(changeSet.ownership.ownedPaths)
  for (const instance of snapshot.instances) {
    if (
      ownershipMatches(instance.ownership, changeSet.ownership.marker)
      && !expectedPaths.has(instance.path)
    ) {
      conflicts.push({
        code: "ownership_conflict",
        path: instance.path,
        message: `Generation ${changeSet.ownership.marker.generationId} also owns an unexpected path.`,
      })
    }
  }

  const createOperations = changeSet.operations.filter(
    (operation) => operation.type === "create_instance",
  )
  let existingOwnedCount = 0
  for (const operation of createOperations) {
    const existing = instanceByPath.get(operation.targetPath)
    if (!existing) {
      continue
    }
    if (!existing.ownership) {
      conflicts.push({
        code: "name_collision",
        path: operation.targetPath,
        message: `${operation.targetPath} already exists and is not owned by this generation.`,
      })
      continue
    }
    if (!ownershipMatches(existing.ownership, changeSet.ownership.marker)) {
      conflicts.push({
        code: "ownership_conflict",
        path: operation.targetPath,
        message: `${operation.targetPath} belongs to a different generation or template.`,
      })
      continue
    }
    existingOwnedCount += 1
    if (existing.className !== operation.className) {
      conflicts.push({
        code: "invalid_existing_instance",
        path: operation.targetPath,
        message: `${operation.targetPath} has class ${existing.className}; expected ${operation.className}.`,
      })
    }
  }

  const hasBlockingConflict = conflicts.some((conflict) => blockingCodes.has(conflict.code))
  let remainingOperationIds: string[] = []
  if (!hasBlockingConflict) {
    remainingOperationIds = changeSet.operations.flatMap((operation) => {
      const existing = instanceByPath.get(operation.targetPath)
      if (operation.type === "create_instance") {
        return existing ? [] : [operation.operationId]
      }
      if (!existing) {
        return [operation.operationId]
      }
      if (operation.type === "set_property") {
        return valuesEqual(existing.properties?.[operation.property], operation.value)
          ? []
          : [operation.operationId]
      }
      return existing.scriptHash === operation.sourceHash ? [] : [operation.operationId]
    })
  }

  const allInstancesExist = existingOwnedCount === createOperations.length
  const completeInstallation = allInstancesExist && remainingOperationIds.length === 0
  if (
    !hasBlockingConflict
    && existingOwnedCount > 0
    && !completeInstallation
  ) {
    conflicts.push({
      code: "partial_generation",
      message: `Generation ${changeSet.ownership.marker.generationId} is incomplete and can be resumed without recreating owned instances.`,
    })
  }

  sortConflicts(conflicts)
  const status = hasBlockingConflict
    ? "blocked"
    : completeInstallation
      ? "already_installed"
      : existingOwnedCount > 0
        ? "resume_available"
        : "ready"
  const result: GameBuildPreflight = {
    status,
    canInstall: status === "ready" || status === "resume_available",
    retryIsNoOp: status === "already_installed",
    conflicts,
    remainingOperationIds: hasBlockingConflict ? [] : remainingOperationIds,
    preview: {
      ...changeSet.preview,
      conflicts: conflicts.map((conflict) => conflict.message),
    },
  }
  return gameBuildPreflightSchema.parse(result)
}

export function createRemovalPlan(
  input: unknown,
  snapshotInput: unknown,
  trustedScripts: readonly LoadedTrustedScript[],
): RemovalPlan {
  const changeSet = validateChangeSet(input, trustedScripts)
  const snapshot = studioSnapshotSchema.parse(snapshotInput)
  const instanceByPath = new Map(snapshot.instances.map((instance) => [instance.path, instance]))
  const expectedPaths = new Set(changeSet.ownership.ownedPaths)
  const skippedMissingPaths: string[] = []
  const preservedParentPaths: string[] = []
  const paths: string[] = []

  for (const path of changeSet.cleanup.paths) {
    const existing = instanceByPath.get(path)
    if (!existing) {
      skippedMissingPaths.push(path)
      continue
    }
    if (!ownershipMatches(existing.ownership, changeSet.ownership.marker)) {
      throw new Error(`Refusing to remove unowned or differently owned path: ${path}`)
    }

    const hasUnknownDescendant = snapshot.instances.some((instance) => (
      instance.path !== path
      && isPathWithin(instance.path, path)
      && !expectedPaths.has(instance.path)
    ))
    if (hasUnknownDescendant) {
      preservedParentPaths.push(path)
      continue
    }
    paths.push(path)
  }

  return removalPlanSchema.parse({
    generationId: changeSet.ownership.marker.generationId,
    paths,
    skippedMissingPaths,
    preservedParentPaths,
    requireOwnershipMatch: true,
    preserveUnknownDescendants: true,
  })
}

export type { ChangeSetValidationError }
