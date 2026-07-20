import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  invokeMock,
  isBridgeRunningMock,
  isStudioConnectedMock,
  isAuthenticatedMock,
} = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  isBridgeRunningMock: vi.fn(),
  isStudioConnectedMock: vi.fn(),
  isAuthenticatedMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

vi.mock("@/lib/roblox/client", () => ({
  isBridgeRunning: isBridgeRunningMock,
  isStudioConnected: isStudioConnectedMock,
}));

vi.mock("@/lib/auth/codex", () => ({
  isAuthenticated: isAuthenticatedMock,
}));

import { usePrereqStore } from "@/stores/prereq";

function mockNativeChecks(pluginInstalled = true) {
  invokeMock.mockImplementation(async (command: string) => {
    if (command === "check_roblox_studio_installed") return true;
    if (command === "check_plugin_installed") {
      return {
        installed: pluginInstalled,
        is_current_version: pluginInstalled,
      };
    }
    throw new Error(`Unexpected command: ${command}`);
  });
}

describe("guided setup readiness", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    mockNativeChecks();
    isBridgeRunningMock.mockResolvedValue(true);
    isStudioConnectedMock.mockResolvedValue(false);
    isAuthenticatedMock.mockReturnValue(true);
    usePrereqStore.setState({
      isChecking: false,
      hasChecked: false,
      showWizard: false,
      setupCompleted: false,
    });
  });

  it("opens for a new user even when only the Studio connection remains", async () => {
    await usePrereqStore.getState().runAllChecks();

    const state = usePrereqStore.getState();
    expect(state.showWizard).toBe(true);
    expect(
      state.checks.find((check) => check.id === "studio-connection")?.status,
    ).toBe("warning");
  });

  it("stays out of the way after setup when required checks still pass", async () => {
    usePrereqStore.getState().completeSetup();
    await usePrereqStore.getState().runAllChecks();

    expect(usePrereqStore.getState().showWizard).toBe(false);
  });

  it("reopens for a completed user when the paired plugin is missing", async () => {
    usePrereqStore.getState().completeSetup();
    mockNativeChecks(false);
    await usePrereqStore.getState().runAllChecks();

    expect(usePrereqStore.getState().showWizard).toBe(true);
    expect(
      usePrereqStore
        .getState()
        .checks.find((check) => check.id === "bubbertron9001-plugin")?.status,
    ).toBe("failed");
  });

  it("can always be reopened from Settings", async () => {
    usePrereqStore.getState().completeSetup();
    usePrereqStore.getState().openWizard();

    expect(usePrereqStore.getState().showWizard).toBe(true);
    await vi.waitFor(() => {
      expect(usePrereqStore.getState().isChecking).toBe(false);
    });
  });
});
