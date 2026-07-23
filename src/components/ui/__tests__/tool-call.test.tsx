import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { getActivityLabel, ToolCalls } from "@/components/ui/tool-call";

const toolCalls = [
  {
    id: "tool-1",
    name: "roblox_get_children",
    args: { path: "Workspace" },
    status: "running" as const,
  },
];

describe("ToolCalls", () => {
  it("opens while work is active and closes when the run finishes", async () => {
    const { rerender } = render(
      <ToolCalls toolCalls={toolCalls} isActive mode="build" />,
    );

    expect(
      screen.getByRole("button", { name: /working/i }).getAttribute("aria-expanded"),
    ).toBe(
      "true",
    );
    expect(screen.getByText("Get Children")).toBeTruthy();

    rerender(
      <ToolCalls
        toolCalls={[{ ...toolCalls[0], status: "complete" }]}
        isActive={false}
        mode="build"
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /worked/i }).getAttribute("aria-expanded"),
      ).toBe(
        "false",
      );
    });
    expect(screen.queryByText("Get Children")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /worked/i }));
    expect(screen.getByText("Get Children")).toBeTruthy();
  });

  it("uses task-specific active labels", () => {
    expect(getActivityLabel([
      { ...toolCalls[0], name: "web_search" },
    ], "ask", true)).toBe("Researching");
    expect(getActivityLabel([
      { ...toolCalls[0], name: "roblox_set_script" },
    ], "build", true)).toBe("Building");
    expect(getActivityLabel([], "ask", true)).toBe("Thinking");
  });
});
