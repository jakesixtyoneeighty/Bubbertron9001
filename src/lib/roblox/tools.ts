/**
 * Roblox Studio Tools for Vercel AI SDK
 *
 * These tools allow the AI to interact with Roblox Studio via the bridge server.
 */

import { tool, type ToolExecutionOptions } from "ai"
import { z } from "zod"
import { studioRequest, isStudioConnected, notConnectedError } from "./client"
import {
  searchToolbox,
  getAssetDetails,
  type AssetCategory,
  type ToolboxAsset,
} from "./toolbox"
import { useAgentStore } from "@/stores/agent"
import { useSettingsStore } from "@/stores/settings"
import {
  askQuestions,
  type AskUserQuestion,
} from "./questions"

export {
  cancelPendingQuestions,
  setAskUserHandler,
} from "./questions"

// ============================================================================
// Types
// ============================================================================

interface ScriptContent {
  path: string
  source: string
  className: string
}

interface InstanceInfo {
  path: string
  name: string
  className: string
  children?: InstanceInfo[]
}

interface PropertyInfo {
  name: string
  value: string
  type: string
}

interface ImportedScriptInfo {
  name: string
  className: string
  relativePath: string
  quarantined: boolean
  wasEnabled?: boolean
}

interface InsertedAssetInfo {
  path: string
  name: string
  scripts?: unknown
  scriptsQuarantined?: unknown
}

const studioPathSchema = z.string().min(1).max(512)
const shortTextSchema = z.string().min(1).max(200)
const propertyValueSchema = z.string().max(4_000)
const scriptTextSchema = z.string().max(500_000)

// ============================================================================
// Script Tools
// ============================================================================

export const robloxGetScript = tool({
  description: `Read the source code of a script in Roblox Studio.

Use this to read scripts like ServerScriptService.MainScript or Workspace.Part.LocalScript.
The path should be the full instance path from game root.

Examples:
- game.ServerScriptService.MainScript
- game.ReplicatedStorage.Modules.Utils
- game.Workspace.SpawnLocation.TouchScript`,
  inputSchema: z.object({
    path: studioPathSchema.describe("Full instance path to the script (e.g. game.ServerScriptService.MainScript)"),
  }),
  execute: async (
    { path }: { path: string },
    options?: ToolExecutionOptions
  ) => {
    if (!(await isStudioConnected())) {
      return { error: notConnectedError() }
    }

    const result = await studioRequest<ScriptContent>(
      "/script/get",
      { path },
      options?.abortSignal
    )
    if (!result.success) {
      return { error: result.error }
    }

    const lines = result.data.source.split("\n")
    const numbered = lines.map((line, i) => `${(i + 1).toString().padStart(5, "0")}| ${line}`).join("\n")

    return {
      path: result.data.path,
      className: result.data.className,
      source: numbered,
    }
  },
})

export const robloxSetScript = tool({
  description: `Replace the entire source code of a script in Roblox Studio.

Use this to completely replace a script's contents.
For partial edits, consider using roblox_edit_script instead.

The path should be the full instance path from game root.`,
  inputSchema: z.object({
    path: studioPathSchema.describe("Full instance path to the script"),
    source: scriptTextSchema.describe("The new source code for the script"),
  }),
  execute: async (
    { path, source }: { path: string; source: string },
    options?: ToolExecutionOptions
  ) => {
    if (!(await isStudioConnected())) {
      return { error: notConnectedError() }
    }

    const result = await studioRequest<{ path: string }>(
      "/script/set",
      { path, source },
      options?.abortSignal
    )
    if (!result.success) {
      return { error: result.error }
    }

    const lines = source.split("\n").length
    return { success: true, path: result.data.path, lines }
  },
})

export const robloxEditScript = tool({
  description: `Edit a portion of a script by replacing specific code.

This performs a find-and-replace operation on the script source.
The oldCode must match exactly (including whitespace).
Use roblox_get_script first to see the current source.

Example:
  oldCode: "local speed = 10"
  newCode: "local speed = 20"`,
  inputSchema: z.object({
    path: studioPathSchema.describe("Full instance path to the script"),
    oldCode: scriptTextSchema.min(1).describe("The exact code to find and replace"),
    newCode: scriptTextSchema.describe("The new code to replace it with"),
  }),
  execute: async (
    {
      path,
      oldCode,
      newCode,
    }: { path: string; oldCode: string; newCode: string },
    options?: ToolExecutionOptions
  ) => {
    if (!(await isStudioConnected())) {
      return { error: notConnectedError() }
    }

    const result = await studioRequest<{ path: string; replaced: number }>("/script/edit", {
      path,
      oldCode,
      newCode,
    }, options?.abortSignal)

    if (!result.success) {
      return { error: result.error }
    }

    return { success: true, path: result.data.path, replacements: result.data.replaced }
  },
})

