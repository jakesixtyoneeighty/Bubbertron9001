import { invoke, isTauri } from "@tauri-apps/api/core";

const BRIDGE_AUTH_HEADER = "X-Bubberton9001-Secret";
const BRIDGE_TOKEN_PATTERN = /^[a-fA-F0-9]{64}$/;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

let tokenPromise: Promise<string> | null = null;

function assertProtectedLocalUrl(input: string | URL | Request) {
  const rawUrl = input instanceof Request ? input.url : input.toString();
  const url = new URL(rawUrl);
  const isBridgeRoute =
    url.port === "3001" &&
    (url.pathname.startsWith("/bubberton9001/") ||
      url.pathname.startsWith("/stud/"));
  const isProtectedOAuthRoute =
    url.port === "1455" &&
    (url.pathname === "/auth/poll" || url.pathname === "/auth/clear");

  if (
    url.protocol !== "http:" ||
    !LOCAL_HOSTS.has(url.hostname) ||
    (!isBridgeRoute && !isProtectedOAuthRoute)
  ) {
    throw new Error("Refusing to send bridge credentials to an untrusted URL");
  }
}

async function getBridgeToken(): Promise<string | null> {
  // Browser development and unit tests keep using the normal fetch path. A
  // packaged Tauri WebView receives the token through the native boundary.
  if (!isTauri()) return null;

  tokenPromise ??= invoke<string>("get_bridge_auth_token").then((token) => {
    if (!BRIDGE_TOKEN_PATTERN.test(token)) {
      throw new Error("The native bridge returned an invalid auth token");
    }
    return token;
  });

  try {
    return await tokenPromise;
  } catch (error) {
    tokenPromise = null;
    throw error;
  }
}

export async function authenticatedLocalFetch(
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  assertProtectedLocalUrl(input);

  const headers = new Headers(
    input instanceof Request ? input.headers : undefined,
  );
  new Headers(init?.headers).forEach((value, key) => {
    headers.set(key, value);
  });

  const token = await getBridgeToken();
  if (token) headers.set(BRIDGE_AUTH_HEADER, token);

  // Keep loopback traffic in the WebView's normal fetch implementation. This
  // preserves browser development behavior and avoids granting the native HTTP
  // plugin access to the pairing token or local bridge ports.
  return globalThis.fetch(input, { ...init, headers });
}

export const __localBridgeTestUtils = {
  authHeader: BRIDGE_AUTH_HEADER,
  reset() {
    tokenPromise = null;
  },
};
