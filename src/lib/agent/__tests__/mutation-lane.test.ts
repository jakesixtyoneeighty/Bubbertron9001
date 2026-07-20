import { afterEach, describe, expect, it, vi } from "vitest";
import {
  resetStudioMutationLaneForTests,
  withStudioMutationLease,
} from "../mutation-lane";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("Studio mutation lane", () => {
  afterEach(() => resetStudioMutationLaneForTests());

  it("runs only one coordinator mutation at a time", async () => {
    const firstGate = deferred();
    const order: string[] = [];
    const first = withStudioMutationLease(
      { runId: "run_one", ownerId: "coordinator" },
      async () => {
        order.push("first-start");
        await firstGate.promise;
        order.push("first-end");
      },
    );
    const second = withStudioMutationLease(
      { runId: "run_one", ownerId: "coordinator" },
      async () => {
        order.push("second-start");
        order.push("second-end");
      },
    );

    await vi.waitFor(() => expect(order).toEqual(["first-start"]));
    firstGate.resolve();
    await Promise.all([first, second]);
    expect(order).toEqual([
      "first-start",
      "first-end",
      "second-start",
      "second-end",
    ]);
  });

  it("removes a cancelled queued mutation before it can start", async () => {
    const firstGate = deferred();
    const controller = new AbortController();
    let cancelledTaskStarted = false;
    const first = withStudioMutationLease(
      { ownerId: "coordinator" },
      async () => firstGate.promise,
    );
    const cancelled = withStudioMutationLease(
      { ownerId: "coordinator", signal: controller.signal },
      async () => {
        cancelledTaskStarted = true;
      },
    );

    controller.abort();
    await expect(cancelled).rejects.toMatchObject({ name: "AbortError" });
    firstGate.resolve();
    await first;
    expect(cancelledTaskStarted).toBe(false);
  });

  it("rejects non-coordinator mutation ownership", async () => {
    await expect(
      withStudioMutationLease(
        { runId: "run_one", ownerId: "explorer" },
        async () => undefined,
      ),
    ).rejects.toThrow("Only the coordinator");
  });
});
