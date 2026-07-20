import {
  MAX_CHANGE_SET_INSTANCES,
  MAX_TOTAL_SCRIPT_BYTES,
  changeSetSchema,
  gameBuildRequestSchema,
  obbyGameOptionsSchema,
  type ChangeOperation,
  type ChangeSet,
  type GameBuildRequest,
  type ObbyGameOptions,
  type OwnershipMarker,
  type PropertyValue,
  type VerificationAssertion,
} from "./schema"
import { hashStable, sha256, stableSerialize } from "./sha256"
import type { LoadedGameTemplate, LoadedTrustedScript } from "./registry"

type CreateOperation = Extract<ChangeOperation, { type: "create_instance" }>
type InstanceClassName = CreateOperation["className"]

const BASE_PARENT_PATHS = new Set([
  "game.Workspace",
  "game.ServerScriptService",
  "game.StarterGui",
])

const OWNERSHIP_ATTRIBUTES = {
  generationId: "B9GenerationId",
  templateId: "B9TemplateId",
  templateVersion: "B9TemplateVersion",
} as const

type PropertyKind =
  | "boolean"
  | "number"
  | "string"
  | "vector3"
  | "color3"
  | "udim2"
  | "enum_material"
  | "enum_font"

const ALLOWED_PROPERTIES: Record<InstanceClassName, Readonly<Record<string, PropertyKind>>> = {
  Folder: {},
  Model: {},
  Part: {
    Anchored: "boolean",
    CanCollide: "boolean",
    Color: "color3",
    Material: "enum_material",
    Orientation: "vector3",
    Position: "vector3",
    Size: "vector3",
    Transparency: "number",
  },
  SpawnLocation: {
    Anchored: "boolean",
    CanCollide: "boolean",
    Color: "color3",
    Duration: "number",
    Enabled: "boolean",
    Material: "enum_material",
    Neutral: "boolean",
    Position: "vector3",
    Size: "vector3",
    Transparency: "number",
  },
  Script: {},
  LocalScript: {},
  ScreenGui: {
    DisplayOrder: "number",
    IgnoreGuiInset: "boolean",
    ResetOnSpawn: "boolean",
  },
  TextLabel: {
    BackgroundColor3: "color3",
    BackgroundTransparency: "number",
    Font: "enum_font",
    Position: "udim2",
    Size: "udim2",
    Text: "string",
    TextColor3: "color3",
    TextScaled: "boolean",
  },
}

const ALLOWED_MATERIALS = new Set([
  "Enum.Material.Grass",
  "Enum.Material.Neon",
  "Enum.Material.SmoothPlastic",
])

const ALLOWED_FONTS = new Set(["Enum.Font.GothamBold"])
const ALLOWED_CUSTOM_ATTRIBUTES = new Set(["B9StageNumber"])

export class ChangeSetValidationError extends Error {
  readonly issues: readonly string[]

  constructor(issues: readonly string[]) {
    super(`Invalid change set: ${issues.join("; ")}`)
    this.name = "ChangeSetValidationError"
    this.issues = issues
  }
}

function vector3(x: number, y: number, z: number): PropertyValue {
  return { type: "Vector3", x, y, z }
}

function udim2(
  xScale: number,
  xOffset: number,
  yScale: number,
  yOffset: number,
): PropertyValue {
  return { type: "UDim2", xScale, xOffset, yScale, yOffset }
}

function parentPath(path: string) {
  return path.slice(0, path.lastIndexOf("."))
}

function instanceName(path: string) {
  return path.slice(path.lastIndexOf(".") + 1)
}

function isPathWithin(path: string, root: string) {
  return path === root || path.startsWith(`${root}.`)
}

function depth(path: string) {
  return path.split(".").length
}

function valuesEqual(left: unknown, right: unknown) {
  return stableSerialize(left) === stableSerialize(right)
}