// ============================================================================
// Instance Tools
// ============================================================================

export const robloxGetChildren = tool({
  description: `List the children of an instance in Roblox Studio.

Use this to explore the game hierarchy.
Set recursive=true to get all descendants (can be slow for large trees).

Examples:
- game.Workspace
- game.ServerScriptService
- game.Players.Player1.Backpack`,
  inputSchema: z.object({
    path: studioPathSchema.describe("Full instance path (e.g. game.Workspace)"),
    recursive: z.boolean().optional().describe("If true, get all descendants recursively"),
  }),
  execute: async (
    { path, recursive = false }: { path: string; recursive?: boolean },
    options?: ToolExecutionOptions
  ) => {
    if (!(await isStudioConnected())) {
      return { error: notConnectedError() }
    }

    const result = await studioRequest<InstanceInfo[]>(
      "/instance/children",
      { path, recursive },
      options?.abortSignal
    )
    if (!result.success) {
      return { error: result.error }
    }

    const format = (items: InstanceInfo[], indent = 0): string => {
      return items
        .map((item) => {
          const prefix = "  ".repeat(indent)
          const line = `${prefix}- ${item.name} (${item.className})`
          if (item.children && item.children.length > 0) {
            return `${line}\n${format(item.children, indent + 1)}`
          }
          return line
        })
        .join("\n")
    }

    return { path, children: format(result.data) }
  },
})

export const robloxGetProperties = tool({
  description: `Get all properties of an instance in Roblox Studio.

Returns a list of property names, values, and types.
Useful for understanding what can be modified on an instance.`,
  inputSchema: z.object({
    path: studioPathSchema.describe("Full instance path"),
  }),
  execute: async (
    { path }: { path: string },
    options?: ToolExecutionOptions
  ) => {
    if (!(await isStudioConnected())) {
      return { error: notConnectedError() }
    }

    const result = await studioRequest<PropertyInfo[]>(
      "/instance/properties",
      { path },
      options?.abortSignal
    )
    if (!result.success) {
      return { error: result.error }
    }

    return { path, properties: result.data }
  },
})

export const robloxSetProperty = tool({
  description: `Set a property value on an instance in Roblox Studio.

The value is parsed based on the property type:
- Numbers: "10", "3.14"
- Booleans: "true", "false"
- Strings: "Hello World"
- Vector3: "1, 2, 3"
- Color3: "255, 128, 0" (RGB 0-255) or "#FF8800"
- BrickColor: "Bright red"
- Enum: "Enum.Material.Plastic"`,
  inputSchema: z.object({
    path: studioPathSchema.describe("Full instance path"),
    property: shortTextSchema.describe("Property name to set"),
    value: propertyValueSchema.describe("New value for the property"),
  }),
  execute: async (
    {
      path,
      property,
      value,
    }: { path: string; property: string; value: string },
    options?: ToolExecutionOptions
  ) => {
    if (!(await isStudioConnected())) {
      return { error: notConnectedError() }
    }

    const result = await studioRequest<{ path: string }>(
      "/instance/set",
      { path, property, value },
      options?.abortSignal
    )
    if (!result.success) {
      return { error: result.error }
    }

    return { success: true, path: result.data.path, property, value }
  },
})

export const robloxCreate = tool({
  description: `Create a new instance in Roblox Studio.

Common class names:
- Scripts: Script, LocalScript, ModuleScript
- Parts: Part, MeshPart, UnionOperation
- UI: ScreenGui, Frame, TextLabel, TextButton
- Values: StringValue, IntValue, BoolValue, ObjectValue
- Other: Folder, Model, RemoteEvent, RemoteFunction`,
  inputSchema: z.object({
    className: shortTextSchema.describe("The class name of the instance to create"),
    parent: studioPathSchema.describe("Full path to the parent instance"),
    name: shortTextSchema.optional().describe("Name for the new instance"),
  }),
  execute: async (
    {
      className,
      parent,
      name,
    }: { className: string; parent: string; name?: string },
    options?: ToolExecutionOptions
  ) => {
    if (!(await isStudioConnected())) {
      return { error: notConnectedError() }
    }

    const result = await studioRequest<{ path: string }>(
      "/instance/create",
      { className, parent, name },
      options?.abortSignal
    )
    if (!result.success) {
      return { error: result.error }
    }

    return { success: true, path: result.data.path }
  },
})

