import { describe, expect, it } from "vitest"
import { buildRobloxSystemPrompt } from "./system-prompt"

describe("buildRobloxSystemPrompt", () => {
  it("routes ambiguous creative builds through design approval before mutation", () => {
    const prompt = buildRobloxSystemPrompt()

    expect(prompt).toContain("roblox-game-design")
    expect(prompt).toContain("explicit design or Change Preview approval")
    expect(prompt).toContain("separate from Studio mutation permission")
  })

  it("loads verification guidance before completion claims", () => {
    const prompt = buildRobloxSystemPrompt()

    expect(prompt).toContain("load roblox-verification")
    expect(prompt).toContain("behavioral claims require test or connected playtest evidence")
  })

  it("reviews multi-step plans with the adapted execution skill", () => {
    const prompt = buildRobloxSystemPrompt()

    expect(prompt).toContain("load roblox-plan-execution")
    expect(prompt).toContain("review the visible plan before its first mutation")
  })
})
