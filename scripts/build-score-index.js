import { execFile } from "node:child_process";
import { readFile, stat, writeFile } from "node:fs/promises";
import { extname, join, parse, posix, relative } from "node:path";
import { promisify } from "node:util";

import { titleFromMuseScoreXml } from "../src/score-metadata.js";
import { scoreDisplayTitle } from "../src/score-titles.js";
import { extractMuseScoreXml } from "../src/zip.js";

const root = process.cwd();
const scoreDirectory = join(root, "assets", "scores");
const outputPath = join(scoreDirectory, "index.json");

// Only staged/tracked scores can enter the published manifest. A local score
// dropped into the directory remains private until deliberately added to Git.
const { stdout } = await promisify(execFile)(
  "git", ["ls-files", "--cached", "-z", "--", "assets/scores"], { cwd: root },
);
const files = stdout.split("\0")
  .filter((path) => /\.(mscz|mscx)$/i.test(path))
  .map((path) => join(root, path))
  .sort((left, right) =>
    left.localeCompare(right, "ko"),
  );
const scores = [];

for (const absolutePath of files) {
  const info = await stat(absolutePath);
  const relativePath = relative(root, absolutePath)
    .split("\\")
    .join("/");
  const extension = extname(absolutePath).slice(1).toLowerCase();
  const fileName = parse(absolutePath).base;
  const bytes = await readFile(absolutePath);
  const xml =
    extension === "mscx"
      ? new TextDecoder().decode(bytes)
      : await extractMuseScoreXml(bytes);

  scores.push({
    name: scoreDisplayTitle(fileName, titleFromMuseScoreXml(xml, fileName)),
    fileName,
    path: posix.join(".", relativePath),
    format: extension,
    size: info.size,
  });
}

scores.sort((left, right) => left.name.localeCompare(right.name, "ko"));

const manifest = {
  generatedAt: new Date().toISOString(),
  scores,
};

await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`Indexed ${scores.length} MuseScore file(s).`);
