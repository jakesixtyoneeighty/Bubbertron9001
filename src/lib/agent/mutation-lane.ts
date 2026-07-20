export interface StudioMutationLeaseContext {
  runId?: string | null;
  ownerId: string;
  signal?: AbortSignal;
}

interface MutationWaiter {
  resolve: (release: () => void) => void;
  reject: (error: Error) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
}

let locked = false;
const waiters: MutationWaiter[] = [];

function cancellationError() {
  return new DOMException("Agent run cancelled", "AbortError");
}

function releaseNext() {
  while (waiters.length > 0) {
    const waiter = waiters.shift();
    if (!waiter) break;
    waiter.signal?.removeEventListener("abort", waiter.onAbort!);
    if (waiter.signal?.aborted) {
      waiter.reject(cancellationError());
      continue;
    }
    waiter.resolve(releaseMutationLease);
    return;
  }
  locked = false;
}

function releaseMutationLease() {
  releaseNext();
}

function acquireMutationLease(signal?: AbortSignal) {
  if (signal?.aborted) return Promise.reject(cancellationError());
  if (!locked) {
    locked = true;
    return Promise.resolve(releaseMutationLease);
  }

  return new Promise<() => void>((resolve, reject) => {
    const waiter: MutationWaiter = { resolve, reject, signal };
    const onAbort = () => {
      const index = waiters.indexOf(waiter);
      if (index >= 0) waiters.splice(index, 1);
      reject(cancellationError());
    };
    waiter.onAbort = onAbort;
    signal?.addEventListener("abort", onAbort, { once: true });
    waiters.push(waiter);
  });
}

/** Serialize every coordinator-owned Studio mutation while leaving reads free
 * to run concurrently. Cancellation while queued removes the lease before any
 * Studio request can start. */
export async function withStudioMutationLease<T>(
  context: StudioMutationLeaseContext,
  task: () => Promise<T>,
) {
  if (context.ownerId !== "coordinator") {
    throw new Error("Only the coordinator can acquire the Studio mutation lane");
  }
  const release = await acquireMutationLease(context.signal);
  try {
    if (context.signal?.aborted) throw cancellationError();
    return await task();
  } finally {
    release();
  }
}

export function resetStudioMutationLaneForTests() {
  locked = false;
  for (const waiter of waiters.splice(0)) {
    waiter.signal?.removeEventListener("abort", waiter.onAbort!);
    waiter.reject(cancellationError());
  }
}
