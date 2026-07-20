import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useAgentStore } from "@/stores/agent"
import { useSettingsStore } from "@/stores/settings"
import {
  agentCreatePlan,
  agentFinishPlan,
  agentUpdatePlan,
} from "@/lib/agent/planning"
import { isStudioConnected, studioRequest } from "../client"
import { getAssetDetails, searchToolbox } from "../toolbox"

vi.mock("../client", () => ({
  studioRequest: vi.fn(),
  isStudioConnected: vi.fn().mockResolvedValue(false),
  notConnectedError: () => "Studio is not connected",
}))

vi.mock("../toolbox", () => ({
  searchToolbox: vi.fn(),
  getAssetDetails: vi.fn(),
}))

import {
  cancelPendingQuestions,
  robloxBulkCreate,
  robloxBulkDelete,
  robloxBulkSetProperty,
  robloxGetRecentLogs,
  robloxInsertAsset,
  robloxToolboxSearch,
  robloxTools,
  setAskUserHandler,
} from "../tools"

function executeDelete(path: string) {
  const candidate = robloxTools.roblox_delete as unknown as {
    execute: (input: { path: string }) => Promise<unknown>
  }
  return candidate.execute({ path })
}

function executeTool(
  toolDefinition: unknown,
  input: Record<string, unknown>,
  options?: Record<string, unknown>,
) {
  const candidate = toolDefinition as {
    execute: (
      value: Record<string, unknown>,
      options?: Record<string, unknown>,
    ) => Promise<unknown>
  }
  return candidate.execute(input, options)
}

function parseToolInput(toolDefinition: unknown, input: unknown) {
  const candidate = toolDefinition as {
    inputSchema: {
      safeParse: (value: unknown) => { success: boolean }
    }
  }
  return candidate.inputSchema.safeParse(input)
}

describe("playtest diagnostic readbacks", () => {
  beforeEach(() => {
    useAgentStore.getState().reset()
    useAgentStore.getState().beginRun("Inspect the playtest", true)
    vi.mocked(isStudioConnected).mockReset()
    vi.mocked(isStudioConnected).mockResolvedValue(true)
    vi.mocked(studioRequest).mockReset()
  })

  afterEach(() => {
    vi.mocked(isStudioConnected).mockReset()
    vi.mocked(isStudioConnected).mockResolvedValue(false)
    vi.mocked(studioRequest).mockReset()
  })

  it("reads and validates the current Studio playtest state", async () => {
    vi.mocked(studioRequest).mockResolvedValue({
      success: true,
      data: {
        state: "running",
        runState: "Running",
        isRunning: true,
        isEdit: false,
        isRunMode: false,
        isClient: true,
        isServer: false,
        isStudio: true,
        observedAt: 1_750_000_000,
      },
    })

    await expect(
      executeTool(robloxTools.roblox_get_playtest_state, {})
    ).resolves.toMatchObject({
      state: "running",
      runState: "Running",
      isRunning: true,
    })
    expect(studioRequest).toHaveBeenCalledWith(
      "/playtest/state",
      undefined,
      undefined,
      {},
    )
    expect(useAgentStore.getState().studioEvidence.readbackCount).toBe(1)
  })

  it("validates bounded logs without counting them as verification evidence", async () => {
    vi.mocked(studioRequest).mockResolvedValue({
      success: true,
      data: {
        logs: [
          {
            sequence: 7,
            timestamp: 1_750_000_001,
            level: "warning",
            message: "Infinite yield possible",
            truncated: false,
          },
          {
            sequence: 8,
            timestamp: 1_750_000_002,
            level: "error",
            message: "attempt to index nil",
            truncated: false,
          },
        ],
        count: 2,
        available: 2,
        stored: 10,
        dropped: 0,
        hasMore: false,
        messageTruncations: 0,
        payloadTruncated: false,
        bridgeMessagesExcluded: true,
        diagnosticOnly: true,
      },
    })

    await expect(
      executeTool(robloxTools.roblox_get_recent_logs, {
        limit: 25,
        levels: ["warning", "error"],
      })
    ).resolves.toMatchObject({
      count: 2,
      logs: [
        { level: "warning" },
        { level: "error" },
      ],
      bridgeMessagesExcluded: true,
      diagnosticOnly: true,
    })
    expect(studioRequest).toHaveBeenCalledWith(
      "/playtest/logs",
      { limit: 25, levels: ["warning", "error"] },
      undefined,
      {},
    )
    expect(useAgentStore.getState().studioEvidence.readbackCount).toBe(0)
  })

  it("rejects malformed Studio log payloads instead of recording evidence", async () => {
    vi.mocked(studioRequest).mockResolvedValue({
      success: true,
      data: {
        logs: [{
          sequence: 1,
          timestamp: 1_750_000_000,
          level: "error",
          message: "x".repeat(4_097),
          truncated: false,
        }],
        count: 1,
        available: 1,
        stored: 1,
        dropped: 0,
        hasMore: false,
        messageTruncations: 0,
        payloadTruncated: false,
        bridgeMessagesExcluded: true,
        diagnosticOnly: true,
      },
    })

    await expect(
      executeTool(robloxTools.roblox_get_recent_logs, { limit: 10 })
    ).resolves.toEqual({
      error: "Studio returned an invalid recent log response",
    })
    expect(useAgentStore.getState().studioEvidence.readbackCount).toBe(0)
  })

  it("bounds log request size and rejects duplicate filters at the provider edge", () => {
    expect(parseToolInput(robloxGetRecentLogs, { limit: 100 }).success).toBe(true)
    expect(parseToolInput(robloxGetRecentLogs, { limit: 101 }).success).toBe(false)
    expect(
      parseToolInput(robloxGetRecentLogs, {
        limit: 10,
        levels: ["error", "error"],
      }).success
    ).toBe(false)
  })
})

