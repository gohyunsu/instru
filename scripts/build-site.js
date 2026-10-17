import { cp, mkdir, readFile, rm } from "node:fs/promises";
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
  "assets/brand",
  "assets/illustrations",
];

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const path of publicPaths) {
  await cp(join(root, path), join(output, path), { recursive: true });
}
const scoreManifestPath = join(root, "assets", "scores", "index.json");
const scoreManifest = JSON.parse(await readFile(scoreManifestPath, "utf8"));
await mkdir(join(output, "assets", "scores"), { recursive: true });
await cp(scoreManifestPath, join(output, "assets", "scores", "index.json"));
for (const score of scoreManifest.scores ?? []) {
  if (!/^assets\/scores\/[a-z0-9-]+\.(mscz|mscx)$/.test(score.path)) {
    throw new Error(`Unsafe public score path: ${score.path}`);
  }
  await cp(join(root, score.path), join(output, score.path));
}
console.log(`Built public site with ${scoreManifest.scores?.length ?? 0} listed scores.`);
