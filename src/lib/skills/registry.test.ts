import { beforeEach, describe, expect, it } from "vitest"
import {
  getSkillCatalogSummary,
} from "./catalog"
import {
  clearSkillCache,
  getSkill,
  getSkillCatalog,
  isSkillName,
  loadSkill,
  searchSkills,
} from "./registry"
import { skill_load, skill_search } from "./tools"

describe("skill catalog", () => {
  it("contains the 30 unique vendored Roblox skills", () => {
    const catalog = getSkillCatalog()

    expect(catalog).toHaveLength(30)
    expect(new Set(catalog.map((skill) => skill.name))).toHaveLength(30)
    expect(catalog.every((skill) => skill.name.startsWith("roblox-"))).toBe(true)
  })

  it("provides a compact prompt-ready catalog summary", () => {
    const summary = getSkillCatalogSummary()

    expect(summary.split("\n")).toHaveLength(30)
    expect(summary).toContain("- roblox-debug:")
    expect(summary).toContain("- roblox-security:")
  })

  it("finds useful skills without loading their documents", () => {
    expect(searchSkills("RemoteEvent exploit")[0]?.name).toBe("roblox-networking")
    expect(searchSkills("Rojo formatting CI")[0]?.name).toBe("roblox-tooling")
    expect(searchSkills("fix a Luau crash", 2).map((skill) => skill.name)).toContain(
      "roblox-debug",
    )
    expect(searchSkills("   ")).toEqual([])
  })
})

describe("skill name safety", () => {
  it.each([
    "../roblox-debug",
    "roblox-debug/references/full.md",
    "ROBLOX-DEBUG",
    "roblox-does-not-exist",
  ])("rejects non-allowlisted name %s", (name) => {
    expect(isSkillName(name)).toBe(false)
    expect(getSkill(name)).toBeUndefined()
    expect(() => loadSkill(name)).toThrow(/Unknown skill/)
  })

  it("exposes AI SDK tools under their stable names", () => {
    expect(skill_search).toBeDefined()
    expect(skill_load).toBeDefined()
  })
})

describe("skill loading", () => {
  beforeEach(() => {
    clearSkillCache()
  })

  it("loads and caches only SKILL.md at quick detail", async () => {
    const first = await loadSkill("roblox-debug", "quick")
    const cached = await loadSkill("roblox-debug", "quick")

    expect(first.detail).toBe("quick")
    expect(first.files).toEqual(["skills/roblox-debug/SKILL.md"])
    expect(first.content).toContain("7-Step Debug Loop")
    expect(first.content).not.toContain("Iterative Debug Loop — Full Reference")
    expect(cached).toBe(first)
  })

  it("loads SKILL.md and every reference at full detail", async () => {
    const loaded = await loadSkill("roblox-analytics", "full")

    expect(loaded.detail).toBe("full")
    expect(loaded.files).toEqual([
      "skills/roblox-analytics/SKILL.md",
      "skills/roblox-analytics/references/full.md",
      "skills/roblox-analytics/references/event-batcher.luau",
    ])
    expect(loaded.content).toContain("skills/roblox-analytics/SKILL.md")
    expect(loaded.content).toContain("EventBatcher")
    expect(loaded.content).toContain("## 1. AnalyticsService API")
  })
})
