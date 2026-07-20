import { describe, expect, it } from "vitest"
import {
  CODEX_FORCED_WEB_SEARCH_CHOICE,
  CODEX_WORKING_TOOL_NAMES,
} from "../codex-chat"

describe("Codex Responses contract", () => {
  it("forces hosted web search through an allowed-tools choice", () => {
    expect(CODEX_FORCED_WEB_SEARCH_CHOICE).toEqual({
      type: "allowed_tools",
      mode: "required",
      tools: [{ type: "web_search" }],
    })
  })

  it("withholds finish from normal execution and repair turns", () => {
    expect(CODEX_WORKING_TOOL_NAMES).toContain("roblox_get_script")
    expect(CODEX_WORKING_TOOL_NAMES).toContain("agent_update_plan")
    expect(CODEX_WORKING_TOOL_NAMES).toContain("agent_delegate")
    expect(CODEX_WORKING_TOOL_NAMES).toContain("agent_manage_workers")
    expect(CODEX_WORKING_TOOL_NAMES).not.toContain("agent_finish_plan")
  })
})
