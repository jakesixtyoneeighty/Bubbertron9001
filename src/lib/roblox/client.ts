/**
 * HTTP Client for Roblox Studio communication via Bridge Server
 *
 * The bridge server runs on localhost:3001 and acts as an intermediary
 * between bubbertron9001 and the Roblox Studio plugin.
 */

import { authenticatedLocalFetch } from "@/lib/local-bridge"
import { useAgentStore } from "@/stores/agent"
import { z } from "zod"

const BRIDGE_URL = "http://localhost:3001"
const BRIDGE_NAMESPACE = "bubbertron9001"
const TIMEOUT_MS = 15000

export type StudioCapability = "read" | "mutation" | "template_install"

export interface StudioRequestContext {
  operationId?: string
  runId?: string
  ownerId?: string
  stepId?: string
  capability?: StudioCapability
  target?: string
  timeoutMs?: number
}

export interface StudioOperationStatus {
  operation_id: string
  request_id: string
  status:
    | "queued"
    | "leased"
    | "completed"
    | "failed"
    | "cancel_requested"
    | "cancelled"
  leased: boolean
  may_complete: boolean
  completed_after_cancel: boolean
}

const studioOperationStatusSchema = z.object({
  operation_id: z.string().min(1).max(128),
  request_id: z.string().max(128),
  status: z.enum([
    "queued",
    "leased",
    "completed",
    "failed",
    "cancel_requested",
    "cancelled",
  ]),
  leased: z.boolean(),
  may_complete: z.boolean(),
  completed_after_cancel: z.boolean(),
}).strict()

let fallbackOperationCounter = 0

function createOperationId() {
  fallbackOperationCounter += 1
  return (
    crypto.randomUUID?.() ??
    `local_${Date.now().toString(36)}_${fallbackOperationCounter.toString(36)}`
  )
}

function inferTarget(data?: object) {
  if (!data) return undefined
  const candidate = data as Record<string, unknown>
  for (const key of ["path", "parent", "root", "newParent"] as const) {
    if (typeof candidate[key] === "string") return candidate[key]
  }
  return undefined
}

function inferCapability(endpoint: string): StudioCapability {
  return /\/(get|children|properties|search|state|logs)$/.test(endpoint) ||
    endpoint === "/selection/get"
    ? "read"
    : "mutation"
}

function isAbortError(error: unknown) {
  return Boolean(
    error &&
      typeof error === "object" &&
      "name" in error &&
      error.name === "AbortError",
  )
}

export async function cancelStudioOperation(
  operationId: string,
): Promise<StudioOperationStatus | null> {
  try {
    const response = await authenticatedLocalFetch(
      `${BRIDGE_URL}/${BRIDGE_NAMESPACE}/operation/cancel`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operation_id: operationId }),
        signal: AbortSignal.timeout(2_000),
      },
    )
    if (!response.ok) return null
    const parsed = studioOperationStatusSchema.safeParse(await response.json())
    return parsed.success ? parsed.data : null
  } catch {
    // The original request still reports cancellation. The bridge also expires
    // abandoned work, so a failed best-effort cancellation cannot hang the UI.
    return null
  }
}

export type StudioResponse<T> =
  | { success: true; data: T }
  | {
      success: false
      error: string
      operationId: string
      operationStatus: StudioOperationStatus | null
    }

async function operationFailure(
  error: string,
  operationId: string,
  cancel: boolean,
): Promise<Extract<StudioResponse<never>, { success: false }>> {
  const cancelledStatus = cancel
    ? await cancelStudioOperation(operationId)
    : null
  return {
    success: false,
    error,
    operationId,
    operationStatus: cancelledStatus ?? await getStudioOperationStatus(operationId),
  }
}

/**
 * Send a request to Roblox Studio via the bridge server
 */