export const robloxDelete = tool({
  description: `Delete an instance from Roblox Studio.

This permanently removes the instance and all its descendants.
Use with caution - this cannot be undone through the tool.`,
  inputSchema: z.object({
    path: studioPathSchema.describe("Full instance path to delete"),
  }),
  execute: async (
    { path }: { path: string },
    options?: ToolExecutionOptions
  ) => {
    if (!(await isStudioConnected())) {
      return { error: notConnectedError() }
    }

    const result = await studioRequest<{ deleted: string }>(
      "/instance/delete",
      { path },
      options?.abortSignal
    )
    if (!result.success) {
      return { error: result.error }
    }

    return { success: true, deleted: result.data.deleted }
  },
})

export const robloxClone = tool({
  description: `Clone an instance in Roblox Studio.

Creates a deep copy of the instance and all its descendants.
If parent is not specified, the clone is placed in the same parent as the original.`,
  inputSchema: z.object({
    path: studioPathSchema.describe("Full instance path to clone"),
    parent: studioPathSchema.optional().describe("Optional new parent path for the clone"),
  }),
  execute: async (
    { path, parent }: { path: string; parent?: string },
    options?: ToolExecutionOptions
  ) => {
    if (!(await isStudioConnected())) {
      return { error: notConnectedError() }
    }

    const result = await studioRequest<{ path: string }>(
      "/instance/clone",
      { path, parent },
      options?.abortSignal
    )
    if (!result.success) {
      return { error: result.error }
    }

    return { success: true, path: result.data.path }
  },
})

export const robloxSearch = tool({
  description: `Search for instances in Roblox Studio by name or class.

At least one of name or className must be provided.
Name matching is case-insensitive and supports partial matches.`,
  inputSchema: z.object({
    root: studioPathSchema.optional().describe("Root path to search from (default: game)"),
    name: shortTextSchema.optional().describe("Name pattern to match"),
    className: shortTextSchema.optional().describe("Class name to filter by"),
    limit: z.number().int().min(1).max(200).optional().describe("Maximum results (default: 50)"),
  }),
  execute: async ({
    root = "game",
    name,
    className,
    limit = 50,
  }: {
    root?: string
    name?: string
    className?: string
    limit?: number
  }, options?: ToolExecutionOptions) => {
    if (!name && !className) {
      return { error: "At least one of name or className must be provided" }
    }

    if (!(await isStudioConnected())) {
      return { error: notConnectedError() }
    }

    const result = await studioRequest<InstanceInfo[]>(
      "/instance/search",
      { root, name, className, limit },
      options?.abortSignal
    )
    if (!result.success) {
      return { error: result.error }
    }

    if (result.data.length === 0) {
      return { message: "No instances found matching criteria", results: [] }
    }

    return {
      count: result.data.length,
      results: result.data.map((item) => ({ path: item.path, className: item.className })),
    }
  },
})

export const robloxGetSelection = tool({
  description: `Get the currently selected objects in Roblox Studio.

Returns the paths and class names of all selected instances.
Useful for operating on what the user has selected in the Explorer.`,
  inputSchema: z.object({}),
  execute: async (_input, options?: ToolExecutionOptions) => {
    if (!(await isStudioConnected())) {
      return { error: notConnectedError() }
    }

    const result = await studioRequest<InstanceInfo[]>(
      "/selection/get",
      undefined,
      options?.abortSignal
    )
    if (!result.success) {
      return { error: result.error }
    }

    if (result.data.length === 0) {
      return { message: "No objects selected in Studio", selection: [] }
    }

    return {
      count: result.data.length,
      selection: result.data.map((item) => ({ path: item.path, className: item.className })),
    }
  },
})

