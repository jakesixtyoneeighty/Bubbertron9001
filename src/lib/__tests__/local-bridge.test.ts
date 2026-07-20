import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const { fetchMock, invokeMock, isTauriMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  invokeMock: vi.fn(),
  isTauriMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
  isTauri: isTauriMock,
}));

import {
  __localBridgeTestUtils,
  authenticatedLocalFetch,
} from "@/lib/local-bridge";

const TOKEN = "a".repeat(64);

describe("authenticated local bridge fetch", () => {
  beforeEach(() => {
    __localBridgeTestUtils.reset();
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(TOKEN);
    isTauriMock.mockReset();
    isTauriMock.mockReturnValue(true);
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it("adds the native token to protected local requests and caches it", async () => {
    await authenticatedLocalFetch(
      "http://localhost:3001/bubberton9001/status",
    );
    await authenticatedLocalFetch("http://localhost:1455/auth/poll");

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("get_bridge_auth_token");
    for (const [, init] of fetchMock.mock.calls) {
      expect(
        new Headers(init?.headers).get(__localBridgeTestUtils.authHeader),
      ).toBe(TOKEN);
    }
  });

  it("never sends the token to a non-loopback or unprotected URL", async () => {
    await expect(
      authenticatedLocalFetch("https://example.com/collect"),
    ).rejects.toThrow("untrusted URL");
    await expect(
      authenticatedLocalFetch("http://localhost:1455/auth/callback"),
    ).rejects.toThrow("untrusted URL");

    expect(invokeMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("preserves browser test fetch behavior without exposing a token", async () => {
    isTauriMock.mockReturnValue(false);

    await authenticatedLocalFetch(
      "http://localhost:3001/bubberton9001/status",
      { headers: { Accept: "application/json" } },
    );

    expect(invokeMock).not.toHaveBeenCalled();
    const headers = new Headers(fetchMock.mock.calls[0][1]?.headers);
    expect(headers.get("Accept")).toBe("application/json");
    expect(headers.has(__localBridgeTestUtils.authHeader)).toBe(false);
  });
});
