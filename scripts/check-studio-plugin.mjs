import { readFile } from "node:fs/promises";

const canonicalPath = "studio-plugin/bubbertron9001-bridge.server.lua";
const publicPath = "public/studio-plugin/bubbertron9001-bridge.server.lua";

const [canonical, publicCopy] = await Promise.all([
  readFile(canonicalPath),
  readFile(publicPath),
]);

if (!canonical.equals(publicCopy)) {
  console.error(
    `Studio plugin copies differ: ${canonicalPath} and ${publicPath}`,
  );
  process.exit(1);
}

const source = canonical.toString("utf8");
const requiredPlaytestFragments = [
  'handlers["/playtest/state"]',
  'handlers["/playtest/logs"]',
  "RunService.RunState.Name",
  "LogService:GetLogHistory()",
  "LogService.MessageOut:Connect",
  "MAX_RECENT_LOG_MESSAGE_BYTES = 4 * 1024",
  "MAX_RECENT_LOG_RESPONSE_BYTES = 64 * 1024",
  "bridgeMessagesExcluded = true",
  '"[bubberton9001-bridge]"',
  "logMessageConnection:Disconnect()",
  "isHttpRequestsDisabledError",
  "Allow HTTP Requests in Experience Settings",
  "isModifying and not RunService:IsEdit()",
  "Playtest changes are discarded when testing ends.",
];

for (const fragment of requiredPlaytestFragments) {
  if (!source.includes(fragment)) {
    console.error(`Studio plugin is missing playtest safeguard: ${fragment}`);
    process.exit(1);
  }
}

const modifyingPaths = source.match(
  /local modifyingPaths = \{(?<body>[\s\S]*?)\n\}/,
)?.groups?.body;
if (
  !modifyingPaths ||
  modifyingPaths.includes("/playtest/state") ||
  modifyingPaths.includes("/playtest/logs")
) {
  console.error("Playtest diagnostics must remain read-only bridge handlers");
  process.exit(1);
}

if (source.includes("LogService:ClearOutput()")) {
  console.error("The Studio bridge must never clear the user's Output history");
  process.exit(1);
}

console.log("Studio plugin copies are identical");
console.log("Studio playtest diagnostics are bounded and playtest writes are blocked");
