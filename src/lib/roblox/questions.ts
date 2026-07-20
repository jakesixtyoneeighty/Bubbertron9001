interface QuestionOption {
  label: string;
  value?: string;
  imageUrl?: string;
  description?: string;
}

export interface AskUserQuestion {
  question: string;
  options?: (string | QuestionOption)[];
  type: "single" | "multi" | "text";
}

type AskUserHandler = (
  questions: AskUserQuestion[]
) => Promise<(string | string[])[]>;

let askUserHandler: AskUserHandler | null = null;
let cancelActiveQuestion: ((reason: string) => void) | null = null;

export const setAskUserHandler = (handler: AskUserHandler | null) => {
  askUserHandler = handler;
};

export const cancelPendingQuestions = (reason = "Question cancelled") => {
  cancelActiveQuestion?.(reason);
  cancelActiveQuestion = null;
};

export async function askQuestions(
  questions: AskUserQuestion[],
  signal?: AbortSignal
) {
  const handler = askUserHandler;
  if (!handler) {
    throw new Error("Question handler not initialized");
  }
  if (cancelActiveQuestion) {
    throw new Error("Another question is already waiting for an answer");
  }
  if (signal?.aborted) {
    throw new DOMException("Agent run cancelled", "AbortError");
  }

  return new Promise<(string | string[])[]>((resolve, reject) => {
    let settled = false;
    let timeout: ReturnType<typeof globalThis.setTimeout>;

    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      if (cancelActiveQuestion === cancel) {
        cancelActiveQuestion = null;
      }
      callback();
    };
    const cancel = (reason: string) => {
      finish(() => reject(new DOMException(reason, "AbortError")));
    };
    const onAbort = () => cancel("Agent run cancelled");

    timeout = globalThis.setTimeout(
      () =>
        finish(() =>
          reject(new Error("Question timed out after 10 minutes"))
        ),
      10 * 60 * 1000
    );
    cancelActiveQuestion = cancel;
    signal?.addEventListener("abort", onAbort, { once: true });

    handler(questions).then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error))
    );
  });
}
