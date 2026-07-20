export interface StructuredToolError {
  message: string;
  retryable: boolean;
}

export function errorMessage(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (typeof value === "string") return value;
  if (
    value &&
    typeof value === "object" &&
    "message" in value &&
    typeof value.message === "string"
  ) {
    return value.message;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function getToolError(output: unknown): StructuredToolError | null {
  if (!output || typeof output !== "object" || !("error" in output)) {
    return null;
  }

  const raw = output.error;
  if (!raw) return null;
  if (typeof raw === "string") {
    return {
      message: raw,
      retryable:
        "retryable" in output && typeof output.retryable === "boolean"
          ? output.retryable
          : false,
    };
  }
  if (typeof raw === "object" && raw && "message" in raw) {
    return {
      message: errorMessage(raw),
      retryable:
        "retryable" in raw && typeof raw.retryable === "boolean"
          ? raw.retryable
          : false,
    };
  }
  return { message: errorMessage(raw), retryable: false };
}

export function isAbortError(value: unknown) {
  return (
    value instanceof DOMException && value.name === "AbortError"
  ) || (value instanceof Error && value.name === "AbortError");
}

