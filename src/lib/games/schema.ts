import { z } from "zod"

export const CHANGE_SET_SCHEMA_VERSION = "b9.changeset/v1" as const
export const GAME_TEMPLATE_SCHEMA_VERSION = "b9.game-template/v1" as const
export const STUDIO_SNAPSHOT_SCHEMA_VERSION = "b9.studio-snapshot/v1" as const

export const MAX_CHANGE_SET_OPERATIONS = 512
export const MAX_CHANGE_SET_ASSERTIONS = 1_024
export const MAX_CHANGE_SET_INSTANCES = 128
export const MAX_SCRIPT_BYTES = 50_000
export const MAX_TOTAL_SCRIPT_BYTES = 100_000

const stableIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const semverPattern = /^\d+\.\d+\.\d+$/
const studioPathPattern = /^game(?:\.[A-Za-z_][A-Za-z0-9_]*)+$/
const propertyNamePattern = /^[A-Za-z][A-Za-z0-9]{0,63}$/
const attributeNamePattern = /^[A-Za-z][A-Za-z0-9_]{0,63}$/
const scriptAssetPathPattern = /^scripts\/[a-z0-9]+(?:[._-][a-z0-9]+)*\.luau$/
const sha256Pattern = /^[a-f0-9]{64}$/

export const stableIdSchema = z.string().regex(stableIdPattern)
export const studioPathSchema = z.string().min(6).max(512).regex(studioPathPattern)
export const sha256Schema = z.string().regex(sha256Pattern)
export const propertyNameSchema = z.string().regex(propertyNamePattern)
export const attributeNameSchema = z.string().regex(attributeNamePattern)

export const vector3ValueSchema = z.object({
  type: z.literal("Vector3"),
  x: z.number().finite().min(-100_000).max(100_000),
  y: z.number().finite().min(-100_000).max(100_000),
  z: z.number().finite().min(-100_000).max(100_000),
}).strict()

export const color3ValueSchema = z.object({
  type: z.literal("Color3"),
  r: z.number().finite().min(0).max(1),
  g: z.number().finite().min(0).max(1),
  b: z.number().finite().min(0).max(1),
}).strict()

export const udim2ValueSchema = z.object({
  type: z.literal("UDim2"),
  xScale: z.number().finite().min(-10).max(10),
  xOffset: z.number().finite().min(-10_000).max(10_000),
  yScale: z.number().finite().min(-10).max(10),
  yOffset: z.number().finite().min(-10_000).max(10_000),
}).strict()

export const enumValueSchema = z.object({
  type: z.literal("Enum"),
  value: z.string().regex(/^Enum\.[A-Za-z][A-Za-z0-9]*\.[A-Za-z][A-Za-z0-9]*$/),
}).strict()

export const propertyValueSchema = z.union([
  z.string().max(4_000),
  z.number().finite().min(-1_000_000).max(1_000_000),
  z.boolean(),
  vector3ValueSchema,
  color3ValueSchema,
  udim2ValueSchema,
  enumValueSchema,
])

export type PropertyValue = z.infer<typeof propertyValueSchema>

export const ownershipMarkerSchema = z.object({
  generationId: stableIdSchema,
  templateId: stableIdSchema,
  templateVersion: z.string().regex(semverPattern),
}).strict()

export type OwnershipMarker = z.infer<typeof ownershipMarkerSchema>

const operationBaseSchema = z.object({
  operationId: stableIdSchema,
  claimPath: studioPathSchema,
})

export const createInstanceOperationSchema = operationBaseSchema.extend({
  type: z.literal("create_instance"),
  targetPath: studioPathSchema,
  parentPath: studioPathSchema,
  name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/),
  className: z.enum([
    "Folder",
    "Model",
    "Part",
    "SpawnLocation",
    "Script",
    "LocalScript",
    "ScreenGui",
    "TextLabel",
  ]),
  ownership: ownershipMarkerSchema,
  attributes: z.record(attributeNameSchema, z.union([
    z.string().max(256),
    z.number().finite(),
    z.boolean(),
  ])),
}).strict()