export async function studioRequest<T>(
  endpoint: string,
  data?: object,
  signal?: AbortSignal,
  context: StudioRequestContext = {},
): Promise<StudioResponse<T>> {
  const operationId = context.operationId || `op_${createOperationId()}`
  const activeRunId = useAgentStore.getState().runId || undefined
  const controller = new AbortController()
  const timeoutMs = Math.min(
    Math.max(context.timeoutMs ?? TIMEOUT_MS, 1_000),
    60_000,
  )
  let abortReason: "parent" | "timeout" | undefined
  const timeout = setTimeout(() => {
    abortReason = "timeout"
    controller.abort()
  }, timeoutMs)
  const abortFromRun = () => {
    abortReason = "parent"
    controller.abort()
  }

  if (signal?.aborted) {
    abortReason = "parent"
    controller.abort()
  } else {
    signal?.addEventListener("abort", abortFromRun, { once: true })
  }

  try {
    const response = await authenticatedLocalFetch(`${BRIDGE_URL}/${BRIDGE_NAMESPACE}/request`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: endpoint,
        body: data ? JSON.stringify(data) : undefined,
        operation_id: operationId,
        run_id: context.runId || activeRunId,
        owner_id: context.ownerId || "coordinator",
        step_id: context.stepId,
        capability: context.capability || inferCapability(endpoint),
        target: context.target || inferTarget(data),
      }),
      signal: controller.signal,
    })

    if (!response.ok) {
      const text = await response.text()
      try {
        const json = JSON.parse(text) as { error?: unknown }
        const error = typeof json.error === "string"
          ? json.error
          : `Error ${response.status}`
        return operationFailure(error, operationId, false)
      } catch {
        return operationFailure(
          `Studio error ${response.status}: ${text}`,
          operationId,
          false,
        )
      }
    }

    const result = await response.json() as { error?: unknown }
    if (typeof result.error === "string") {
      return operationFailure(result.error, operationId, false)
    }
    return { success: true, data: result as T }
  } catch (e) {
    if (isAbortError(e)) {
      return operationFailure(
        abortReason === "parent" || signal?.aborted
          ? "Agent run cancelled"
          : "Request timed out waiting for Studio response",
        operationId,
        true,
      )
    }
    return operationFailure(`Failed to connect: ${e}`, operationId, true)
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener("abort", abortFromRun)
  }
}

export async function getStudioOperationStatus(
  operationId: string,
): Promise<StudioOperationStatus | null> {
  try {
    const response = await authenticatedLocalFetch(
      `${BRIDGE_URL}/${BRIDGE_NAMESPACE}/operation/status`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operation_id: operationId }),
        signal: AbortSignal.timeout(2_000),
      },
    )
    if (!response.ok) return null
    const parsed = studioOperationStatusSchema.safeParse(await response.json())
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

/**
 * Check if Studio is connected to the bridge server
 */
export async function isStudioConnected(): Promise<boolean> {
  try {
    const response = await authenticatedLocalFetch(`${BRIDGE_URL}/${BRIDGE_NAMESPACE}/status`, {
      method: "GET",
      signal: AbortSignal.timeout(1000),
    })
    if (!response.ok) return false
    const status = await response.json()
    return status.connected === true
  } catch {
    return false
  }
}

/**
 * Check if the bridge server is running (even if Studio isn't connected)
 */
export async function isBridgeRunning(): Promise<boolean> {
  try {
    const response = await authenticatedLocalFetch(`${BRIDGE_URL}/${BRIDGE_NAMESPACE}/status`, {
      method: "GET",
      signal: AbortSignal.timeout(1000),
    })
    return response.ok
  } catch {
    return false
  }
}

export function notConnectedError(): string {
  return `Roblox Studio is not connected.

To use Roblox Studio tools:
1. Make sure bubbertron9001 desktop is running (it starts the bridge server)
2. Open Roblox Studio
3. Use Install Automatically or Download Paired Plugin in the desktop app
4. Enable the plugin in Studio
5. The plugin will automatically connect to bubbertron9001

You can check the connection status in the bubbertron9001 toolbar in Studio.`
}