describe("Studio mutation approval", () => {
  beforeEach(() => {
    cancelPendingQuestions()
    setAskUserHandler(null)
    useAgentStore.getState().reset()
    useSettingsStore.getState().updateAppSettings({
      confirmDestructiveActions: true,
    })
  })

  it("shares one approval across concurrent mutations in an agent run", async () => {
    const handler = vi.fn().mockResolvedValue(["allow"])
    setAskUserHandler(handler)
    useAgentStore.getState().beginRun("Delete test parts", true)

    await Promise.all([
      executeDelete("game.Workspace.TestPart"),
      executeDelete("game.Workspace.OtherTestPart"),
    ])

    expect(handler).toHaveBeenCalledTimes(1)
  })

  it("does not execute a mutation when approval is declined", async () => {
    setAskUserHandler(vi.fn().mockResolvedValue(["cancel"]))
    useAgentStore.getState().beginRun("Delete a test part", true)

    await expect(
      executeDelete("game.Workspace.TestPart")
    ).resolves.toMatchObject({
      error: "Studio changes were not approved",
      retryable: false,
    })
  })
})

describe("Studio bulk mutation results", () => {
  beforeEach(() => {
    vi.mocked(isStudioConnected).mockResolvedValue(true)
  })

  it("surfaces partial create failures with the successfully created paths", async () => {
    vi.mocked(studioRequest).mockResolvedValue({
      success: true,
      data: {
        created: ["game.Workspace.GoodPart"],
        errors: ["item 2: parent not found"],
      },
    })

    await expect(
      executeTool(robloxBulkCreate, {
        instances: [
          { className: "Part", parent: "game.Workspace", name: "GoodPart" },
          { className: "Part", parent: "game.Missing", name: "BadPart" },
        ],
      })
    ).resolves.toMatchObject({
      partial: true,
      retryable: true,
      count: 1,
      paths: ["game.Workspace.GoodPart"],
      errors: ["item 2: parent not found"],
    })
  })

  it("surfaces partial delete failures with the successfully deleted paths", async () => {
    vi.mocked(studioRequest).mockResolvedValue({
      success: true,
      data: {
        deleted: ["game.Workspace.OldPart"],
        errors: ["game.Workspace.Missing: not found"],
      },
    })

    await expect(
      executeTool(robloxBulkDelete, {
        paths: ["game.Workspace.OldPart", "game.Workspace.Missing"],
      })
    ).resolves.toMatchObject({
      partial: true,
      retryable: true,
      count: 1,
      deleted: ["game.Workspace.OldPart"],
    })
  })

  it("treats partial property updates as an error that can be repaired", async () => {
    vi.mocked(studioRequest).mockResolvedValue({
      success: true,
      data: {
        updated: 1,
        errors: ["operation 2: invalid property"],
      },
    })

    await expect(
      executeTool(robloxBulkSetProperty, {
        operations: [
          {
            path: "game.Workspace.Part",
            property: "Anchored",
            value: "true",
          },
          {
            path: "game.Workspace.Part",
            property: "NotAProperty",
            value: "true",
          },
        ],
      })
    ).resolves.toMatchObject({
      partial: true,
      retryable: true,
      count: 1,
    })
  })
})

