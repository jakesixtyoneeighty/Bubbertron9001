import { beforeEach, describe, expect, it, vi } from "vitest"
import { useAgentStore } from "@/stores/agent"

vi.mock("@/lib/local-bridge", () => ({
  authenticatedLocalFetch: vi.fn(),
}))

import { authenticatedLocalFetch } from "@/lib/local-bridge"
import {
  getStudioOperationStatus,
  studioRequest,
} from "../client"

const localFetch = vi.mocked(authenticatedLocalFetch)

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

describe("Studio bridge client operation context", () => {
  beforeEach(() => {
    localFetch.mockReset()
    useAgentStore.getState().reset()
  })

  it("sends client-known ownership and capability metadata", async () => {
    localFetch.mockResolvedValueOnce(jsonResponse({ path: "game.Workspace" }))

    await expect(
      studioRequest(
        "/children/get",
        { path: "game.Workspace" },
        undefined,
        {
          operationId: "op_test_read",
          runId: "run_test",
          ownerId: "explorer",
          stepId: "inspect",
          capability: "read",
          target: "game.Workspace",
        },
      ),
    ).resolves.toEqual({
      success: true,
      data: { path: "game.Workspace" },
    })

    const request = JSON.parse(
      String((localFetch.mock.calls[0]?.[1] as RequestInit | undefined)?.body),
    )
    expect(request).toMatchObject({
      path: "/children/get",
      operation_id: "op_test_read",
      run_id: "run_test",
      owner_id: "explorer",
      step_id: "inspect",
      capability: "read",
      target: "game.Workspace",
    })
  })

  it("cancels a client-known operation when its parent signal stops", async () => {
    localFetch.mockImplementation(async (url, init) => {
      if (String(url).endsWith("/operation/cancel")) {
        return jsonResponse({
          operation_id: "op_cancel_me",
          request_id: "req_cancel_me",
          status: "cancelled",
          leased: false,
          may_complete: false,
          completed_after_cancel: false,
        })
      }
      await new Promise<void>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("Aborted", "AbortError")),
          { once: true },
        )
      })
      throw new Error("unreachable")
    })
    const controller = new AbortController()
    const request = studioRequest(
      "/instance/create",
      { parent: "game.Workspace" },
      controller.signal,
      { operationId: "op_cancel_me", capability: "mutation" },
    )

    controller.abort()
    await expect(request).resolves.toEqual({
      success: false,
      error: "Agent run cancelled",
      operationId: "op_cancel_me",
      operationStatus: {
        operation_id: "op_cancel_me",
        request_id: "req_cancel_me",
        status: "cancelled",
        leased: false,
        may_complete: false,
        completed_after_cancel: false,
      },
    })
    await vi.waitFor(() => {
      const cancellation = localFetch.mock.calls.find(([url]) =>
        String(url).endsWith("/operation/cancel"),
      )
      expect(cancellation).toBeDefined()
      expect(JSON.parse(String(cancellation?.[1]?.body))).toEqual({
        operation_id: "op_cancel_me",
      })
    })
  })

  it("returns may-complete status when Stop reaches an already leased operation", async () => {
    localFetch.mockImplementation(async (url, init) => {
      if (String(url).endsWith("/operation/cancel")) {
        return jsonResponse({
          operation_id: "op_leased_stop",
          request_id: "req_leased_stop",
          status: "cancel_requested",
          leased: true,
          may_complete: true,
          completed_after_cancel: false,
        })
      }
      await new Promise<void>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("Aborted", "AbortError")),
          { once: true },
        )
      })
      throw new Error("unreachable")
    })
    const controller = new AbortController()
    const pending = studioRequest(
      "/game/install",
      { templateId: "obby-starter" },
      controller.signal,
      {
        operationId: "op_leased_stop",
        capability: "template_install",
      },
    )

    controller.abort()

    await expect(pending).resolves.toMatchObject({
      success: false,
      operationId: "op_leased_stop",
      operationStatus: {
        status: "cancel_requested",
        leased: true,
        may_complete: true,
      },
    })
  })

  it("reads explicit late-completion status", async () => {
    localFetch.mockResolvedValueOnce(jsonResponse({
      operation_id: "op_late",
      request_id: "req_late",
      status: "completed",
      leased: true,
      may_complete: false,
      completed_after_cancel: true,
    }))

    await expect(getStudioOperationStatus("op_late")).resolves.toMatchObject({
      status: "completed",
      completed_after_cancel: true,
    })
  })

  it("rejects malformed operation status at the client boundary", async () => {
    localFetch.mockResolvedValueOnce(jsonResponse({
      operation_id: "op_invalid",
      status: "completed",
      may_complete: "no",
    }))

    await expect(getStudioOperationStatus("op_invalid")).resolves.toBeNull()
  })
})
