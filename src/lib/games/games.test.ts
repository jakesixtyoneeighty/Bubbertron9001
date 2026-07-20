import { beforeEach, describe, expect, it } from "vitest"
import {
  MAX_CHANGE_SET_ASSERTIONS,
  MAX_CHANGE_SET_OPERATIONS,
  MAX_CHANGE_SET_INSTANCES,
  STUDIO_SNAPSHOT_SCHEMA_VERSION,
  clearGameTemplateCache,
  gameBuilderService,
  getChangeSetValidationIssues,
  getGameCatalog,
  getGameCatalogSummary,
  getGameTemplate,
  isGameTemplateId,
  loadGameTemplate,
  sha256Schema,
  type ChangeSet,
  type GameBuildRequest,
  type PropertyValue,
  type StudioSnapshot,
} from "./index"
import { sha256 } from "./sha256"

const buildRequest: GameBuildRequest = {
  templateId: "obby-starter",
  templateVersion: "1.0.0",
  options: {
    stages: 10,
    difficulty: "standard",
    visualStyle: "bright",
  },
  context: {
    runId: "run-obby-test",
    agentId: "coordinator",
    planId: "plan-one-click-game",
    stepId: "generate-obby",
  },
  base: {
    studioRevision: "revision-42",
    contentHashes: {},
  },
  generationId: "generation-obby-test",
}

function blankSnapshot(changeSet: ChangeSet): StudioSnapshot {
  return {
    schemaVersion: STUDIO_SNAPSHOT_SCHEMA_VERSION,
    revision: changeSet.base.studioRevision,
    completePaths: changeSet.claims.map((claim) => claim.path),
    contentHashes: { ...changeSet.base.contentHashes },
    instances: [],
  }
}