export const robloxRunCode = tool({
  description: `Execute Luau code in Roblox Studio.

The code runs in the command bar context with full access to game services.
Use print() to output results - they will be captured and returned.
Every invocation requires fresh user approval. Once Luau begins running, it
cannot be forcibly cancelled, so prefer the structured Studio tools.

Examples:
- print(game.Workspace:GetChildren())
- game.Players.LocalPlayer.Character:MoveTo(Vector3.new(0, 10, 0))
- for _, part in game.Workspace:GetDescendants() do if part:IsA("BasePart") then part.Anchored = true end end`,
  inputSchema: z.object({
    code: scriptTextSchema.min(1).describe("Luau code to execute"),
  }),
  execute: async (
    { code }: { code: string },
    options?: ToolExecutionOptions
  ) => {
    if (!(await isStudioConnected())) {
      return { error: notConnectedError() }
    }

    const result = await studioRequest<{ output: string; error?: string }>(
      "/code/run",
      { code },
      options?.abortSignal
    )
    if (!result.success) {
      return { error: result.error }
    }

    if (result.data.error) {
      return { error: result.data.error }
    }

    return { output: result.data.output || "Code executed successfully (no output)" }
  },
})

export const robloxMove = tool({
  description: `Move an instance to a new parent (reparent).

Changes the Parent property of the instance to the new location.
The instance keeps all its properties and children.

Examples:
- Move a part to a folder: path="game.Workspace.Part1", newParent="game.Workspace.MyFolder"
- Move a script to ServerScriptService: path="game.Workspace.Script", newParent="game.ServerScriptService"`,
  inputSchema: z.object({
    path: studioPathSchema.describe("Full instance path to move"),
    newParent: studioPathSchema.describe("Full path to the new parent"),
  }),
  execute: async (
    { path, newParent }: { path: string; newParent: string },
    options?: ToolExecutionOptions
  ) => {
    if (!(await isStudioConnected())) {
      return { error: notConnectedError() }
    }

    const result = await studioRequest<{ path: string }>(
      "/instance/move",
      { path, newParent },
      options?.abortSignal
    )
    if (!result.success) {
      return { error: result.error }
    }

    return { success: true, path: result.data.path }
  },
})

// ============================================================================
// Bulk Operations
// ============================================================================

export const robloxBulkCreate = tool({
  description: `Create multiple instances at once.

More efficient than calling roblox_create multiple times.
Each item specifies className, parent, and optional name.

Example: Create 5 parts in workspace
[
  { className: "Part", parent: "game.Workspace", name: "Part1" },
  { className: "Part", parent: "game.Workspace", name: "Part2" },
  ...
]`,
  inputSchema: z.object({
    instances: z
      .array(
        z.object({
          className: shortTextSchema.describe("Class name of the instance"),
          parent: studioPathSchema.describe("Parent path"),
          name: shortTextSchema.optional().describe("Optional name"),
        })
      )
      .min(1)
      .max(200)
      .describe("Array of instances to create"),
  }),
  execute: async ({
    instances,
  }: {
    instances: Array<{ className: string; parent: string; name?: string }>
  }, options?: ToolExecutionOptions) => {
    if (!(await isStudioConnected())) {
      return { error: notConnectedError() }
    }

    const result = await studioRequest<{
      created: string[]
      errors?: string[]
    }>(
      "/instance/bulk-create",
      { instances },
      options?.abortSignal
    )
    if (!result.success) {
      return { error: result.error }
    }

    if (result.data.errors?.length) {
      return {
        error: `Bulk create partially failed: ${result.data.errors.join("; ")}`,
        retryable: true,
        partial: true,
        count: result.data.created.length,
        paths: result.data.created,
        errors: result.data.errors,
      }
    }

    return {
      success: true,
      count: result.data.created.length,
      paths: result.data.created,
    }
  },
})

export const robloxBulkDelete = tool({
  description: `Delete multiple instances at once.

More efficient than calling roblox_delete multiple times.
All specified instances and their descendants will be destroyed.

WARNING: This cannot be undone through the tool.`,
  inputSchema: z.object({
    paths: z
      .array(studioPathSchema)
      .min(1)
      .max(200)
      .describe("Array of instance paths to delete"),
  }),
  execute: async (
    { paths }: { paths: string[] },
    options?: ToolExecutionOptions
  ) => {
    if (!(await isStudioConnected())) {
      return { error: notConnectedError() }
    }

    const result = await studioRequest<{
      deleted: string[]
      errors?: string[]
    }>(
      "/instance/bulk-delete",
      { paths },
      options?.abortSignal
    )
    if (!result.success) {
      return { error: result.error }
    }

    if (result.data.errors?.length) {
      return {
        error: `Bulk delete partially failed: ${result.data.errors.join("; ")}`,
        retryable: true,
        partial: true,
        count: result.data.deleted.length,
        deleted: result.data.deleted,
        errors: result.data.errors,
      }
    }

    return {
      success: true,
      count: result.data.deleted.length,
      deleted: result.data.deleted,
    }
  },
})

