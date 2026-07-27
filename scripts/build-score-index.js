import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { extname, join, parse, posix, relative } from "node:path";

import { titleFromMuseScoreXml } from "../src/score-metadata.js";
import { extractMuseScoreXml } from "../src/zip.js";

const root = process.cwd();
const scoreDirectory = join(root, "assets", "scores");
const outputPath = join(scoreDirectory, "index.json");

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolutePath = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(absolutePath)));
    } else if (/\.(mscz|mscx)$/i.test(entry.name)) {
      files.push(absolutePath);
    }
  }
  return files;
}

const files = (await walk(scoreDirectory)).sort((left, right) =>
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
    name: titleFromMuseScoreXml(xml, fileName),
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
