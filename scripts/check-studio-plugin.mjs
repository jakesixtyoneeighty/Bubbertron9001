import { readFile } from "node:fs/promises";

const canonicalPath = "studio-plugin/bubberton9001-bridge.server.lua";
const publicPath = "public/studio-plugin/bubberton9001-bridge.server.lua";

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

console.log("Studio plugin copies are identical");