export const setPropertyOperationSchema = operationBaseSchema.extend({
  type: z.literal("set_property"),
  targetPath: studioPathSchema,
  property: propertyNameSchema,
  value: propertyValueSchema,
}).strict()

export const setScriptSourceOperationSchema = operationBaseSchema.extend({
  type: z.literal("set_script_source"),
  targetPath: studioPathSchema,
  assetId: stableIdSchema,
  source: z.string().min(1).max(MAX_SCRIPT_BYTES),
  sourceHash: sha256Schema,
  trust: z.literal("bundled_reviewed"),
}).strict()

export const changeOperationSchema = z.discriminatedUnion("type", [
  createInstanceOperationSchema,
  setPropertyOperationSchema,
  setScriptSourceOperationSchema,
])

export type ChangeOperation = z.infer<typeof changeOperationSchema>

const assertionBaseSchema = z.object({
  assertionId: stableIdSchema,
  operationId: stableIdSchema,
  path: studioPathSchema,
})

export const verificationAssertionSchema = z.discriminatedUnion("type", [
  assertionBaseSchema.extend({
    type: z.literal("instance"),
    className: createInstanceOperationSchema.shape.className,
  }).strict(),
  assertionBaseSchema.extend({
    type: z.literal("property"),
    property: propertyNameSchema,
    expected: propertyValueSchema,
  }).strict(),
  assertionBaseSchema.extend({
    type: z.literal("script_hash"),
    expectedHash: sha256Schema,
  }).strict(),
  assertionBaseSchema.extend({
    type: z.literal("ownership"),
    expected: ownershipMarkerSchema,
  }).strict(),
])

export type VerificationAssertion = z.infer<typeof verificationAssertionSchema>

export const changeSetSchema = z.object({
  schemaVersion: z.literal(CHANGE_SET_SCHEMA_VERSION),
  changeSetId: stableIdSchema,
  context: z.object({
    runId: stableIdSchema,
    agentId: stableIdSchema,
    planId: stableIdSchema,
    stepId: stableIdSchema,
  }).strict(),
  source: z.object({
    type: z.literal("game_template"),
    templateId: stableIdSchema,
    templateVersion: z.string().regex(semverPattern),
    optionsHash: sha256Schema,
  }).strict(),
  base: z.object({
    studioRevision: stableIdSchema,
    contentHashes: z.record(studioPathSchema, sha256Schema),
  }).strict(),
  claims: z.array(z.object({
    path: studioPathSchema,
    access: z.literal("exclusive_create"),
  }).strict()).min(1).max(16),
  operations: z.array(changeOperationSchema).min(1).max(MAX_CHANGE_SET_OPERATIONS),
  risk: z.object({
    flags: z.array(z.enum([
      "adds_instances",
      "changes_gameplay",
      "installs_reviewed_scripts",
    ])).min(1).max(3),
    approval: z.literal("change_preview"),
  }).strict(),
  verification: z.array(verificationAssertionSchema)
    .min(1)
    .max(MAX_CHANGE_SET_ASSERTIONS),
  ownership: z.object({
    marker: ownershipMarkerSchema,
    ownedPaths: z.array(studioPathSchema).min(1).max(MAX_CHANGE_SET_INSTANCES),
  }).strict(),
  cleanup: z.object({
    strategy: z.literal("delete_owned_paths"),
    paths: z.array(studioPathSchema).min(1).max(MAX_CHANGE_SET_INSTANCES),
    requireOwnershipMatch: z.literal(true),
    preserveUnknownDescendants: z.literal(true),
  }).strict(),
  preview: z.object({
    title: z.string().min(1).max(120),
    summary: z.string().min(1).max(500),
    additions: z.object({
      instances: z.number().int().min(1).max(MAX_CHANGE_SET_INSTANCES),
      properties: z.number().int().min(0).max(MAX_CHANGE_SET_OPERATIONS),
      scripts: z.number().int().min(0).max(16),
    }).strict(),
    optionLabels: z.array(z.string().min(1).max(120)).min(1).max(16),
    claimedPaths: z.array(studioPathSchema).min(1).max(16),
    conflicts: z.array(z.string().min(1).max(500)).max(32),
    fingerprint: sha256Schema,
    completionLabel: z.literal("Ready to playtest"),
    handoff: z.literal("playtest-and-fix"),
  }).strict(),
}).strict()

