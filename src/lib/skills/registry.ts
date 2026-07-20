import {
  SKILL_CATALOG,
  SKILL_NAMES,
  type SkillCatalogEntry,
  type SkillName,
} from "./catalog"

export type SkillDetail = "quick" | "full"

export interface LoadedSkill {
  name: SkillName
  description: string
  detail: SkillDetail
  files: string[]
  content: string
}

const quickModules = import.meta.glob<string>(
  "../../../skills/*/SKILL.md",
  { query: "?raw", import: "default" },
)

const referenceModules = import.meta.glob<string>(
  "../../../skills/*/references/*",
  { query: "?raw", import: "default" },
)

const names = new Set<string>(SKILL_NAMES)
const catalog = new Map<SkillName, SkillCatalogEntry>(
  SKILL_CATALOG.map((skill) => [skill.name, skill]),
)
const rawCache = new Map<string, Promise<string>>()
const skillCache = new Map<string, Promise<LoadedSkill>>()

const DEFAULT_SEARCH_LIMIT = 8

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
}

function clampLimit(limit: number | undefined) {
  if (limit === undefined || !Number.isFinite(limit)) {
    return DEFAULT_SEARCH_LIMIT
  }

  return Math.min(SKILL_CATALOG.length, Math.max(1, Math.trunc(limit)))
}

function modulePath(name: SkillName) {
  return `../../../skills/${name}/SKILL.md`
}

function referencePrefix(name: SkillName) {
  return `../../../skills/${name}/references/`
}

function displayPath(path: string) {
  const index = path.indexOf("skills/")
  return index === -1 ? path : path.slice(index)
}

function section(path: string, content: string) {
  return `<!-- ${displayPath(path)} -->\n\n${content.trim()}`
}

function loadRaw(path: string, loader: (() => Promise<string>) | undefined) {
  if (!loader) {
    return Promise.reject(new Error(`Bundled skill asset is missing: ${displayPath(path)}`))
  }

  const cached = rawCache.get(path)
  if (cached) {
    return cached
  }

  const pending = loader().then((content) => {
    if (typeof content !== "string") {
      throw new Error(`Bundled skill asset is not text: ${displayPath(path)}`)
    }

    return content
  })

  rawCache.set(path, pending)
  pending.catch(() => rawCache.delete(path))
  return pending
}

async function loadUncached(name: SkillName, detail: SkillDetail) {
  const entry = catalog.get(name)
  if (!entry) {
    throw new Error(`Skill catalog entry is missing: ${name}`)
  }

  const quickPath = modulePath(name)
  const quick = await loadRaw(quickPath, quickModules[quickPath])

  if (detail === "quick") {
    return {
      name,
      description: entry.description,
      detail,
      files: [displayPath(quickPath)],
      content: quick.trim(),
    } satisfies LoadedSkill
  }

  const prefix = referencePrefix(name)
  const references = Object.entries(referenceModules)
    .filter(([path]) => path.startsWith(prefix))
    .sort(([left], [right]) => {
      const leftPriority = left.endsWith("/full.md") ? 0 : 1
      const rightPriority = right.endsWith("/full.md") ? 0 : 1
      return leftPriority - rightPriority || left.localeCompare(right)
    })

  if (references.length === 0) {
    throw new Error(`Full reference is missing for skill: ${name}`)
  }

  const loaded = await Promise.all(
    references.map(async ([path, loader]) => ({
      path,
      content: await loadRaw(path, loader),
    })),
  )

  return {
    name,
    description: entry.description,
    detail,
    files: [displayPath(quickPath), ...loaded.map((item) => displayPath(item.path))],
    content: [
      section(quickPath, quick),
      ...loaded.map((item) => section(item.path, item.content)),
    ].join("\n\n---\n\n"),
  } satisfies LoadedSkill
}

export function getSkillCatalog(): readonly SkillCatalogEntry[] {
  return SKILL_CATALOG
}

export function isSkillName(name: string): name is SkillName {
  return names.has(name)
}

export function requireSkillName(name: string): SkillName {
  if (!isSkillName(name)) {
    throw new Error(
      `Unknown skill "${name}". Use skill_search and pass an exact allowlisted skill name.`,
    )
  }

  return name
}

export function getSkill(name: string): SkillCatalogEntry | undefined {
  return isSkillName(name) ? catalog.get(name) : undefined
}

export function searchSkills(query: string, limit?: number): SkillCatalogEntry[] {
  const phrase = normalize(query)
  if (!phrase) {
    return []
  }

  const terms = [...new Set(phrase.split(" ").filter(Boolean))]
  const scored = SKILL_CATALOG.map((skill, order) => {
    const skillName = normalize(skill.name)
    const description = normalize(skill.description)
    const category = normalize(skill.category)
    const keywords = normalize(skill.keywords.join(" "))
    const searchable = `${skillName} ${description} ${category} ${keywords}`
    let score = 0

    if (skillName === phrase || skill.name === query.toLowerCase()) {
      score += 1_000
    } else if (skillName.includes(phrase)) {
      score += 120
    }

    if (description.includes(phrase)) {
      score += 80
    }
    if (keywords.includes(phrase)) {
      score += 60
    }

    for (const term of terms) {
      if (skillName.split(" ").includes(term)) {
        score += 40
      } else if (skillName.includes(term)) {
        score += 20
      }

      if (keywords.includes(term)) {
        score += 14
      }
      if (description.includes(term)) {
        score += 8
      }
      if (category.includes(term)) {
        score += 3
      }
    }

    if (terms.every((term) => searchable.includes(term))) {
      score += 20
    }

    return { skill, score, order }
  })

  return scored
    .filter((result) => result.score > 0)
    .sort((left, right) => right.score - left.score || left.order - right.order)
    .slice(0, clampLimit(limit))
    .map((result) => result.skill)
}

export function loadSkill(name: string, detail: SkillDetail = "quick") {
  const safeName = requireSkillName(name)
  if (detail !== "quick" && detail !== "full") {
    return Promise.reject(new Error(`Unknown skill detail level: ${String(detail)}`))
  }

  const key = `${safeName}:${detail}`
  const cached = skillCache.get(key)
  if (cached) {
    return cached
  }

  const pending = loadUncached(safeName, detail)
  skillCache.set(key, pending)
  pending.catch(() => skillCache.delete(key))
  return pending
}

export function clearSkillCache() {
  rawCache.clear()
  skillCache.clear()
}
