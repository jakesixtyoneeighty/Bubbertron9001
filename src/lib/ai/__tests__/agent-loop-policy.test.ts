import { describe, expect, it } from "vitest"
import {
  getAgentLoopStopReason,
  MAX_AGENT_ITERATIONS,
} from "../agent-loop-policy"

function step(...outputs: unknown[]) {
  return { toolResults: outputs.map((output) => ({ output })) }
}

describe("agent loop policy", () => {
  it("allows successful work to continue past the old 18-step ceiling", () => {
    const steps = Array.from({ length: 19 }, () =>
      step({ success: true })
    )
    expect(getAgentLoopStopReason(steps)).toBeNull()
  })

  it("stops three identical failed tool steps without burning the hard cap", () => {
    const steps = Array.from({ length: 3 }, () =>
      step({ error: "Position expects three comma-separated numbers" })
    )
    expect(getAgentLoopStopReason(steps)).toContain(
      "repeating the same failed tool step 3 times"
    )
  })

  it("does not treat changing recovery errors as a blind retry loop", () => {
    expect(
      getAgentLoopStopReason([
        step({ error: "Missing PartA" }),
        step({ error: "Missing PartB" }),
        step({ error: "Missing PartC" }),
      ])
    ).toBeNull()
  })

  it("retains a finite hard safety cap", () => {
    const steps = Array.from({ length: MAX_AGENT_ITERATIONS }, () =>
      step({ success: true })
    )
    expect(getAgentLoopStopReason(steps)).toBe(
      `Agent stopped after ${MAX_AGENT_ITERATIONS} steps to prevent an unsafe loop`
    )
  })
})