function matchesPropertyKind(value: PropertyValue, kind: PropertyKind) {
  if (kind === "boolean" || kind === "number" || kind === "string") {
    return typeof value === kind
  }
  if (typeof value !== "object" || value === null) {
    return false
  }

  if (kind === "vector3" || kind === "color3" || kind === "udim2") {
    const expectedType = kind === "vector3"
      ? "Vector3"
      : kind === "color3"
        ? "Color3"
        : "UDim2"
    return value.type === expectedType
  }
  if (value.type !== "Enum") {
    return false
  }
  return kind === "enum_material"
    ? ALLOWED_MATERIALS.has(value.value)
    : ALLOWED_FONTS.has(value.value)
}

export function computeChangeSetFingerprint(
  changeSet: Omit<ChangeSet, "changeSetId" | "preview">,
) {
  return hashStable(changeSet)
}

function assertTemplateContract(template: LoadedGameTemplate) {
  const { manifest, scripts } = template
  if (manifest.generator.type !== "linear_obby_v1" || manifest.id !== "obby-starter") {
    throw new Error(`Unsupported game template generator: ${manifest.generator.type}`)
  }
  if (
    parentPath(manifest.generator.workspaceRoot) !== "game.Workspace"
    || parentPath(manifest.generator.serverScriptPath) !== "game.ServerScriptService"
    || parentPath(manifest.generator.progressGuiRoot) !== "game.StarterGui"
  ) {
    throw new Error("Obby template roots must use the bounded Studio services")
  }

  const serverScript = scripts.find(
    (script) => script.targetPath === manifest.generator.serverScriptPath,
  )
  const progressScript = scripts.find(
    (script) => script.targetPath === `${manifest.generator.progressGuiRoot}.ProgressClient`,
  )
  if (
    !serverScript
    || serverScript.className !== "Script"
    || !progressScript
    || progressScript.className !== "LocalScript"
    || scripts.length !== 2
  ) {
    throw new Error("Obby template must contain exactly its two reviewed scripts")
  }
}

function parseOptions(template: LoadedGameTemplate, input: unknown): ObbyGameOptions {
  const options = obbyGameOptionsSchema.parse(input)
  const definitions = template.manifest.options
  if (
    !definitions.stages.values.includes(options.stages)
    || !definitions.difficulty.values.includes(options.difficulty)
    || !definitions.visualStyle.values.includes(options.visualStyle)
  ) {
    throw new Error("Game options are not allowed by this template version")
  }
  return options
}

function markerAttributes(marker: OwnershipMarker) {
  return {
    [OWNERSHIP_ATTRIBUTES.generationId]: marker.generationId,
    [OWNERSHIP_ATTRIBUTES.templateId]: marker.templateId,
    [OWNERSHIP_ATTRIBUTES.templateVersion]: marker.templateVersion,
  }
}