async function createCompletedBuildPlan() {
  await executeTool(agentCreatePlan, {
    goal: "Create a verified part",
    summary: "Create the part, then inspect Studio",
    steps: [
      {
        id: "build",
        title: "Build and verify",
        description: "Create a part and read it back",
        tools: ["roblox_create", "roblox_get_children"],
        skillNames: ["roblox-building"],
        successCriteria: "The part is visible in Studio",
      },
    ],
  })
  await executeTool(agentUpdatePlan, {
    stepId: "build",
    status: "completed",
    notes: "Build step complete",
  })
}

async function finishBuildPlan() {
  return executeTool(agentFinishPlan, {
    summary: "Part created",
    verification: "Studio was inspected after the change",
    success: true,
  })
}

describe("deterministic Studio verification evidence", () => {
  beforeEach(() => {
    cancelPendingQuestions()
    setAskUserHandler(null)
    useAgentStore.getState().reset()
    useAgentStore.getState().beginRun("Create a verified part", true)
    useSettingsStore.getState().updateAppSettings({
      confirmDestructiveActions: false,
    })
    vi.mocked(isStudioConnected).mockReset()
    vi.mocked(isStudioConnected).mockResolvedValue(true)
    vi.mocked(studioRequest).mockReset()
  })

  it("rejects finishing when a successful mutation has no later readback", async () => {
    vi.mocked(studioRequest).mockResolvedValueOnce({
      success: true,
      data: { path: "game.Workspace.VerifiedPart" },
    })

    await createCompletedBuildPlan()
    await executeTool(robloxTools.roblox_create, {
      className: "Part",
      parent: "game.Workspace",
      name: "VerifiedPart",
    })

    await expect(finishBuildPlan()).resolves.toMatchObject({
      finished: false,
      retryable: true,
    })
    expect(useAgentStore.getState().phase).toBe("repairing")
    expect(useAgentStore.getState().studioEvidence.mutationCount).toBe(1)
  })

  it("allows finishing after a successful readback follows the mutation", async () => {
    vi.mocked(studioRequest)
      .mockResolvedValueOnce({
        success: true,
        data: { path: "game.Workspace.VerifiedPart" },
      })
      .mockResolvedValueOnce({
        success: true,
        data: [
          {
            path: "game.Workspace.VerifiedPart",
            name: "VerifiedPart",
            className: "Part",
          },
        ],
      })

    await createCompletedBuildPlan()
    await executeTool(robloxTools.roblox_create, {
      className: "Part",
      parent: "game.Workspace",
      name: "VerifiedPart",
    })
    await executeTool(robloxTools.roblox_get_children, {
      path: "game.Workspace",
    })

    await expect(finishBuildPlan()).resolves.toMatchObject({ finished: true })
    expect(useAgentStore.getState().phase).toBe("completed")
    expect(useAgentStore.getState().studioEvidence.readbackCount).toBe(1)
  })

  it("does not let an unrelated coordinator readback verify a mutation", async () => {
    vi.mocked(studioRequest)
      .mockResolvedValueOnce({
        success: true,
        data: { path: "game.Workspace.PartA" },
      })
      .mockResolvedValueOnce({ success: true, data: [] })
      .mockResolvedValueOnce({ success: true, data: [] })

    await createCompletedBuildPlan()
    await executeTool(robloxTools.roblox_set_property, {
      path: "game.Workspace.PartA",
      property: "Anchored",
      value: "true",
    })
    await executeTool(robloxTools.roblox_get_properties, {
      path: "game.Workspace.PartB",
    })

    await expect(finishBuildPlan()).resolves.toMatchObject({
      finished: false,
      retryable: true,
    })
    expect(useAgentStore.getState().lastError).toContain(
      "properties:game.Workspace.PartA",
    )

    await executeTool(robloxTools.roblox_get_properties, {
      path: "game.Workspace.PartA",
    })
    await expect(finishBuildPlan()).resolves.toMatchObject({ finished: true })
  })

  it("does not let a worker readback verify the coordinator's mutation", async () => {
    vi.mocked(studioRequest)
      .mockResolvedValueOnce({
        success: true,
        data: { path: "game.Workspace.VerifiedPart" },
      })
      .mockResolvedValueOnce({
        success: true,
        data: [
          {
            path: "game.Workspace.VerifiedPart",
            name: "VerifiedPart",
            className: "Part",
          },
        ],
      })

    await createCompletedBuildPlan()
    await executeTool(robloxTools.roblox_create, {
      className: "Part",
      parent: "game.Workspace",
      name: "VerifiedPart",
    })
    const runId = useAgentStore.getState().runId
    await executeTool(
      robloxTools.roblox_get_children,
      { path: "game.Workspace" },
      {
        experimental_context: {
          runId,
          ownerId: "explorer",
          stepId: "build",
        },
      },
    )

    await expect(finishBuildPlan()).resolves.toMatchObject({
      finished: false,
      retryable: true,
    })
    expect(useAgentStore.getState().studioEvidence.readbackCount).toBe(0)
  })

  it("rejects stale operations and worker mutation attempts before Studio", async () => {
    await expect(
      executeTool(
        robloxTools.roblox_get_children,
        { path: "game.Workspace" },
        {
          experimental_context: {
            runId: "run_stale",
            ownerId: "coordinator",
          },
        },
      ),
    ).resolves.toMatchObject({
      error: "This Studio operation belongs to a stale or different run",
      retryable: false,
    })

    await expect(
      executeTool(
        robloxTools.roblox_create,
        {
          className: "Part",
          parent: "game.Workspace",
          name: "ForbiddenWorkerPart",
        },
        {
          experimental_context: {
            runId: useAgentStore.getState().runId,
            ownerId: "explorer",
          },
        },
      ),
    ).resolves.toMatchObject({
      error: "Only the coordinator can change Roblox Studio",
      retryable: false,
    })
    expect(studioRequest).not.toHaveBeenCalled()
  })

  it("does not allow recent logs alone to verify a mutation", async () => {
    vi.mocked(studioRequest)
      .mockResolvedValueOnce({
        success: true,
        data: { path: "game.Workspace.VerifiedPart" },
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          logs: [],
          count: 0,
          available: 0,
          stored: 0,
          dropped: 0,
          hasMore: false,
          messageTruncations: 0,
          payloadTruncated: false,
          bridgeMessagesExcluded: true,
          diagnosticOnly: true,
        },
      })

    await createCompletedBuildPlan()
    await executeTool(robloxTools.roblox_create, {
      className: "Part",
      parent: "game.Workspace",
      name: "VerifiedPart",
    })
    await executeTool(robloxTools.roblox_get_recent_logs, { limit: 25 })

    await expect(finishBuildPlan()).resolves.toMatchObject({
      finished: false,
      retryable: true,
    })
    expect(useAgentStore.getState().studioEvidence.readbackCount).toBe(0)
  })

  it("does not count a failed read as verification", async () => {
    vi.mocked(studioRequest)
      .mockResolvedValueOnce({
        success: true,
        data: { path: "game.Workspace.VerifiedPart" },
      })
      .mockResolvedValueOnce({
        success: false,
        error: "Studio read failed",
        operationId: "operation-read-failed",
        operationStatus: null,
      })

    await createCompletedBuildPlan()
    await executeTool(robloxTools.roblox_create, {
      className: "Part",
      parent: "game.Workspace",
      name: "VerifiedPart",
    })
    await executeTool(robloxTools.roblox_get_children, {
      path: "game.Workspace",
    })

    await expect(finishBuildPlan()).resolves.toMatchObject({
      finished: false,
      retryable: true,
    })
    expect(useAgentStore.getState().studioEvidence.readbackCount).toBe(0)
  })
})

