import { invoke, isTauri } from "@tauri-apps/api/core";

export const STUDIO_PLUGIN_FILENAME =
  "bubbertron9001-bridge.server.lua";

const PAIRING_SECRET_PLACEHOLDER =
  "__bubbertron9001_PAIRING_SECRET__";
const PAIRING_ASSIGNMENT =
  /local PAIRING_SECRET = "[a-fA-F0-9]{64}"/g;

export interface PairedPluginSource {
  filename: string;
  source: string;
}

function validatePairedPluginSource(
  value: unknown,
): PairedPluginSource {
  if (
    !value ||
    typeof value !== "object" ||
    !("filename" in value) ||
    !("source" in value)
  ) {
    throw new Error("The desktop app returned an invalid plugin download");
  }

  const { filename, source } = value as Record<string, unknown>;
  if (
    filename !== STUDIO_PLUGIN_FILENAME ||
    typeof source !== "string" ||
    source.includes(PAIRING_SECRET_PLACEHOLDER)
  ) {
    throw new Error("The desktop app returned an unpaired plugin template");
  }

  const assignments = source.match(PAIRING_ASSIGNMENT) || [];
  if (assignments.length !== 1) {
    throw new Error(
      "The downloaded plugin does not contain exactly one pairing secret",
    );
  }

  return { filename, source };
}

export async function getPairedPluginSource(): Promise<PairedPluginSource> {
  if (!isTauri()) {
    throw new Error(
      "Paired plugin downloads are only available in the bubbertron9001 desktop app. Do not copy the raw repository template.",
    );
  }

  return validatePairedPluginSource(
    await invoke<unknown>("get_paired_plugin_source"),
  );
}

export async function downloadPairedStudioPlugin() {
  const plugin = await getPairedPluginSource();
  const blob = new Blob([plugin.source], {
    type: "text/plain;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);

  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = plugin.filename;
    link.click();
  } finally {
    URL.revokeObjectURL(url);
  }

  return plugin.filename;
}

export const __pluginDownloadTestUtils = {
  pairingPlaceholder: PAIRING_SECRET_PLACEHOLDER,
};