function createObbyChangeSet(
  template: LoadedGameTemplate,
  request: GameBuildRequest,
  options: ObbyGameOptions,
): ChangeSet {
  const { manifest, scripts } = template
  const generator = manifest.generator
  const generationId = request.generationId ?? `gen-${hashStable({
    runId: request.context.runId,
    template: `${manifest.id}@${manifest.version}`,
    options,
  }).slice(0, 20)}`
  const marker: OwnershipMarker = {
    generationId,
    templateId: manifest.id,
    templateVersion: manifest.version,
  }
  const claims = [
    generator.workspaceRoot,
    generator.serverScriptPath,
    generator.progressGuiRoot,
  ].sort().map((path) => ({ path, access: "exclusive_create" as const }))
  const operations: ChangeOperation[] = []
  const verification: VerificationAssertion[] = []
  const ownedPaths: string[] = []
  let operationNumber = 0
  let assertionNumber = 0

  const nextOperationId = (kind: string) => {
    operationNumber += 1
    return `op-${operationNumber.toString().padStart(3, "0")}-${kind}`
  }
  const nextAssertionId = (kind: string) => {
    assertionNumber += 1
    return `verify-${assertionNumber.toString().padStart(3, "0")}-${kind}`
  }
  const claimFor = (path: string) => {
    const claim = claims.find((item) => isPathWithin(path, item.path))
    if (!claim) {
      throw new Error(`Template emitted an unclaimed path: ${path}`)
    }
    return claim.path
  }
  const addCreate = (
    targetPath: string,
    className: InstanceClassName,
    attributes: Record<string, string | number | boolean> = {},
  ) => {
    const operationId = nextOperationId("create")
    const operation: CreateOperation = {
      operationId,
      claimPath: claimFor(targetPath),
      type: "create_instance",
      targetPath,
      parentPath: parentPath(targetPath),
      name: instanceName(targetPath),
      className,
      ownership: marker,
      attributes: { ...markerAttributes(marker), ...attributes },
    }
    operations.push(operation)
    ownedPaths.push(targetPath)
    verification.push({
      assertionId: nextAssertionId("instance"),
      operationId,
      path: targetPath,
      type: "instance",
      className,
    })
    verification.push({
      assertionId: nextAssertionId("owner"),
      operationId,
      path: targetPath,
      type: "ownership",
      expected: marker,
    })
  }
  const addProperty = (targetPath: string, property: string, value: PropertyValue) => {
    const operationId = nextOperationId("property")
    operations.push({
      operationId,
      claimPath: claimFor(targetPath),
      type: "set_property",
      targetPath,
      property,
      value,
    })
    verification.push({
      assertionId: nextAssertionId("property"),
      operationId,
      path: targetPath,
      type: "property",
      property,
      expected: value,
    })
  }
  const addProperties = (
    targetPath: string,
    properties: Readonly<Record<string, PropertyValue>>,
  ) => {
    for (const [property, value] of Object.entries(properties)) {
      addProperty(targetPath, property, value)
    }
  }
  const addScript = (script: LoadedTrustedScript) => {
    const operationId = nextOperationId("script")
    operations.push({
      operationId,
      claimPath: claimFor(script.targetPath),
      type: "set_script_source",
      targetPath: script.targetPath,
      assetId: script.assetId,
      source: script.source,
      sourceHash: script.sha256,
      trust: "bundled_reviewed",
    })
    verification.push({
      assertionId: nextAssertionId("script"),
      operationId,
      path: script.targetPath,
      type: "script_hash",
      expectedHash: script.sha256,
    })
  }

  const stagesRoot = `${generator.workspaceRoot}.Stages`
  const checkpointsRoot = `${generator.workspaceRoot}.Checkpoints`
  const startPath = `${generator.workspaceRoot}.Start`
  const killFloorPath = `${generator.workspaceRoot}.KillFloor`
  const finishPath = `${generator.workspaceRoot}.Finish`
  const labelPath = `${generator.progressGuiRoot}.ProgressLabel`
  const progressScriptPath = `${generator.progressGuiRoot}.ProgressClient`
  const preset = generator.difficultyPresets[options.difficulty]
  const style = generator.styles[options.visualStyle]

  addCreate(generator.workspaceRoot, "Model")
  addCreate(stagesRoot, "Folder")
  addCreate(checkpointsRoot, "Folder")
  addCreate(startPath, "SpawnLocation")
  addProperties(startPath, {
    Anchored: true,
    CanCollide: true,
    Color: style.checkpointColor,
    Duration: 0,
    Enabled: true,
    Material: style.material,
    Neutral: true,
    Position: vector3(0, 4, 0),
    Size: vector3(14, 1, 14),
  })

  for (let stage = 1; stage <= options.stages; stage += 1) {
    const stageName = `Stage_${stage.toString().padStart(2, "0")}`
    const obstaclePath = `${stagesRoot}.${stageName}`
    const checkpointPath = `${checkpointsRoot}.Checkpoint_${stage.toString().padStart(2, "0")}`
    const checkpointY = 4 + stage * preset.heightStep
    const obstacleY = checkpointY - preset.heightStep / 2
    const color = style.stageColors[(stage - 1) % style.stageColors.length]
    if (!color) {
      throw new Error("Obby style has no stage color")
    }

    addCreate(obstaclePath, "Part", { B9StageNumber: stage })
    addProperties(obstaclePath, {
      Anchored: true,
      CanCollide: true,
      Color: color,
      Material: style.material,
      Orientation: vector3(0, stage % 2 === 0 ? 12 : -12, 0),
      Position: vector3((stage - 0.5) * preset.stageSpacing, obstacleY, 0),
      Size: vector3(preset.obstacleWidth, 1, preset.obstacleDepth),
    })

    addCreate(checkpointPath, "SpawnLocation", { B9StageNumber: stage })
    addProperties(checkpointPath, {
      Anchored: true,
      CanCollide: true,
      Color: style.checkpointColor,
      Duration: 0,
      Enabled: true,
      Material: style.material,
      Neutral: true,
      Position: vector3(stage * preset.stageSpacing, checkpointY, 0),
      Size: vector3(10, 1, 10),
    })
  }

  const courseLength = (options.stages + 1) * preset.stageSpacing
  addCreate(killFloorPath, "Part")
  addProperties(killFloorPath, {
    Anchored: true,
    CanCollide: true,
    Color: style.killFloorColor,
    Material: style.material,
    Position: vector3(courseLength / 2, -8, 0),
    Size: vector3(courseLength + 40, 1, 80),
    Transparency: 0.15,
  })

  addCreate(finishPath, "Part")
  addProperties(finishPath, {
    Anchored: true,
    CanCollide: true,
    Color: style.finishColor,
    Material: style.material,
    Position: vector3(courseLength, 4 + options.stages * preset.heightStep, 0),
    Size: vector3(14, 1, 14),
  })

  const serverScript = scripts.find((script) => script.targetPath === generator.serverScriptPath)
  if (!serverScript) {
    throw new Error("Reviewed obby server script is missing")
  }
  addCreate(serverScript.targetPath, serverScript.className)
  addScript(serverScript)

  addCreate(generator.progressGuiRoot, "ScreenGui")
  addProperties(generator.progressGuiRoot, {
    DisplayOrder: 10,
    IgnoreGuiInset: false,
    ResetOnSpawn: false,
  })
  addCreate(labelPath, "TextLabel")
  addProperties(labelPath, {
    BackgroundColor3: { type: "Color3", r: 0.05, g: 0.05, b: 0.08 },
    BackgroundTransparency: 0.15,
    Font: { type: "Enum", value: "Enum.Font.GothamBold" },
    Position: udim2(0.5, -110, 0, 20),
    Size: udim2(0, 220, 0, 52),
    Text: "Stage 0",
    TextColor3: { type: "Color3", r: 1, g: 1, b: 1 },
    TextScaled: true,
  })

  const progressScript = scripts.find((script) => script.targetPath === progressScriptPath)
  if (!progressScript) {
    throw new Error("Reviewed obby progress script is missing")
  }
  addCreate(progressScript.targetPath, progressScript.className)
  addScript(progressScript)

  const optionsHash = hashStable(options)
  const cleanupPaths = [...ownedPaths].sort(
    (left, right) => depth(right) - depth(left) || right.localeCompare(left),
  )
  const core = {
    schemaVersion: "b9.changeset/v1" as const,
    context: request.context,
    source: {
      type: "game_template" as const,
      templateId: manifest.id,
      templateVersion: manifest.version,
      optionsHash,
    },
    base: request.base,
    claims,
    operations,
    risk: {
      flags: [
        "adds_instances" as const,
        "changes_gameplay" as const,
        "installs_reviewed_scripts" as const,
      ],
      approval: "change_preview" as const,
    },
    verification,
    ownership: { marker, ownedPaths },
    cleanup: {
      strategy: "delete_owned_paths" as const,
      paths: cleanupPaths,
      requireOwnershipMatch: true as const,
      preserveUnknownDescendants: true as const,
    },
  }
  const fingerprint = computeChangeSetFingerprint(core)
  const changeSet: ChangeSet = {
    ...core,
    changeSetId: `chg-${fingerprint.slice(0, 24)}`,
    preview: {
      title: `${manifest.name} v${manifest.version}`,
      summary: manifest.preview.summary,
      additions: {
        instances: ownedPaths.length,
        properties: operations.filter((operation) => operation.type === "set_property").length,
        scripts: scripts.length,
      },
      optionLabels: [
        `${options.stages} stages`,
        `${options.difficulty} difficulty`,
        `${options.visualStyle} style`,
      ],
      claimedPaths: claims.map((claim) => claim.path),
      conflicts: [],
      fingerprint,
      completionLabel: "Ready to playtest",
      handoff: "playtest-and-fix",
    },
  }
  return changeSet
}