export type ChangeSet = z.infer<typeof changeSetSchema>

const enumNumberOptionSchema = z.object({
  type: z.literal("number_enum"),
  label: z.string().min(1).max(80),
  values: z.array(z.number().int()).min(1).max(10),
  default: z.number().int(),
}).strict()

const enumStringOptionSchema = z.object({
  type: z.literal("string_enum"),
  label: z.string().min(1).max(80),
  values: z.array(stableIdSchema).min(1).max(10),
  default: stableIdSchema,
}).strict()

const obbyPresetSchema = z.object({
  stageSpacing: z.number().finite().min(14).max(40),
  obstacleWidth: z.number().finite().min(3).max(20),
  obstacleDepth: z.number().finite().min(3).max(20),
  heightStep: z.number().finite().min(0).max(4),
}).strict()

const obbyStyleSchema = z.object({
  material: enumValueSchema,
  stageColors: z.array(color3ValueSchema).min(2).max(8),
  checkpointColor: color3ValueSchema,
  finishColor: color3ValueSchema,
  killFloorColor: color3ValueSchema,
}).strict()

export const gameTemplateManifestSchema = z.object({
  schemaVersion: z.literal(GAME_TEMPLATE_SCHEMA_VERSION),
  id: stableIdSchema,
  version: z.string().regex(semverPattern),
  name: z.string().min(1).max(100),
  description: z.string().min(1).max(500),
  compatibility: z.object({
    changeSetVersion: z.literal(CHANGE_SET_SCHEMA_VERSION),
    installerVersion: z.literal(1),
  }).strict(),
  requiredSkills: z.array(stableIdSchema).max(16),
  options: z.object({
    stages: enumNumberOptionSchema,
    difficulty: enumStringOptionSchema,
    visualStyle: enumStringOptionSchema,
  }).strict(),
  generator: z.object({
    type: z.literal("linear_obby_v1"),
    workspaceRoot: studioPathSchema,
    serverScriptPath: studioPathSchema,
    progressGuiRoot: studioPathSchema,
    difficultyPresets: z.object({
      easy: obbyPresetSchema,
      standard: obbyPresetSchema,
      challenging: obbyPresetSchema,
    }).strict(),
    styles: z.object({
      bright: obbyStyleSchema,
      neon: obbyStyleSchema,
      nature: obbyStyleSchema,
    }).strict(),
  }).strict(),
  scripts: z.array(z.object({
    assetId: stableIdSchema,
    path: z.string().regex(scriptAssetPathPattern),
    targetPath: studioPathSchema,
    className: z.enum(["Script", "LocalScript"]),
    sha256: sha256Schema,
  }).strict()).min(1).max(8),
  preview: z.object({
    summary: z.string().min(1).max(500),
    includes: z.array(z.string().min(1).max(120)).min(1).max(16),
  }).strict(),
}).strict()

export type GameTemplateManifest = z.infer<typeof gameTemplateManifestSchema>

export const obbyGameOptionsSchema = z.object({
  stages: z.union([z.literal(5), z.literal(10), z.literal(15)]),
  difficulty: z.enum(["easy", "standard", "challenging"]),
  visualStyle: z.enum(["bright", "neon", "nature"]),
}).strict()

export type ObbyGameOptions = z.infer<typeof obbyGameOptionsSchema>

export const gameBuildRequestSchema = z.object({
  templateId: stableIdSchema,
  templateVersion: z.string().regex(semverPattern).optional(),
  options: z.unknown(),
  context: changeSetSchema.shape.context,
  base: changeSetSchema.shape.base,
  generationId: stableIdSchema.optional(),
}).strict()

export type GameBuildRequest = z.infer<typeof gameBuildRequestSchema>

/** A user-approved starter selection. The live Studio base is deliberately
 * absent: GameBuilderService always acquires it directly from Studio. */