export const robloxBulkSetProperty = tool({
  description: `Set properties on multiple instances at once.

More efficient than calling roblox_set_property multiple times.
Each operation specifies path, property name, and value.

Example: Make all parts red and anchored
[
  { path: "game.Workspace.Part1", property: "BrickColor", value: "Bright red" },
  { path: "game.Workspace.Part1", property: "Anchored", value: "true" },
  { path: "game.Workspace.Part2", property: "BrickColor", value: "Bright red" },
  ...
]`,
  inputSchema: z.object({
    operations: z
      .array(
        z.object({
          path: studioPathSchema.describe("Instance path"),
          property: shortTextSchema.describe("Property name"),
          value: propertyValueSchema.describe("New value"),
        })
      )
      .min(1)
      .max(200)
      .describe("Array of property set operations"),
  }),
  execute: async ({
    operations,
  }: {
    operations: Array<{ path: string; property: string; value: string }>
  }, options?: ToolExecutionOptions) => {
    if (!(await isStudioConnected())) {
      return { error: notConnectedError() }
    }

    const result = await studioRequest<{ updated: number; errors?: string[] }>(
      "/instance/bulk-set",
      { operations },
      options?.abortSignal
    )
    if (!result.success) {
      return { error: result.error }
    }

    if (result.data.errors?.length) {
      return {
        error: `Bulk property update partially failed: ${result.data.errors.join("; ")}`,
        retryable: true,
        partial: true,
        count: result.data.updated,
        errors: result.data.errors,
      }
    }

    return { success: true, count: result.data.updated }
  },
})

// ============================================================================
// Toolbox Tools
// ============================================================================

function assetSafetyDisclosure(asset: ToolboxAsset) {
  const disclosures: string[] = []
  if (asset.hasScripts) {
    disclosures.push(
      `${asset.scriptCount} script${asset.scriptCount === 1 ? "" : "s"} reported`
    )
  } else {
    disclosures.push("no scripts reported")
  }
  if (asset.shouldSandbox) {
    disclosures.push("Creator Store recommends sandboxing")
  }
  return disclosures.join("; ")
}

function normalizeScriptInventory(value: unknown): ImportedScriptInfo[] {
  if (!Array.isArray(value)) return []

  return value.flatMap((entry): ImportedScriptInfo[] => {
    if (!entry || typeof entry !== "object") return []
    const candidate = entry as Record<string, unknown>
    if (
      typeof candidate.name !== "string" ||
      typeof candidate.className !== "string" ||
      typeof candidate.relativePath !== "string" ||
      typeof candidate.quarantined !== "boolean"
    ) {
      return []
    }

    return [{
      name: candidate.name,
      className: candidate.className,
      relativePath: candidate.relativePath,
      quarantined: candidate.quarantined,
      ...(typeof candidate.wasEnabled === "boolean"
        ? { wasEnabled: candidate.wasEnabled }
        : {}),
    }]
  })
}