function pushDuplicateIssues(
  values: readonly string[],
  label: string,
  issues: string[],
) {
  const seen = new Set<string>()
  for (const value of values) {
    if (seen.has(value)) {
      issues.push(`Duplicate ${label}: ${value}`)
    }
    seen.add(value)
  }
}

function assertionKey(assertion: VerificationAssertion) {
  return `${assertion.type}:${assertion.operationId}`
}

export function getChangeSetValidationIssues(
  input: unknown,
  trustedScripts: readonly LoadedTrustedScript[] = [],
): string[] {
  const parsed = changeSetSchema.safeParse(input)
  if (!parsed.success) {
    return parsed.error.issues.map(
      (issue) => `${issue.path.join(".") || "changeSet"}: ${issue.message}`,
    )
  }
  const changeSet = parsed.data
  const issues: string[] = []
  const claimPaths = changeSet.claims.map((claim) => claim.path)
  const createOperations = changeSet.operations.filter(
    (operation): operation is CreateOperation => operation.type === "create_instance",
  )
  const createByPath = new Map(createOperations.map((operation) => [operation.targetPath, operation]))
  const operationById = new Map(changeSet.operations.map((operation) => [operation.operationId, operation]))
  const trustedByAsset = new Map(trustedScripts.map((script) => [script.assetId, script]))

  pushDuplicateIssues(claimPaths, "claim path", issues)
  pushDuplicateIssues(changeSet.operations.map((operation) => operation.operationId), "operation ID", issues)
  pushDuplicateIssues(changeSet.verification.map((assertion) => assertion.assertionId), "assertion ID", issues)
  pushDuplicateIssues(createOperations.map((operation) => operation.targetPath), "created path", issues)
  pushDuplicateIssues(changeSet.ownership.ownedPaths, "owned path", issues)
  pushDuplicateIssues(changeSet.risk.flags, "risk flag", issues)

  for (let leftIndex = 0; leftIndex < claimPaths.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < claimPaths.length; rightIndex += 1) {
      const left = claimPaths[leftIndex]
      const right = claimPaths[rightIndex]
      if (left && right && (isPathWithin(left, right) || isPathWithin(right, left))) {
        issues.push(`Overlapping claims: ${left} and ${right}`)
      }
    }
  }

  if (createOperations.length > MAX_CHANGE_SET_INSTANCES) {
    issues.push(`Instance count exceeds ${MAX_CHANGE_SET_INSTANCES}`)
  }

  const expectedAssertionKeys = new Map<string, VerificationAssertion>()
  let scriptBytes = 0
  for (const operation of changeSet.operations) {
    if (!claimPaths.includes(operation.claimPath)) {
      issues.push(`Operation uses an unknown claim: ${operation.operationId}`)
    } else if (!isPathWithin(operation.targetPath, operation.claimPath)) {
      issues.push(`Operation escapes its claim: ${operation.operationId}`)
    }

    if (operation.type === "create_instance") {
      if (
        operation.parentPath !== parentPath(operation.targetPath)
        || operation.name !== instanceName(operation.targetPath)
      ) {
        issues.push(`Create path does not match parent and name: ${operation.operationId}`)
      }
      if (
        !BASE_PARENT_PATHS.has(operation.parentPath)
        && !createByPath.has(operation.parentPath)
      ) {
        issues.push(`Create parent is outside the bounded manifest: ${operation.parentPath}`)
      }
      if (!valuesEqual(operation.ownership, changeSet.ownership.marker)) {
        issues.push(`Create ownership marker mismatch: ${operation.operationId}`)
      }
      const attributes = operation.attributes
      if (Object.keys(attributes).length > 8) {
        issues.push(`Too many attributes on ${operation.targetPath}`)
      }
      if (
        attributes[OWNERSHIP_ATTRIBUTES.generationId] !== operation.ownership.generationId
        || attributes[OWNERSHIP_ATTRIBUTES.templateId] !== operation.ownership.templateId
        || attributes[OWNERSHIP_ATTRIBUTES.templateVersion] !== operation.ownership.templateVersion
      ) {
        issues.push(`Required ownership attributes are missing: ${operation.targetPath}`)
      }
      for (const attribute of Object.keys(attributes)) {
        if (
          !Object.values(OWNERSHIP_ATTRIBUTES).includes(
            attribute as (typeof OWNERSHIP_ATTRIBUTES)[keyof typeof OWNERSHIP_ATTRIBUTES],
          )
          && !ALLOWED_CUSTOM_ATTRIBUTES.has(attribute)
        ) {
          issues.push(`Unsupported generated attribute ${attribute} on ${operation.targetPath}`)
        }
      }
      expectedAssertionKeys.set(`instance:${operation.operationId}`, {
        assertionId: "expected",
        operationId: operation.operationId,
        path: operation.targetPath,
        type: "instance",
        className: operation.className,
      })
      expectedAssertionKeys.set(`ownership:${operation.operationId}`, {
        assertionId: "expected",
        operationId: operation.operationId,
        path: operation.targetPath,
        type: "ownership",
        expected: changeSet.ownership.marker,
      })
      continue
    }

    const target = createByPath.get(operation.targetPath)
    if (!target) {
      issues.push(`Mutation target is not created by this change set: ${operation.targetPath}`)
      continue
    }
    if (operation.type === "set_property") {
      const propertyKind = ALLOWED_PROPERTIES[target.className][operation.property]
      if (!propertyKind || !matchesPropertyKind(operation.value, propertyKind)) {
        issues.push(
          `Unsupported property or value ${target.className}.${operation.property}`,
        )
      }
      expectedAssertionKeys.set(`property:${operation.operationId}`, {
        assertionId: "expected",
        operationId: operation.operationId,
        path: operation.targetPath,
        type: "property",
        property: operation.property,
        expected: operation.value,
      })
      continue
    }

    scriptBytes += new TextEncoder().encode(operation.source).byteLength
    if (target.className !== "Script" && target.className !== "LocalScript") {
      issues.push(`Script source target is not a script: ${operation.targetPath}`)
    }
    if (sha256(operation.source) !== operation.sourceHash) {
      issues.push(`Script source hash mismatch: ${operation.assetId}`)
    }
    const trusted = trustedByAsset.get(operation.assetId)
    if (
      !trusted
      || trusted.targetPath !== operation.targetPath
      || trusted.className !== target.className
      || trusted.sha256 !== operation.sourceHash
      || trusted.source !== operation.source
    ) {
      issues.push(`Script is not the exact reviewed bundled asset: ${operation.assetId}`)
    }
    expectedAssertionKeys.set(`script_hash:${operation.operationId}`, {
      assertionId: "expected",
      operationId: operation.operationId,
      path: operation.targetPath,
      type: "script_hash",
      expectedHash: operation.sourceHash,
    })
  }
  if (scriptBytes > MAX_TOTAL_SCRIPT_BYTES) {
    issues.push("Total script content exceeds the bounded size limit")
  }

  const actualAssertionKeys = new Set<string>()
  for (const assertion of changeSet.verification) {
    const key = assertionKey(assertion)
    if (actualAssertionKeys.has(key)) {
      issues.push(`Duplicate verification coverage: ${key}`)
    }
    actualAssertionKeys.add(key)
    const expected = expectedAssertionKeys.get(key)
    if (!expected || !valuesEqual(
      { ...assertion, assertionId: "expected" },
      expected,
    )) {
      issues.push(`Verification assertion does not exactly cover its operation: ${key}`)
    }
    if (!operationById.has(assertion.operationId)) {
      issues.push(`Verification references an unknown operation: ${assertion.operationId}`)
    }
  }
  for (const key of expectedAssertionKeys.keys()) {
    if (!actualAssertionKeys.has(key)) {
      issues.push(`Missing verification coverage: ${key}`)
    }
  }

  const createdPaths = createOperations.map((operation) => operation.targetPath)
  const expectedOwnedPaths = [...createdPaths].sort()
  const actualOwnedPaths = [...changeSet.ownership.ownedPaths].sort()
  if (!valuesEqual(actualOwnedPaths, expectedOwnedPaths)) {
    issues.push("Owned paths must exactly match created instance paths")
  }
  const expectedCleanup = [...createdPaths].sort(
    (left, right) => depth(right) - depth(left) || right.localeCompare(left),
  )
  if (!valuesEqual(changeSet.cleanup.paths, expectedCleanup)) {
    issues.push("Cleanup paths must include every owned instance in safe leaf-first order")
  }
  if (!valuesEqual(changeSet.preview.claimedPaths, claimPaths)) {
    issues.push("Preview claimed paths do not match the change-set claims")
  }
  const expectedCounts = {
    instances: createOperations.length,
    properties: changeSet.operations.filter((operation) => operation.type === "set_property").length,
    scripts: changeSet.operations.filter((operation) => operation.type === "set_script_source").length,
  }
  if (!valuesEqual(changeSet.preview.additions, expectedCounts)) {
    issues.push("Preview addition counts do not match the operations")
  }
  if (changeSet.preview.conflicts.length !== 0) {
    issues.push("Compiled change-set previews cannot contain unvalidated conflicts")
  }
  if (
    changeSet.source.templateId !== changeSet.ownership.marker.templateId
    || changeSet.source.templateVersion !== changeSet.ownership.marker.templateVersion
  ) {
    issues.push("Change-set source and ownership template do not match")
  }

  const { changeSetId: _changeSetId, preview: _preview, ...core } = changeSet
  const fingerprint = computeChangeSetFingerprint(core)
  if (
    changeSet.preview.fingerprint !== fingerprint
    || changeSet.changeSetId !== `chg-${fingerprint.slice(0, 24)}`
  ) {
    issues.push("Change-set fingerprint or ID does not match its content")
  }

  return issues
}

export function validateChangeSet(
  input: unknown,
  trustedScripts: readonly LoadedTrustedScript[] = [],
): ChangeSet {
  const issues = getChangeSetValidationIssues(input, trustedScripts)
  if (issues.length > 0) {
    throw new ChangeSetValidationError(issues)
  }
  return changeSetSchema.parse(input)
}

export function compileGameTemplate(
  template: LoadedGameTemplate,
  input: GameBuildRequest,
): ChangeSet {
  assertTemplateContract(template)
  const request = gameBuildRequestSchema.parse(input)
  if (
    request.templateId !== template.manifest.id
    || (request.templateVersion && request.templateVersion !== template.manifest.version)
  ) {
    throw new Error(
      `Requested template does not match ${template.manifest.id}@${template.manifest.version}`,
    )
  }
  const options = parseOptions(template, request.options)
  const changeSet = createObbyChangeSet(template, request, options)
  return validateChangeSet(changeSet, template.scripts)
}
