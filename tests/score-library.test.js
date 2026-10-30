import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

import { scoreDisplayTitle, scoreMatchesSearch } from "../src/score-titles.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(root, "assets/scores/index.json"), "utf8"));

test("public score filenames and visible titles follow one convention", () => {
  for (const score of manifest.scores) {
    assert.match(score.fileName, /^[a-z0-9]+(?:-[a-z0-9]+)*\.(mscz|mscx)$/);
    assert.equal(score.path, `assets/scores/${score.fileName}`);
    assert.equal(score.name, scoreDisplayTitle(score.fileName, score.name));
    assert.match(score.name, /^[\x20-\x7E]+$/);
    assert.equal(statSync(join(root, score.path)).size, score.size);
  }
});

test("English titles and Korean song names find the same stored scores", () => {
  const cases = [
    ["아틀란티스 소녀", "Atlantis Princess"],
    ["아틀란티스소녀", "Atlantis Princess"],
    ["덤디덤디", "DUMDi DUMDi"],
    ["봄날", "Spring Day"],
    ["신호등", "Traffic Light"],
    ["TRAFFIC LIGHT", "Traffic Light"],
    ["springday", "Spring Day"],
  ];
  for (const [query, expected] of cases) {
    assert.deepEqual(
      manifest.scores.filter((score) => scoreMatchesSearch(score, query)).map((score) => score.name),
      [expected],
      query,
    );
  }
  assert.deepEqual(
    manifest.scores.filter((score) => scoreMatchesSearch(score, "없는 노래")),
    [],
  );
});