export const robloxToolboxSearch = tool({
  description: `Search the Roblox Creator Store for free models, decals, audio, or plugins.

Use this to find pre-made assets that can be inserted into the game.
Results are validated as free, purchasable assets of the requested type. Each
result includes Creator Store script and sandbox metadata. Disclose those safety
fields before asking the user to choose an asset.

IMPORTANT: When presenting search results to the user via roblox_ask_user:
- Use RICH OPTIONS with imageUrl for thumbnails (shows a visual grid)
- Format: { label: "Model Name", value: "assetId", imageUrl: "thumbnailUrl", description: "by Creator" }
- After user picks, use the value (asset ID) with roblox_insert_asset

Examples:
- Search for "car" models
- Search for "sword" audio
- Search for "explosion" decals`,
  inputSchema: z.object({
    query: z.string().min(1).max(200).describe("Search query"),
    category: z.enum(["Model", "Decal", "Audio", "Plugin", "MeshPart"]).default("Model").describe("Asset category"),
    limit: z.number().int().min(1).max(50).default(10).describe("Max results (1-50)"),
  }),
  execute: async ({ query, category = "Model", limit = 10 }: { query: string; category?: AssetCategory; limit?: number }) => {
    const result = await searchToolbox(query, category, Math.min(limit, 50));

    if (result.assets.length === 0) {
      return { message: `No ${category.toLowerCase()}s found for "${query}"`, results: [] };
    }

    return {
      count: result.assets.length,
      note: "Every result is free and purchasable. Show script/sandbox disclosures in the choice UI; inserted BaseScripts are disabled and inventoried by the Studio quarantine.",
      results: result.assets.map((asset) => {
        const safetyDisclosure = assetSafetyDisclosure(asset)
        return {
          id: asset.id,
          name: asset.name,
          category: asset.category,
          assetTypeId: asset.assetTypeId,
          thumbnailUrl: asset.thumbnailUrl,
          description: asset.description.slice(0, 100),
          creator: asset.creatorName,
          votes: asset.voteCount,
          upVotePercent: asset.upVotePercent,
          free: asset.isFree,
          purchasable: asset.purchasable,
          hasScripts: asset.hasScripts,
          scriptCount: asset.scriptCount,
          shouldSandbox: asset.shouldSandbox,
          safetyDisclosure,
          // Pre-formatted for ask_user rich options
          askUserOption: {
            label: asset.name,
            value: String(asset.id),
            imageUrl: asset.thumbnailUrl,
            description: `by ${asset.creatorName} · ${safetyDisclosure}`,
          },
        }
      }),
    };
  },
});

export const robloxInsertAsset = tool({
  description: `Insert a free model from the Roblox Creator Store into the game.

Use a model ID from roblox_toolbox_search. The asset is revalidated as a free,
purchasable Creator Store model before insertion. Studio inventories every
LuaSourceContainer and disables imported BaseScripts before parenting the model.
Always disclose and review the returned script inventory; ModuleScripts are not
active by themselves but must still be treated as untrusted code.`,
  inputSchema: z.object({
    assetId: z.number().int().positive().describe("Asset ID from toolbox search"),
    parent: studioPathSchema.default("game.Workspace").describe("Parent path for the inserted model"),
  }),
  execute: async (
    {
      assetId,
      parent = "game.Workspace",
    }: { assetId: number; parent?: string },
    options?: ToolExecutionOptions
  ) => {
    if (!(await isStudioConnected())) {
      return { error: notConnectedError() };
    }

    // Get asset details first
    const details = await getAssetDetails(assetId, "Model");
    if (!details) {
      return {
        error: `Asset ${assetId} is not a free, purchasable Creator Store model`,
      };
    }

    // Request Studio to insert the asset
    const result = await studioRequest<InsertedAssetInfo>(
      "/asset/insert",
      {
        assetId,
        parent,
      },
      options?.abortSignal
    );

    if (!result.success) {
      return { error: result.error };
    }

    const scripts = normalizeScriptInventory(result.data.scripts)
    const scriptsQuarantined =
      typeof result.data.scriptsQuarantined === "number" &&
      Number.isInteger(result.data.scriptsQuarantined) &&
      result.data.scriptsQuarantined >= 0
        ? result.data.scriptsQuarantined
        : 0
    const hasScripts = details.hasScripts || scripts.length > 0
    const metadataMismatch =
      details.scriptCount !== scripts.length ||
      details.hasScripts !== (scripts.length > 0)
    const requiresScriptReview = hasScripts || details.shouldSandbox
    const safetyNotice = requiresScriptReview
      ? `${scriptsQuarantined} imported BaseScript${scriptsQuarantined === 1 ? "" : "s"} disabled. Review all ${scripts.length} detected script container${scripts.length === 1 ? "" : "s"} before enabling or requiring imported code.${details.shouldSandbox ? " Creator Store recommends sandboxing this asset." : ""}`
      : "No scripts were reported by Creator Store or detected by Studio."

    return {
      success: true,
      path: result.data.path,
      name: result.data.name,
      assetName: details.name,
      creator: details.creatorName,
      hasScripts,
      declaredScriptCount: details.scriptCount,
      shouldSandbox: details.shouldSandbox,
      scripts,
      scriptsQuarantined,
      metadataMismatch,
      requiresScriptReview,
      safetyNotice,
    };
  },
});

// ============================================================================
// Agentic Tools
// ============================================================================

let approvedRunId: string | null = null;
let pendingApproval:
  | { runKey: string; promise: Promise<boolean> }
  | null = null;

