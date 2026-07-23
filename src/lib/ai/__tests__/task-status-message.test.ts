import { describe, expect, it } from "vitest";
import {
  completedTaskMessage,
  failedTaskMessage,
} from "../task-status-message";

describe("task status messages", () => {
  it("shows the completion summary and verification", () => {
    expect(
      completedTaskMessage({
        summary: "Added and configured the checkpoint system.",
        verification: "Read back all checkpoint scripts and properties.",
      }),
    ).toBe(
      "**Task completed**\n\nAdded and configured the checkpoint system.\n\n**Verified:** Read back all checkpoint scripts and properties.",
    );
  });

  it("uses clear fallbacks for empty terminal results", () => {
    expect(completedTaskMessage({})).toContain("finished successfully");
    expect(failedTaskMessage(" ")).toContain(
      "stopped before it could finish",
    );
  });
});
