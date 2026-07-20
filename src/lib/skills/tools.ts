import { tool } from "ai"
import { z } from "zod"
import { SKILL_NAMES } from "./catalog"
import { loadSkill, searchSkills } from "./registry"

export const skill_search = tool({
  description: `Search Bubberton9001's compact Roblox skill catalog.

Use this before solving a Roblox task when the exact skill is not already known.
The result contains exact allowlisted names accepted by skill_load, without loading
the full skill documents into context.`,
  inputSchema: z.object({
    query: z
      .string()
      .min(1)
      .max(200)
      .describe("Roblox topic, task, API, or problem to find guidance for"),
    limit: z
      .number()
      .int()
      .min(1)
      .max(12)
      .default(6)
      .describe("Maximum number of matching skills"),
  }),
  execute: async ({ query, limit }) => {
    const matches = searchSkills(query, limit)
    return {
      query,
      count: matches.length,
      skills: matches.map((skill) => ({
        name: skill.name,
        category: skill.category,
        description: skill.description,
      })),
    }
  },
})

export const skill_load = tool({
  description: `Load an exact Roblox skill using progressive disclosure.

Start with detail="quick", which loads only the compact SKILL.md. Load
detail="full" only when implementation examples, API tables, or edge cases are
needed. Names are exact and allowlisted; use skill_search to discover them.`,
  inputSchema: z.object({
    name: z.enum(SKILL_NAMES).describe("Exact allowlisted skill name from skill_search"),
    detail: z
      .enum(["quick", "full"])
      .default("quick")
      .describe("Quick guidance or the complete skill plus all references"),
  }),
  execute: async ({ name, detail }) => loadSkill(name, detail),
})

export const skillTools = {
  skill_search,
  skill_load,
}