async function confirmStudioChanges(
  action: string,
  signal?: AbortSignal,
  reuseApprovalForRun = true
) {
  if (
    reuseApprovalForRun &&
    !useSettingsStore.getState().appSettings.confirmDestructiveActions
  ) {
    return true
  }

  const askForApproval = async () => {
    const oneTimeLuauApproval = !reuseApprovalForRun
    const answers = await askQuestions(
      [
        {
          question: oneTimeLuauApproval
            ? "Run this Luau code in Roblox Studio now? It can change anything in the project, and active Luau cannot be forcibly cancelled once execution begins."
            : `Allow Bubberton9001 to change this Roblox Studio project for this run? First action: ${action}.`,
          type: "single" as const,
          options: [
            {
              label: oneTimeLuauApproval ? "Run once" : "Allow this run",
              value: "allow",
              description: oneTimeLuauApproval
                ? "Execute this single Luau tool call."
                : "Permit the planned Studio changes until this run ends.",
            },
            {
              label: "Cancel",
              value: "cancel",
              description: "Stop before anything is changed.",
            },
          ],
        },
      ],
      signal
    )
    return answers[0] === "allow"
  }

  // Arbitrary Luau can mutate anything and cannot be forcibly cancelled once
  // execution begins, so it always requires a fresh, explicit decision.
  if (!reuseApprovalForRun) {
    return askForApproval()
  }

  const runId = useAgentStore.getState().runId
  if (runId && approvedRunId === runId) {
    return true
  }

  const runKey = runId || "unscoped"
  if (pendingApproval?.runKey === runKey) {
    return pendingApproval.promise
  }

  const promise = (async () => {
    const approved = await askForApproval()
    if (approved && runId) {
      approvedRunId = runId
    }
    return approved
  })()

  pendingApproval = { runKey, promise }
  try {
    return await promise
  } finally {
    if (pendingApproval?.promise === promise) {
      pendingApproval = null
    }
  }
}

export const robloxAskUser = tool({
  description: `Ask the user questions when you need clarification or input.

Use this tool when:
- You need to understand user preferences before proceeding
- There are multiple valid approaches and you want user input
- You need specific parameters or values the user should decide
- Confirming destructive actions before executing
- Showing toolbox search results for user to pick from

You can ask 1-4 questions at once. Each question can be:
- Single choice: User picks one option
- Multi choice: User can select multiple options
- Text: User types a free-form answer

Options can be simple strings OR objects with:
- label: Display text
- value: Return value (defaults to label)
- imageUrl: Thumbnail URL to show
- description: Short description

When showing toolbox results, use the rich option format with imageUrl from thumbnails.

Examples:
- "What color should the car be?" with options ["Red", "Blue", "Green"]
- Pick a model with options [{ label: "Car", value: "12345", imageUrl: "..." }]`,
  inputSchema: z.object({
    questions: z
      .array(
        z.object({
          question: z.string().min(1).max(500).describe("The question to ask the user"),
          options: z
            .array(
              z.union([
                z.string().min(1).max(200),
                z.object({
                  label: z.string().min(1).max(200).describe("Display text"),
                  value: z.string().max(500).optional().describe("Return value (defaults to label)"),
                  imageUrl: z.url().max(2_000).optional().describe("Thumbnail URL"),
                  description: z.string().max(500).optional().describe("Short description"),
                }),
              ])
            )
            .max(50)
            .optional()
            .describe("Options for single/multi choice - can be strings or {label, value, imageUrl, description}"),
          type: z.enum(["single", "multi", "text"]).default("text").describe("Question type"),
        })
      )
      .min(1)
      .max(4)
      .describe("1-4 questions to ask the user"),
  }),
  execute: async (
    {
      questions,
    }: {
      questions: AskUserQuestion[]
    },
    options
  ) => {
    const answers = await askQuestions(questions, options.abortSignal)

    return {
      answered: true,
      questions: questions.map((q, i) => ({
        question: q.question,
        answer: answers[i],
      })),
    }
  },
})

// ============================================================================
// Export all tools
// ============================================================================

