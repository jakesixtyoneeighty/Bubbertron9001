import {
  GAME_CATALOG,
  GAME_TEMPLATE_IDS,
  type GameCatalogEntry,
  type GameTemplateId,
} from "./catalog"
import {
  MAX_SCRIPT_BYTES,
  MAX_TOTAL_SCRIPT_BYTES,
  gameTemplateManifestSchema,
  type GameTemplateManifest,
} from "./schema"
import { sha256 } from "./sha256"

export interface LoadedTrustedScript {
  assetId: string
  path: string
  targetPath: string
  className: "Script" | "LocalScript"
  source: string
  sha256: string
}

export interface LoadedGameTemplate {
  manifest: GameTemplateManifest
  scripts: readonly LoadedTrustedScript[]
}

const manifestModules = import.meta.glob<unknown>(
  "../../../games/*/manifest.json",
  { import: "default" },
)

const scriptModules = import.meta.glob<string>(
  "../../../games/*/scripts/*.luau",
  { query: "?raw", import: "default" },
)

const bundleDirectories: Record<GameTemplateId, string> = {
  "obby-starter": "obby",
}

const names = new Set<string>(GAME_TEMPLATE_IDS)
const catalog = new Map<GameTemplateId, GameCatalogEntry>(
  GAME_CATALOG.map((game) => [game.id, game]),
)
const rawCache = new Map<string, Promise<string>>()
const templateCache = new Map<GameTemplateId, Promise<LoadedGameTemplate>>()

function displayPath(path: string) {
  const index = path.indexOf("games/")
  return index === -1 ? path : path.slice(index)
}

function manifestPath(id: GameTemplateId) {
  return `../../../games/${bundleDirectories[id]}/manifest.json`
}

function scriptPath(id: GameTemplateId, relativePath: string) {
  return `../../../games/${bundleDirectories[id]}/${relativePath}`
}

async function loadRawScript(path: string) {
  const cached = rawCache.get(path)
  if (cached) {
    return cached
  }

  const loader = scriptModules[path]
  if (!loader) {
    throw new Error(`Bundled game script is missing: ${displayPath(path)}`)
  }

  const pending = loader().then((source) => {
    if (typeof source !== "string") {
      throw new Error(`Bundled game script is not text: ${displayPath(path)}`)
    }
    return source
  })
  rawCache.set(path, pending)
  pending.catch(() => rawCache.delete(path))
  return pending
}

export function validateLoadedTemplateAssets(
  manifest: GameTemplateManifest,
  scripts: readonly LoadedTrustedScript[],
) {
  if (scripts.length !== manifest.scripts.length) {
    throw new Error(`Trusted script count does not match ${manifest.id}@${manifest.version}`)
  }

  const assetIds = new Set<string>()
  const targetPaths = new Set<string>()
  let totalBytes = 0

  for (const script of scripts) {
    const descriptor = manifest.scripts.find((item) => item.assetId === script.assetId)
    if (!descriptor) {
      throw new Error(`Unknown bundled script asset: ${script.assetId}`)
    }
    if (assetIds.has(script.assetId) || targetPaths.has(script.targetPath)) {
      throw new Error(`Duplicate bundled script asset or target: ${script.assetId}`)
    }
    assetIds.add(script.assetId)
    targetPaths.add(script.targetPath)

    if (
      descriptor.path !== script.path
      || descriptor.targetPath !== script.targetPath
      || descriptor.className !== script.className
      || descriptor.sha256 !== script.sha256
    ) {
      throw new Error(`Bundled script descriptor mismatch: ${script.assetId}`)
    }

    const byteLength = new TextEncoder().encode(script.source).byteLength
    totalBytes += byteLength
    if (byteLength > MAX_SCRIPT_BYTES) {
      throw new Error(`Bundled script exceeds the per-script size limit: ${script.assetId}`)
    }
    if (sha256(script.source) !== descriptor.sha256) {
      throw new Error(`Bundled script hash mismatch: ${script.assetId}`)
    }
  }

  if (totalBytes > MAX_TOTAL_SCRIPT_BYTES) {
    throw new Error("Bundled scripts exceed the total size limit")
  }
}

async function loadUncached(id: GameTemplateId): Promise<LoadedGameTemplate> {
  const entry = catalog.get(id)
  if (!entry) {
    throw new Error(`Game catalog entry is missing: ${id}`)
  }

  const path = manifestPath(id)
  const loader = manifestModules[path]
  if (!loader) {
    throw new Error(`Bundled game manifest is missing: ${displayPath(path)}`)
  }

  const parsed = gameTemplateManifestSchema.safeParse(await loader())
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "manifest"}: ${issue.message}`)
      .join("; ")
    throw new Error(`Bundled game manifest is invalid: ${displayPath(path)}: ${details}`)
  }
  const manifest = parsed.data
  if (manifest.id !== entry.id || manifest.version !== entry.version) {
    throw new Error(`Bundled game manifest does not match its catalog entry: ${id}`)
  }

  const scripts = await Promise.all(manifest.scripts.map(async (descriptor) => ({
    ...descriptor,
    source: await loadRawScript(scriptPath(id, descriptor.path)),
  })))
  validateLoadedTemplateAssets(manifest, scripts)

  return { manifest, scripts }
}

export function getGameCatalog(): readonly GameCatalogEntry[] {
  return GAME_CATALOG
}

export function isGameTemplateId(id: string): id is GameTemplateId {
  return names.has(id)
}

export function requireGameTemplateId(id: string): GameTemplateId {
  if (!isGameTemplateId(id)) {
    throw new Error(
      `Unknown game template "${id}". Choose an exact ID from the game catalog.`,
    )
  }
  return id
}

export function getGameTemplate(id: string): GameCatalogEntry | undefined {
  return isGameTemplateId(id) ? catalog.get(id) : undefined
}

export function loadGameTemplate(id: string): Promise<LoadedGameTemplate> {
  const safeId = requireGameTemplateId(id)
  const cached = templateCache.get(safeId)
  if (cached) {
    return cached
  }

  const pending = loadUncached(safeId)
  templateCache.set(safeId, pending)
  pending.catch(() => templateCache.delete(safeId))
  return pending
}

export function clearGameTemplateCache() {
  rawCache.clear()
  templateCache.clear()
}
