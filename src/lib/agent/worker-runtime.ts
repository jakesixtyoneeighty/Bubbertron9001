import type { WorkerExecutor } from "./subagents";

const executors = new Map<string, WorkerExecutor>();

export function registerWorkerExecutor(
  runId: string,
  executor: WorkerExecutor,
) {
  executors.set(runId, executor);
  return () => {
    if (executors.get(runId) === executor) executors.delete(runId);
  };
}

export function getWorkerExecutor(runId: string) {
  return executors.get(runId);
}

export function clearWorkerExecutors() {
  executors.clear();
}
