import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

import { scoreDisplayTitle } from "../src/score-titles.js";

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
