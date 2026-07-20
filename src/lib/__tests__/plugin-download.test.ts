import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const { invokeMock, isTauriMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  isTauriMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
  isTauri: isTauriMock,
}));

import {
  STUDIO_PLUGIN_FILENAME,
  downloadPairedStudioPlugin,
  getPairedPluginSource,
} from "@/lib/plugin-download";

const SECRET = "a".repeat(64);
const PAIRED_SOURCE = `local PAIRING_SECRET = "${SECRET}"\nprint("paired")`;
const originalCreateObjectUrl = Object.getOwnPropertyDescriptor(
  URL,
  "createObjectURL",
);
const originalRevokeObjectUrl = Object.getOwnPropertyDescriptor(
  URL,
  "revokeObjectURL",
);

describe("paired Studio plugin download", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    isTauriMock.mockReset();
    isTauriMock.mockReturnValue(true);
    invokeMock.mockResolvedValue({
      filename: STUDIO_PLUGIN_FILENAME,
      source: PAIRED_SOURCE,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const [key, descriptor] of [
      ["createObjectURL", originalCreateObjectUrl],
      ["revokeObjectURL", originalRevokeObjectUrl],
    ] as const) {
      if (descriptor) {
        Object.defineProperty(URL, key, descriptor);
      } else {
        Reflect.deleteProperty(URL, key);
      }
    }
  });

  it("accepts only the provisioned source returned by Tauri", async () => {
    await expect(getPairedPluginSource()).resolves.toEqual({
      filename: STUDIO_PLUGIN_FILENAME,
      source: PAIRED_SOURCE,
    });
    expect(invokeMock).toHaveBeenCalledWith(
      "get_paired_plugin_source",
    );
  });

  it("rejects raw templates and duplicate pairing assignments", async () => {
    invokeMock.mockResolvedValueOnce({
      filename: STUDIO_PLUGIN_FILENAME,
      source:
        'local PAIRING_SECRET = "__BUBBERTON9001_PAIRING_SECRET__"',
    });
    await expect(getPairedPluginSource()).rejects.toThrow(
      "unpaired plugin template",
    );

    invokeMock.mockResolvedValueOnce({
      filename: STUDIO_PLUGIN_FILENAME,
      source: `${PAIRED_SOURCE}\nlocal PAIRING_SECRET = "${"b".repeat(64)}"`,
    });
    await expect(getPairedPluginSource()).rejects.toThrow(
      "exactly one pairing secret",
    );
  });

  it("never falls back to the raw public template in a browser", async () => {
    isTauriMock.mockReturnValue(false);

    await expect(getPairedPluginSource()).rejects.toThrow(
      "only available in the Bubberton9001 desktop app",
    );
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("downloads the validated source with the expected filename", async () => {
    const createObjectURL = vi
      .fn()
      .mockReturnValue("blob:paired-plugin");
    const revokeObjectURL = vi.fn();
    Object.defineProperties(URL, {
      createObjectURL: {
        configurable: true,
        value: createObjectURL,
      },
      revokeObjectURL: {
        configurable: true,
        value: revokeObjectURL,
      },
    });

    const originalCreateElement = document.createElement.bind(document);
    let downloadedLink = originalCreateElement(
      "a",
    ) as HTMLAnchorElement;
    vi.spyOn(document, "createElement").mockImplementation(
      (tagName: string, options?: ElementCreationOptions) => {
        const element = originalCreateElement(tagName, options);
        if (tagName === "a") {
          downloadedLink = element as HTMLAnchorElement;
          vi.spyOn(downloadedLink, "click").mockImplementation(() => {});
        }
        return element;
      },
    );

    await expect(downloadPairedStudioPlugin()).resolves.toBe(
      STUDIO_PLUGIN_FILENAME,
    );
    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(downloadedLink.download).toBe(STUDIO_PLUGIN_FILENAME);
    expect(downloadedLink.href).toBe("blob:paired-plugin");
    expect(downloadedLink.click).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith(
      "blob:paired-plugin",
    );
  });
});
