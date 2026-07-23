import { describe, expect, it, vi } from "vitest"
import { consumeCodexResponseWithRetry } from "../codex-chat"

const encoder = new TextEncoder()
const noDelay = async () => {}

function sse(event: Record<string, unknown>) {
  return `data: ${JSON.stringify(event)}\n\n`
}

function responseStream(
  chunks: string[],
  terminalError?: Error,
) {
  let index = 0
  return new Response(new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(encoder.encode(chunks[index]))
        index += 1
        return
      }
      if (terminalError) {
        controller.error(terminalError)
        return
      }
      controller.close()
    },
  }))
}

function completedToolCallResponse() {
  return responseStream([
    sse({
      type: "response.output_item.added",
      item: {
        type: "function_call",
        call_id: "call_2",
        name: "roblox_get_properties",
      },
    }),
    sse({
      type: "response.function_call_arguments.delta",
      call_id: "call_2",
      delta: '{"path":"game.Workspace.Part"}',
    }),
    sse({
      type: "response.output_item.done",
      item: {
        type: "function_call",
        call_id: "call_2",
        name: "roblox_get_properties",
        arguments: '{"path":"game.Workspace.Part"}',
      },
    }),
    "data: [DONE]\n\n",
  ])
}

describe("Codex response stream retry", () => {
  it("retries when Tauri rejects before returning the response", async () => {
    const createResponse = vi
      .fn<() => Promise<Response>>()
      .mockRejectedValueOnce(new Error("error decoding response body"))
      .mockResolvedValueOnce(completedToolCallResponse())

    await expect(
      consumeCodexResponseWithRetry(createResponse, {}, noDelay)
    ).resolves.toMatchObject({
      toolCalls: [{ name: "roblox_get_properties" }],
    })
    expect(createResponse).toHaveBeenCalledTimes(2)
  })

  it("retries a body decode failure before any effect is exposed", async () => {
    const createResponse = vi
      .fn<() => Promise<Response>>()
      .mockResolvedValueOnce(responseStream([
        sse({
          type: "response.output_item.added",
          item: {
            type: "function_call",
            call_id: "call_1",
            name: "roblox_set_property",
          },
        }),
      ], new Error("error decoding response body")))
      .mockResolvedValueOnce(completedToolCallResponse())

    await expect(
      consumeCodexResponseWithRetry(createResponse, {}, noDelay)
    ).resolves.toEqual({
      text: "",
      webSearchUsed: false,
      toolCalls: [{
        id: "call_2",
        name: "roblox_get_properties",
        arguments: '{"path":"game.Workspace.Part"}',
      }],
    })
    expect(createResponse).toHaveBeenCalledTimes(2)
  })

  it("does not retry after visible text has already streamed", async () => {
    const onToken = vi.fn()
    const createResponse = vi.fn(async () => responseStream([
      sse({
        type: "response.output_text.delta",
        delta: "Building now",
      }),
    ], new Error("error decoding response body")))

    await expect(
      consumeCodexResponseWithRetry(
        createResponse,
        { onToken },
        noDelay,
      )
    ).rejects.toThrow("error decoding response body")
    expect(createResponse).toHaveBeenCalledTimes(1)
    expect(onToken).toHaveBeenCalledWith("Building now")
  })

  it("retries deferred build output without exposing the failed attempt", async () => {
    const onToken = vi.fn()
    const createResponse = vi
      .fn<() => Promise<Response>>()
      .mockResolvedValueOnce(responseStream([
        sse({
          type: "response.output_text.delta",
          delta: "Partial response",
        }),
      ], new Error("error decoding response body")))
      .mockResolvedValueOnce(responseStream([
        sse({
          type: "response.output_text.delta",
          delta: "Complete response",
        }),
        "data: [DONE]\n\n",
      ]))

    await expect(
      consumeCodexResponseWithRetry(
        createResponse,
        { onToken },
        noDelay,
        true,
      )
    ).resolves.toMatchObject({ text: "Complete response" })
    expect(createResponse).toHaveBeenCalledTimes(2)
    expect(onToken).toHaveBeenCalledTimes(1)
    expect(onToken).toHaveBeenCalledWith("Complete response")
  })

  it("keeps the retry budget bounded when decoding repeatedly fails", async () => {
    const createResponse = vi.fn(async () => responseStream(
      [],
      new Error("error decoding response body"),
    ))

    await expect(
      consumeCodexResponseWithRetry(createResponse, {}, noDelay)
    ).rejects.toThrow(
      "ChatGPT response stream was interrupted after 3 attempts"
    )
    expect(createResponse).toHaveBeenCalledTimes(3)
  })
})
