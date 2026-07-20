import { fetch as tauriFetch } from "@tauri-apps/plugin-http";

function isTauriRuntime() {
  return (
    typeof window !== "undefined" &&
    "__TAURI_INTERNALS__" in window
  );
}

export async function appFetch(
  input: string | URL | Request,
  init?: RequestInit
): Promise<Response> {
  if (isTauriRuntime()) {
    return tauriFetch(input, init);
  }
  return globalThis.fetch(input, init);
}