export const gameBuildDraftSchema = gameBuildRequestSchema.omit({ base: true })

export type GameBuildDraft = z.infer<typeof gameBuildDraftSchema>

export const studioSnapshotSchema = z.object({
  schemaVersion: z.literal(STUDIO_SNAPSHOT_SCHEMA_VERSION),
  revision: stableIdSchema,
  completePaths: z.array(studioPathSchema).max(32),
  contentHashes: z.record(studioPathSchema, sha256Schema),
  instances: z.array(z.object({
    path: studioPathSchema,
    className: z.string().min(1).max(100),
    ownership: ownershipMarkerSchema.optional(),
    properties: z.record(propertyNameSchema, propertyValueSchema).optional(),
    scriptHash: sha256Schema.optional(),
  }).strict()).max(2_000),
}).strict()

export type StudioSnapshot = z.infer<typeof studioSnapshotSchema>

export const previewConflictSchema = z.object({
  code: z.enum([
    "stale_revision",
    "stale_content",
    "incomplete_snapshot",
    "name_collision",
    "ownership_conflict",
    "invalid_existing_instance",
    "partial_generation",
  ]),
  path: studioPathSchema.optional(),
  message: z.string().min(1).max(500),
}).strict()

export type PreviewConflict = z.infer<typeof previewConflictSchema>

export const gameBuildPreflightSchema = z.object({
  status: z.enum(["ready", "already_installed", "resume_available", "blocked"]),
  canInstall: z.boolean(),
  retryIsNoOp: z.boolean(),
  conflicts: z.array(previewConflictSchema).max(64),
  remainingOperationIds: z.array(stableIdSchema).max(MAX_CHANGE_SET_OPERATIONS),
  preview: changeSetSchema.shape.preview,
}).strict()

export type GameBuildPreflight = z.infer<typeof gameBuildPreflightSchema>

export const gameInstallReceiptSchema = z.object({
  status: z.literal("installed"),
  generationId: stableIdSchema,
  appliedOperationIds: z.array(stableIdSchema).max(MAX_CHANGE_SET_OPERATIONS),
  verifiedAssertionIds: z.array(stableIdSchema).max(MAX_CHANGE_SET_ASSERTIONS),
  verified: z.literal(true),
  completionLabel: z.literal("Ready to playtest"),
  handoff: z.literal("playtest-and-fix"),
}).strict()

export type GameInstallReceipt = z.infer<typeof gameInstallReceiptSchema>

export const gameVerificationReceiptSchema = z.object({
  verified: z.literal(true),
  verifiedAssertionIds: z.array(stableIdSchema).max(MAX_CHANGE_SET_ASSERTIONS),
}).strict()

export type GameVerificationReceipt = z.infer<typeof gameVerificationReceiptSchema>

export const gameRemovalReceiptSchema = z.object({
  status: z.enum(["removed", "partial"]),
  generationId: stableIdSchema,
  removed: z.array(studioPathSchema).max(MAX_CHANGE_SET_INSTANCES),
  preserved: z.array(studioPathSchema).max(MAX_CHANGE_SET_INSTANCES),
  skipped: z.array(studioPathSchema).max(MAX_CHANGE_SET_INSTANCES),
  failures: z.array(z.object({
    path: studioPathSchema,
    error: z.string().min(1).max(2_000),
  }).strict()).max(MAX_CHANGE_SET_INSTANCES),
  verified: z.boolean(),
}).strict()

export type GameRemovalReceipt = z.infer<typeof gameRemovalReceiptSchema>

export const removalPlanSchema = z.object({
  generationId: stableIdSchema,
  paths: z.array(studioPathSchema).max(MAX_CHANGE_SET_INSTANCES),
  skippedMissingPaths: z.array(studioPathSchema).max(MAX_CHANGE_SET_INSTANCES),
  preservedParentPaths: z.array(studioPathSchema).max(MAX_CHANGE_SET_INSTANCES),
  requireOwnershipMatch: z.literal(true),
  preserveUnknownDescendants: z.literal(true),
}).strict()

export type RemovalPlan = z.infer<typeof removalPlanSchema>
