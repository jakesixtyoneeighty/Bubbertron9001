import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  GameBuildDraft,
  GameInstallResult,
  GameRemovalResult,
  PreparedStudioGameBuild,
  RemovalPlan,
} from "@/lib/games";

const gameService = vi.hoisted(() => ({
  getCatalog: vi.fn(() => [{
    id: "obby-starter",
    version: "1.0.0",
    name: "Obby Starter",
  }]),
  createDraft: vi.fn(),
  prepareAgainstStudio: vi.fn(),
  install: vi.fn(),
  verify: vi.fn(),
  planRemoval: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("@/lib/games", () => ({
  gameBuilderService: gameService,
}));

import { OneClickGamesDialog } from "./OneClickGamesDialog";

const draft: GameBuildDraft = {
  templateId: "obby-starter",
  templateVersion: "1.0.0",
  options: {
    stages: 10,
    difficulty: "standard",
    visualStyle: "bright",
  },
  context: {
    runId: "one-click-test",
    agentId: "coordinator",
    planId: "one-click-test-plan",
    stepId: "install-starter",
  },
  generationId: "one-click-test-generation",
};

function preparedBuild(
  status: PreparedStudioGameBuild["preflight"]["status"] = "ready",
): PreparedStudioGameBuild {
  const canInstall = status === "ready" || status === "resume_available";
  return {
    draft,
    snapshot: {
      schemaVersion: "b9.studio-snapshot/v1",
      revision: "studio-revision-1",
      completePaths: [],
      contentHashes: {},
      instances: [],
    },
    changeSet: {
      operations: [{ operationId: "operation-1", type: "create_instance" }],
      preview: {
        title: "Obby Starter v1.0.0",
        summary: "Adds a self-contained checkpoint obby.",
        additions: { instances: 24, properties: 51, scripts: 2 },
        optionLabels: ["10 stages", "standard difficulty", "bright style"],
        claimedPaths: [
          "game.Workspace.B9_Obby",
          "game.ServerScriptService.B9_ObbyServer",
          "game.StarterGui.B9_ObbyProgress",
        ],
        conflicts: [],
        fingerprint: "a".repeat(64),
        completionLabel: "Ready to playtest",
        handoff: "playtest-and-fix",
      },
      cleanup: {
        paths: ["game.Workspace.B9_Obby"],
      },
    },
    preflight: {
      status,
      canInstall,
      retryIsNoOp: status === "already_installed",
      conflicts: status === "resume_available"
        ? [{
            code: "partial_generation",
            message: "An unfinished starter was found.",
          }]
        : [],
      remainingOperationIds: canInstall ? ["operation-1"] : [],
      preview: {
        title: "Obby Starter v1.0.0",
        summary: "Adds a self-contained checkpoint obby.",
        additions: { instances: 24, properties: 51, scripts: 2 },
        optionLabels: ["10 stages", "standard difficulty", "bright style"],
        claimedPaths: [
          "game.Workspace.B9_Obby",
          "game.ServerScriptService.B9_ObbyServer",
          "game.StarterGui.B9_ObbyProgress",
        ],
        conflicts: [],
        fingerprint: "a".repeat(64),
        completionLabel: "Ready to playtest",
        handoff: "playtest-and-fix",
      },
    },
  } as unknown as PreparedStudioGameBuild;
}

const removalPlan: RemovalPlan = {
  generationId: "one-click-test-generation",
  paths: [
    "game.Workspace.B9_Obby.Stage1",
    "game.Workspace.B9_Obby",
  ],
  skippedMissingPaths: [],
  preservedParentPaths: [],
  requireOwnershipMatch: true,
  preserveUnknownDescendants: true,
};

describe("OneClickGamesDialog", () => {
  beforeEach(() => {
    gameService.createDraft.mockReturnValue(draft);
    gameService.planRemoval.mockResolvedValue(removalPlan);
  });

  it("collects the Obby options before checking Studio", async () => {
    gameService.prepareAgainstStudio.mockResolvedValue(preparedBuild());
    render(
      <OneClickGamesDialog open onOpenChange={vi.fn()} studioConnected />,
    );

    fireEvent.click(screen.getByRole("button", { name: "15" }));
    fireEvent.click(screen.getByRole("button", { name: "Challenging" }));
    fireEvent.click(screen.getByRole("button", { name: "Nature" }));
    fireEvent.click(screen.getByRole("button", { name: "Review changes" }));

    await screen.findByText("Studio locations");
    expect(gameService.createDraft).toHaveBeenCalledWith({
      templateId: "obby-starter",
      options: {
        stages: 15,
        difficulty: "challenging",
        visualStyle: "nature",
      },
    });
    expect(screen.getByText("24")).toBeTruthy();
    expect(screen.getByText("51")).toBeTruthy();
    expect(screen.getByText("game.Workspace.B9_Obby")).toBeTruthy();
  });

  it("binds the single Generate approval to the reviewed fingerprint", async () => {
    const onOpenChange = vi.fn();
    const onPlaytestFix = vi.fn();
    const prepared = preparedBuild();
    const postflight = preparedBuild("already_installed");
    const installed: GameInstallResult = {
      status: "installed",
      prepared,
      receipt: {
        status: "installed",
        generationId: "one-click-test-generation",
        appliedOperationIds: ["operation-1", "operation-2"],
        verifiedAssertionIds: ["assertion-1"],
        verified: true,
        completionLabel: "Ready to playtest",
        handoff: "playtest-and-fix",
      },
      verification: {
        verified: true,
        verifiedAssertionIds: ["assertion-1", "assertion-2"],
      },
      readback: postflight.snapshot,
      postflight,
    };
    gameService.prepareAgainstStudio.mockResolvedValue(prepared);
    gameService.install.mockResolvedValue(installed);

    render(
      <OneClickGamesDialog
        open
        onOpenChange={onOpenChange}
        studioConnected
        onPlaytestFix={onPlaytestFix}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Review changes" }));
    await screen.findByRole("button", { name: "Generate game" });
    fireEvent.click(screen.getByRole("button", { name: "Generate game" }));

    await screen.findByText("Ready to playtest");
    expect(gameService.install).toHaveBeenCalledTimes(1);
    expect(gameService.install.mock.calls[0]?.[0]).toEqual(draft);
    expect(gameService.install.mock.calls[0]?.[1]).toBe("a".repeat(64));
    expect(screen.getAllByText("2")).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "Playtest & Fix" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onPlaytestFix).toHaveBeenCalledTimes(1);
  });

  it("shows Stop and explains leased work that finishes after cancellation", async () => {
    const prepared = preparedBuild();
    const recovered = preparedBuild("already_installed");
    let releaseLateCompletion!: () => void;
    let releaseReadback!: () => void;
    const lateCompletion = new Promise<void>((resolve) => {
      releaseLateCompletion = resolve;
    });
    const readback = new Promise<void>((resolve) => {
      releaseReadback = resolve;
    });
    gameService.prepareAgainstStudio.mockResolvedValue(prepared);
    gameService.install.mockImplementation(
      async (_draft, _fingerprint, signal, onProgress) => {
        const operationId = "game-install-stop-test";
        onProgress?.({
          action: "install",
          phase: "starting",
          operationId,
          message: "Studio is applying the approved starter game.",
        });
        await new Promise<void>((resolve) => {
          signal?.addEventListener("abort", () => resolve(), { once: true });
        });
        onProgress?.({
          action: "install",
          phase: "may_complete",
          operationId,
          message: "Studio had already started and may still finish.",
        });
        await lateCompletion;
        const operationStatus = {
          operation_id: operationId,
          request_id: "request-install-stop-test",
          status: "completed" as const,
          leased: true,
          may_complete: false,
          completed_after_cancel: true,
        };
        onProgress?.({
          action: "install",
          phase: "late_completed",
          operationId,
          operationStatus,
          message: "Studio finished after Stop.",
        });
        await readback;
        return {
          status: "partial_failure" as const,
          phase: "install" as const,
          error: "Agent run cancelled",
          prepared,
          readback: recovered.snapshot,
          recovery: recovered,
          reconciliation: {
            operationId,
            operationStatus,
            outcome: "late_completed" as const,
            readbackComplete: true as const,
          },
        };
      },
    );

    render(
      <OneClickGamesDialog open onOpenChange={vi.fn()} studioConnected />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Review changes" }));
    await screen.findByRole("button", { name: "Generate game" });
    fireEvent.click(screen.getByRole("button", { name: "Generate game" }));

    const stop = await screen.findByRole("button", { name: "Stop" });
    fireEvent.click(stop);
    await screen.findByText("Studio may still finish");
    expect((screen.getByRole("button", {
      name: "Stop requested",
    }) as HTMLButtonElement).disabled).toBe(true);

    releaseLateCompletion();
    await screen.findByText("Studio finished after Stop");
    releaseReadback();
    await screen.findByText(
      "Studio finished after you pressed Stop. B9 waited for it, then checked the place again.",
    );
  });

  it("shows recovery as Resume and requires removal confirmation", async () => {
    const resumable = preparedBuild("resume_available");
    const installed = preparedBuild("already_installed");
    gameService.prepareAgainstStudio.mockResolvedValue(resumable);
    gameService.install.mockResolvedValue({
      status: "already_installed",
      prepared: installed,
      verification: { verified: true, verifiedAssertionIds: ["assertion-1"] },
      readback: installed.snapshot,
      postflight: installed,
    } satisfies GameInstallResult);
    gameService.remove.mockResolvedValue({
      status: "removed",
      prepared: installed,
      plan: removalPlan,
      receipt: {
        status: "removed",
        generationId: "one-click-test-generation",
        removed: removalPlan.paths,
        preserved: [],
        skipped: [],
        failures: [],
        verified: true,
      },
      readback: installed.snapshot,
      remainingOwnedPaths: [],
    } satisfies GameRemovalResult);

    render(
      <OneClickGamesDialog open onOpenChange={vi.fn()} studioConnected />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Review changes" }));
    await screen.findByRole("button", { name: "Resume setup" });
    fireEvent.click(screen.getByRole("button", { name: "Resume setup" }));
    await screen.findByText("Ready to playtest");

    fireEvent.click(screen.getByRole("button", { name: "Remove generated game" }));
    await screen.findByText("Remove generated game?");
    expect(screen.getByText("game.Workspace.B9_Obby.Stage1")).toBeTruthy();
    expect(gameService.remove).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Remove generated game" }));
    await screen.findByText("Generated game removed");
    await waitFor(() => expect(gameService.remove).toHaveBeenCalledTimes(1));
  });

  it("keeps Stop visible while removal is reconciled and read back", async () => {
    const installed = preparedBuild("already_installed");
    gameService.prepareAgainstStudio.mockResolvedValue(installed);
    gameService.remove.mockImplementation(async (_draft, signal, onProgress) => {
      const operationId = "game-remove-stop-test";
      onProgress?.({
        action: "remove",
        phase: "starting",
        operationId,
        message: "Studio is removing the generated starter game.",
      });
      await new Promise<void>((resolve) => {
        signal?.addEventListener("abort", () => resolve(), { once: true });
      });
      const operationStatus = {
        operation_id: operationId,
        request_id: "request-remove-stop-test",
        status: "cancelled" as const,
        leased: false,
        may_complete: false,
        completed_after_cancel: false,
      };
      onProgress?.({
        action: "remove",
        phase: "readback",
        operationId,
        operationStatus,
        message: "B9 checked Studio after Stop.",
      });
      return {
        status: "partial_failure" as const,
        phase: "remove" as const,
        error: "Agent run cancelled",
        prepared: installed,
        plan: removalPlan,
        readback: installed.snapshot,
        recovery: installed,
        reconciliation: {
          operationId,
          operationStatus,
          outcome: "cancelled" as const,
          readbackComplete: true as const,
        },
      };
    });

    render(
      <OneClickGamesDialog open onOpenChange={vi.fn()} studioConnected />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Review changes" }));
    await screen.findByRole("button", { name: "Remove generated game" });
    fireEvent.click(screen.getByRole("button", { name: "Remove generated game" }));
    await screen.findByText("Remove generated game?");
    fireEvent.click(screen.getByRole("button", { name: "Remove generated game" }));

    const stop = await screen.findByRole("button", { name: "Stop" });
    fireEvent.click(stop);
    await screen.findByText("Removal needs attention");
    expect(screen.getByText(
      "Agent run cancelled B9 waited for the operation to settle and checked Studio again.",
    )).toBeTruthy();
  });
});