const baseRobloxTools = {
  // Script tools
  roblox_get_script: robloxGetScript,
  roblox_set_script: robloxSetScript,
  roblox_edit_script: robloxEditScript,

  // Instance tools
  roblox_get_children: robloxGetChildren,
  roblox_get_properties: robloxGetProperties,
  roblox_set_property: robloxSetProperty,
  roblox_create: robloxCreate,
  roblox_delete: robloxDelete,
  roblox_clone: robloxClone,
  roblox_search: robloxSearch,
  roblox_get_selection: robloxGetSelection,
  roblox_run_code: robloxRunCode,
  roblox_move: robloxMove,

  // Bulk tools
  roblox_bulk_create: robloxBulkCreate,
  roblox_bulk_delete: robloxBulkDelete,
  roblox_bulk_set_property: robloxBulkSetProperty,

  // Toolbox tools
  roblox_toolbox_search: robloxToolboxSearch,
  roblox_insert_asset: robloxInsertAsset,

  // Agentic tools
  roblox_ask_user: robloxAskUser,
}

type RobloxToolName = keyof typeof baseRobloxTools

const approvalActions: Partial<Record<RobloxToolName, string>> = {
  roblox_set_script: "replace script source",
  roblox_edit_script: "edit script source",
  roblox_set_property: "change instance properties",
  roblox_create: "create instances",
  roblox_delete: "delete instances",
  roblox_clone: "clone instances",
  roblox_run_code: "execute arbitrary Luau code",
  roblox_move: "move instances",
  roblox_bulk_create: "create multiple instances",
  roblox_bulk_delete: "delete multiple instances",
  roblox_bulk_set_property: "change multiple properties",
  roblox_insert_asset: "insert a Creator Store asset",
}

const studioEvidenceKinds: Partial<
  Record<RobloxToolName, "mutation" | "readback">
> = {
  roblox_get_script: "readback",
  roblox_get_children: "readback",
  roblox_get_properties: "readback",
  roblox_search: "readback",
  roblox_get_selection: "readback",
  roblox_set_script: "mutation",
  roblox_edit_script: "mutation",
  roblox_set_property: "mutation",
  roblox_create: "mutation",
  roblox_delete: "mutation",
  roblox_clone: "mutation",
  roblox_run_code: "mutation",
  roblox_move: "mutation",
  roblox_bulk_create: "mutation",
  roblox_bulk_delete: "mutation",
  roblox_bulk_set_property: "mutation",
  roblox_insert_asset: "mutation",
}

function hasToolError(output: unknown) {
  return Boolean(
    output &&
      typeof output === "object" &&
      "error" in output &&
      output.error
  )
}

function partialMutationApplied(output: unknown) {
  if (!output || typeof output !== "object") return false
  const result = output as {
    partial?: unknown
    count?: unknown
    paths?: unknown
    deleted?: unknown
  }
  return (
    result.partial === true &&
    ((typeof result.count === "number" && result.count > 0) ||
      (Array.isArray(result.paths) && result.paths.length > 0) ||
      (Array.isArray(result.deleted) && result.deleted.length > 0))
  )
}

function withRunControls<T>(
  toolName: RobloxToolName,
  toolDefinition: T
): T {
  const action = approvalActions[toolName]
  const evidenceKind = studioEvidenceKinds[toolName]
  if (!action && !evidenceKind) return toolDefinition

  const executable = toolDefinition as unknown as {
    execute: (
      input: unknown,
      options?: ToolExecutionOptions
    ) => Promise<unknown>
  }
  const originalExecute = executable.execute

  return {
    ...(toolDefinition as object),
    execute: async (input: unknown, options?: ToolExecutionOptions) => {
      if (action) {
        const approved = await confirmStudioChanges(
          action,
          options?.abortSignal,
          toolName !== "roblox_run_code"
        )
        if (!approved) {
          return {
            error:
              toolName === "roblox_run_code"
                ? "Luau execution was not approved. Active Luau cannot be forcibly cancelled once it starts."
                : "Studio changes were not approved",
            retryable: false,
          }
        }
      }

      const operation = evidenceKind
        ? useAgentStore
            .getState()
            .beginStudioOperation(toolName, evidenceKind)
        : null
      const output = await originalExecute(input, options)

      if (
        operation &&
        (!hasToolError(output) ||
          (evidenceKind === "mutation" && partialMutationApplied(output)))
      ) {
        useAgentStore.getState().completeStudioOperation(operation)
      }

      return output
    },
  } as T
}

export const robloxTools = Object.fromEntries(
  (Object.entries(baseRobloxTools) as Array<
    [RobloxToolName, (typeof baseRobloxTools)[RobloxToolName]]
  >).map(([name, toolDefinition]) => [
    name,
    withRunControls(name, toolDefinition),
  ])
) as typeof baseRobloxTools
