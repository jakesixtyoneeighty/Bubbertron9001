import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

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

const requiredGameFragments = [
  'handlers["/game/snapshot"]',
  'handlers["/game/install"]',
  'handlers["/game/verify"]',
  'handlers["/game/remove"]',
  "validateGameChangeSet(changeSet)",
  "expectedAssertionKeys",
  "table.insert(verified, assertion.assertionId)",
  "assertions = verifyGameChangeSet(changeSet)",
  'completionLabel = "Ready to playtest"',
  'handoff = "playtest-and-fix"',
  'status = #failures == 0 and "removed" or "partial"',
  "Studio changed after the removal preview",
];

for (const fragment of requiredGameFragments) {
  if (!source.includes(fragment)) {
    console.error(`Studio plugin is missing starter-game safeguard: ${fragment}`);
    process.exit(1);
  }
}

const requiredPropertyFragments = [
  "local function parsePropertyValue(instance, propertyName, rawValue)",
  'valueType == "Vector3"',
  'valueType == "BrickColor"',
  'valueType == "UDim2"',
  'valueType == "CFrame"',
  'valueType == "NumberRange"',
  "Use an exact path returned by create, search, or get_children.",
  "property = data.property",
  "type = applied.type",
];

for (const fragment of requiredPropertyFragments) {
  if (!source.includes(fragment)) {
    console.error(`Studio plugin is missing typed property support: ${fragment}`);
    process.exit(1);
  }
}

if (source.includes('string.match(value, "^%d+,%s*%d+,%s*%d+$")')) {
  console.error(
    "Studio property parsing must not regress to unsigned integer-only vectors",
  );
  process.exit(1);
}

const reviewedScripts = [
  "games/obby/scripts/obby-server.luau",
  "games/obby/scripts/obby-progress.client.luau",
];
for (const path of reviewedScripts) {
  const script = await readFile(path, "utf8");
  const hash = createHash("sha256").update(script).digest("hex");
  if (
    !source.includes(`hash = "${hash}"`)
    || !source.includes(`source = [=[${script}]=]`)
  ) {
    console.error(
      `Studio plugin does not embed the exact reviewed script: ${path}`,
    );
    process.exit(1);
  }
}

const modifyingPaths = source.match(
  /local modifyingPaths = \{(?<body>[\s\S]*?)\n\}/,
)?.groups?.body;
if (
  !modifyingPaths ||
  modifyingPaths.includes("/playtest/state") ||
  modifyingPaths.includes("/playtest/logs") ||
  modifyingPaths.includes("/game/snapshot") ||
  modifyingPaths.includes("/game/verify") ||
  !modifyingPaths.includes("/game/install") ||
  !modifyingPaths.includes("/game/remove")
) {
  console.error(
    "Only starter-game install/remove and existing mutation routes may create undo waypoints",
  );
  process.exit(1);
}

const installStart = source.indexOf('handlers["/game/install"]');
const installEnd = source.indexOf('handlers["/game/verify"]', installStart);
const installHandler = source.slice(installStart, installEnd);
const applyStart = installHandler.indexOf("local success, installError = pcall");
const verification = installHandler.indexOf(
  "assertions = verifyGameChangeSet(changeSet)",
);
const rollback = installHandler.indexOf("if not success then");
if (
  installStart < 0
  || installEnd < 0
  || applyStart < 0
  || verification < applyStart
  || rollback < verification
) {
  console.error(
    "Starter-game verification must remain inside the rollback-protected install",
  );
  process.exit(1);
}

if (source.includes("LogService:ClearOutput()")) {
  console.error("The Studio bridge must never clear the user's Output history");
  process.exit(1);
}

console.log("Studio plugin copies are identical");
console.log("Studio playtest diagnostics are bounded and playtest writes are blocked");
console.log("Studio starter-game assets, undo routes, verification, and rollback are intact");
console.log("Studio properties use type-aware parsing and actionable path errors");