describe("arbitrary Luau confirmation", () => {
  beforeEach(() => {
    cancelPendingQuestions()
    useAgentStore.getState().reset()
    useAgentStore.getState().beginRun("Run two diagnostics", true)
    useSettingsStore.getState().updateAppSettings({
      // The power tool must still prompt when general mutation approvals are off.
      confirmDestructiveActions: false,
    })
    vi.mocked(isStudioConnected).mockReset()
    vi.mocked(isStudioConnected).mockResolvedValue(true)
    vi.mocked(studioRequest).mockReset()
    vi.mocked(studioRequest).mockResolvedValue({
      success: true,
      data: { output: "ok" },
    })
  })

  it("prompts for every run-code invocation", async () => {
    const handler = vi.fn().mockResolvedValue(["allow"])
    setAskUserHandler(handler)

    await executeTool(robloxTools.roblox_run_code, { code: "print('one')" })
    await executeTool(robloxTools.roblox_run_code, { code: "print('two')" })

    expect(handler).toHaveBeenCalledTimes(2)
    expect(handler.mock.calls[0][0][0].question).toContain(
      "cannot be forcibly cancelled"
    )
  })
})

describe("Creator Store tool safety metadata", () => {
  beforeEach(() => {
    vi.mocked(isStudioConnected).mockResolvedValue(true)
  })

  it("discloses script and sandbox metadata in search results", async () => {
    vi.mocked(searchToolbox).mockResolvedValue({
      assets: [
        {
          id: 9001,
          name: "Scripted Car",
          description: "A vehicle",
          category: "Model",
          assetTypeId: 10,
          creatorName: "Builder",
          creatorId: 42,
          thumbnailUrl: "https://tr.rbxcdn.com/9001.png",
          created: "",
          updated: "",
          voteCount: 100,
          upVotePercent: 95,
          hasScripts: true,
          scriptCount: 4,
          shouldSandbox: true,
          purchasable: true,
          isFree: true,
        },
      ],
    })

    await expect(
      executeTool(robloxToolboxSearch, {
        query: "car",
        category: "Model",
        limit: 5,
      })
    ).resolves.toMatchObject({
      count: 1,
      results: [
        {
          id: 9001,
          free: true,
          purchasable: true,
          hasScripts: true,
          scriptCount: 4,
          shouldSandbox: true,
          safetyDisclosure:
            "4 scripts reported; Creator Store recommends sandboxing",
          askUserOption: {
            description:
              "by Builder · 4 scripts reported; Creator Store recommends sandboxing",
          },
        },
      ],
    })
  })

  it("returns the Studio quarantine inventory after inserting a scripted model", async () => {
    vi.mocked(getAssetDetails).mockResolvedValue({
      id: 9001,
      name: "Scripted Car",
      description: "A vehicle",
      category: "Model",
      assetTypeId: 10,
      creatorName: "Builder",
      creatorId: 42,
      created: "",
      updated: "",
      hasScripts: true,
      scriptCount: 2,
      shouldSandbox: true,
      purchasable: true,
      isFree: true,
    })
    vi.mocked(studioRequest).mockResolvedValue({
      success: true,
      data: {
        path: "game.Workspace.Scripted Car",
        name: "Scripted Car",
        scriptsQuarantined: 1,
        scripts: [
          {
            name: "Drive",
            className: "Script",
            relativePath: "Scripted Car/Drive",
            quarantined: true,
            wasEnabled: true,
          },
          {
            name: "Config",
            className: "ModuleScript",
            relativePath: "Scripted Car/Config",
            quarantined: false,
          },
        ],
      },
    })

    await expect(
      executeTool(robloxInsertAsset, {
        assetId: 9001,
        parent: "game.Workspace",
      })
    ).resolves.toMatchObject({
      success: true,
      hasScripts: true,
      declaredScriptCount: 2,
      scriptsQuarantined: 1,
      shouldSandbox: true,
      metadataMismatch: false,
      requiresScriptReview: true,
      scripts: [
        {
          className: "Script",
          quarantined: true,
          wasEnabled: true,
        },
        {
          className: "ModuleScript",
          quarantined: false,
        },
      ],
    })

    expect(getAssetDetails).toHaveBeenCalledWith(9001, "Model")
    expect(studioRequest).toHaveBeenCalledWith(
      "/asset/insert",
      { assetId: 9001, parent: "game.Workspace" },
      undefined,
      {},
    )
  })

  it("refuses insertion when direct v2 validation does not prove a free model", async () => {
    vi.mocked(getAssetDetails).mockResolvedValue(null)

    await expect(
      executeTool(robloxInsertAsset, {
        assetId: 123,
        parent: "game.Workspace",
      })
    ).resolves.toEqual({
      error: "Asset 123 is not a free, purchasable Creator Store model",
    })

    expect(studioRequest).not.toHaveBeenCalled()
  })
})
