import { cp, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = join(root, "dist");

// The published artifact is an allowlist. Private source photos are never
// copied, even if someone accidentally places them beside public assets.
const publicPaths = [
  "index.html",
  "favicon.svg",
  "styles",
  "src",
  "assets/illustrations",
  "assets/scores",
];

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const path of publicPaths) {
  await cp(join(root, path), join(output, path), { recursive: true });
}
console.log(`Built public site from ${publicPaths.length} allowlisted paths.`);
