import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { UserPrompt } from "@/components/chat/UserPrompt";

describe("UserPrompt", () => {
  it("edits and reruns only after the prompt changes", () => {
    const onEditAndRerun = vi.fn();
    render(
      <UserPrompt
        content="Build a red obby"
        onEditAndRerun={onEditAndRerun}
      />,
    );

    fireEvent.click(screen.getByRole("button", {
      name: "Edit and rerun prompt",
    }));

    const rerunButton = screen.getByRole("button", { name: "Save & rerun" });
    expect((rerunButton as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByRole("textbox", { name: "Edit prompt" }), {
      target: { value: "Build a blue obby" },
    });
    fireEvent.click(rerunButton);

    expect(onEditAndRerun).toHaveBeenCalledWith("Build a blue obby");
  });

  it("copies the original prompt", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    render(
      <UserPrompt
        content="Build a red obby"
        onEditAndRerun={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Copy prompt" }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("Build a red obby");
    });
  });
});