function installedSnapshot(changeSet: ChangeSet): StudioSnapshot {
  const properties = new Map<string, Record<string, PropertyValue>>()
  const scriptHashes = new Map<string, string>()
  for (const operation of changeSet.operations) {
    if (operation.type === "set_property") {
      const targetProperties = properties.get(operation.targetPath) ?? {}
      targetProperties[operation.property] = operation.value
      properties.set(operation.targetPath, targetProperties)
    } else if (operation.type === "set_script_source") {
      scriptHashes.set(operation.targetPath, operation.sourceHash)
    }
  }

  return {
    ...blankSnapshot(changeSet),
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

describe("one-click game catalog and trusted assets", () => {
  beforeEach(() => {
    clearGameTemplateCache()
  })

  it("keeps a compact, allowlisted catalog and rejects path-like IDs", () => {
    expect(getGameCatalog()).toHaveLength(1)
    expect(getGameCatalogSummary()).toContain("obby-starter@1.0.0")
    expect(isGameTemplateId("obby-starter")).toBe(true)

    for (const id of ["../obby", "obby/manifest.json", "OBBY-STARTER", "fps"]) {
      expect(isGameTemplateId(id)).toBe(false)
      expect(getGameTemplate(id)).toBeUndefined()
      expect(() => loadGameTemplate(id)).toThrow(/Unknown game template/)
    }
  })

  it("lazy-loads, verifies, and caches the reviewed manifest and scripts", async () => {
    const first = await loadGameTemplate("obby-starter")
    const cached = await loadGameTemplate("obby-starter")

    expect(cached).toBe(first)
    expect(first.manifest.schemaVersion).toBe("b9.game-template/v1")
    expect(first.scripts).toHaveLength(2)
    for (const script of first.scripts) {
      expect(sha256Schema.parse(sha256(script.source))).toBe(script.sha256)
      expect(script.source).not.toContain("HttpService")
      expect(script.source).not.toContain("loadstring")
    }
  })

  it("uses a standards-compatible deterministic SHA-256 implementation", () => {
    expect(sha256("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    )
  })
})

describe("Obby Starter v1 compiler", () => {
  beforeEach(() => {
    clearGameTemplateCache()
  })

  it("compiles identical input to an identical bounded, fully verified change set", async () => {
    const first = await gameBuilderService.compile(buildRequest)
    clearGameTemplateCache()
    const second = await gameBuilderService.compile(structuredClone(buildRequest))

    expect(second).toEqual(first)
    expect(first.operations.length).toBeLessThanOrEqual(MAX_CHANGE_SET_OPERATIONS)
    expect(first.verification.length).toBeLessThanOrEqual(MAX_CHANGE_SET_ASSERTIONS)
    expect(first.ownership.ownedPaths.length).toBeLessThanOrEqual(MAX_CHANGE_SET_INSTANCES)
    expect(first.preview).toMatchObject({
      optionLabels: ["10 stages", "standard difficulty", "bright style"],
      conflicts: [],
      completionLabel: "Ready to playtest",
      handoff: "playtest-and-fix",
    })
    expect(first.operations.every((operation) => [
      "create_instance",
      "set_property",
      "set_script_source",
    ].includes(operation.type))).toBe(true)
    expect(first.operations.some((operation) => operation.type === "set_script_source")).toBe(true)
    expect(first.verification).toHaveLength(first.operations.length + first.preview.additions.instances)
  })

  it("supports every curated option bound without exceeding manifest limits", async () => {
    const largest = await gameBuilderService.compile({
      ...buildRequest,
      options: {
        stages: 15,
        difficulty: "challenging",
        visualStyle: "nature",
      },
    })

    expect(largest.preview.optionLabels).toEqual([
      "15 stages",
      "challenging difficulty",
      "nature style",
    ])
    expect(largest.operations.length).toBeLessThanOrEqual(MAX_CHANGE_SET_OPERATIONS)
    expect(largest.ownership.ownedPaths).toContain(
      "game.Workspace.B9_Obby.Checkpoints.Checkpoint_15",
    )
  })

  it("rejects invalid options and detects path, fingerprint, and script tampering", async () => {
    await expect(gameBuilderService.compile({
      ...buildRequest,
      options: { stages: 100, difficulty: "easy", visualStyle: "bright" },
    })).rejects.toThrow()

    const compiled = await gameBuilderService.compile(buildRequest)
    const template = await loadGameTemplate("obby-starter")
    const tampered = structuredClone(compiled)
    const script = tampered.operations.find(
      (operation) => operation.type === "set_script_source",
    )
    if (!script || script.type !== "set_script_source") {
      throw new Error("Expected a script operation")
    }
    script.source = `${script.source}\nprint(\"unreviewed\")`

    const issues = getChangeSetValidationIssues(tampered, template.scripts)
    expect(issues.join("\n")).toMatch(/hash mismatch|exact reviewed bundled asset/)
    expect(issues.join("\n")).toContain("fingerprint")

    const invalidPath = structuredClone(compiled) as unknown as {
      operations: Array<{ targetPath: string }>
    }
    invalidPath.operations[0]!.targetPath = "game.Workspace.B9_Obby.Bad-Name"
    expect(getChangeSetValidationIssues(invalidPath, template.scripts).join("\n"))
      .toContain("operations.0.targetPath")
  })
})

describe("One-click game preflight and recovery", () => {
  it("accepts blank and unrelated non-empty places without touching unrelated content", async () => {
    const changeSet = await gameBuilderService.compile(buildRequest)
    const blank = await gameBuilderService.prepare(buildRequest, blankSnapshot(changeSet))
    expect(blank.preflight.status).toBe("ready")
    expect(blank.preflight.remainingOperationIds).toHaveLength(changeSet.operations.length)

    const nonEmpty = blankSnapshot(changeSet)
    nonEmpty.instances.push({
      path: "game.Workspace.ExistingHouse",
      className: "Model",
    })
    const prepared = await gameBuilderService.prepare(buildRequest, nonEmpty)
    expect(prepared.preflight.status).toBe("ready")
    expect(prepared.preflight.conflicts).toEqual([])
  })

  it("blocks foreign name collisions and surfaces them in the stable preview", async () => {
    const changeSet = await gameBuilderService.compile(buildRequest)
    const snapshot = blankSnapshot(changeSet)
    snapshot.instances.push({
      path: "game.Workspace.B9_Obby",
      className: "Model",
    })

    const prepared = await gameBuilderService.prepare(buildRequest, snapshot)
    expect(prepared.preflight.status).toBe("blocked")
    expect(prepared.preflight.canInstall).toBe(false)
    expect(prepared.preflight.remainingOperationIds).toEqual([])
    expect(prepared.preflight.preview.conflicts[0]).toContain("already exists")
  })

  it("turns an exact retry into a no-op and a partial install into an owned resume", async () => {
    const changeSet = await gameBuilderService.compile(buildRequest)
    const retry = await gameBuilderService.prepare(
      buildRequest,
      installedSnapshot(changeSet),
    )
    expect(retry.preflight).toMatchObject({
      status: "already_installed",
      retryIsNoOp: true,
      canInstall: false,
      remainingOperationIds: [],
    })

    const partial = installedSnapshot(changeSet)
    partial.instances = partial.instances.slice(0, 4)
    const resume = await gameBuilderService.prepare(buildRequest, partial)
    const existingPaths = new Set(partial.instances.map((instance) => instance.path))
    const existingCreateIds = changeSet.operations.flatMap((operation) => (
      operation.type === "create_instance" && existingPaths.has(operation.targetPath)
        ? [operation.operationId]
        : []
    ))

    expect(resume.preflight.status).toBe("resume_available")
    expect(resume.preflight.canInstall).toBe(true)
    expect(resume.preflight.conflicts[0]?.code).toBe("partial_generation")
    expect(resume.preflight.remainingOperationIds).not.toEqual([])
    expect(resume.preflight.remainingOperationIds).not.toEqual(
      expect.arrayContaining(existingCreateIds),
    )
  })

  it("blocks stale or incomplete readbacks before any operation can start", async () => {
    const changeSet = await gameBuilderService.compile(buildRequest)
    const stale = blankSnapshot(changeSet)
    stale.revision = "revision-43"
    stale.completePaths = stale.completePaths.slice(0, 1)

    const prepared = await gameBuilderService.prepare(buildRequest, stale)
    expect(prepared.preflight.status).toBe("blocked")
    expect(prepared.preflight.remainingOperationIds).toEqual([])
    expect(prepared.preflight.conflicts.map((conflict) => conflict.code)).toEqual(
      expect.arrayContaining(["stale_revision", "incomplete_snapshot"]),
    )
  })

  it("removes only exact owned paths and preserves parents with unknown descendants", async () => {
    const changeSet = await gameBuilderService.compile(buildRequest)
    const snapshot = installedSnapshot(changeSet)
    snapshot.instances.push({
      path: "game.Workspace.B9_Obby.CustomPart",
      className: "Part",
    })

    const removal = await gameBuilderService.planRemoval(changeSet, snapshot)
    expect(removal.paths).not.toContain("game.Workspace.B9_Obby.CustomPart")
    expect(removal.paths).not.toContain("game.Workspace.B9_Obby")
    expect(removal.preservedParentPaths).toContain("game.Workspace.B9_Obby")
    const lastRemovalPath = removal.paths[removal.paths.length - 1]
    expect(removal.paths[0]?.split(".").length)
      .toBeGreaterThanOrEqual(lastRemovalPath?.split(".").length ?? 0)

    const foreign = installedSnapshot(changeSet)
    foreign.instances[0] = {
      ...foreign.instances[0]!,
      ownership: {
        ...changeSet.ownership.marker,
        generationId: "different-generation",
      },
    }
    await expect(gameBuilderService.planRemoval(changeSet, foreign))
      .rejects.toThrow(/Refusing to remove/)
  })
})
