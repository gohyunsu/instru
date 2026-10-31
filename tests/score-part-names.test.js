import test from "node:test";
import assert from "node:assert/strict";

import { normalizeScoreParts } from "../src/score-part-names.js";

function parts(names, percussion = []) {
  return names.map((name, index) => ({
    id: `part-${index + 1}`,
    name,
    isPercussion: percussion.includes(index),
  }));
}

test("mixed language and instrument prefixes display as one set of voice names", () => {
  const original = parts([
    "피아노 , Soprano", "피아노 , Alto", "피아노 , Tenor",
    "피아노 , Baritone", "피아노 , Bass", "드럼세트, Staff-1",
  ], [5]);
  const normalized = normalizeScoreParts(original, "payphone.mscz");
  assert.deepEqual(normalized.map((part) => part.name), [
    "Soprano", "Alto", "Tenor", "Baritone", "Bass", "Percussion",
  ]);
  assert.deepEqual(normalized.map((part) => part.id), original.map((part) => part.id));
  assert.equal(original[0].name, "피아노 , Soprano");
});

test("short, Korean, and numbered score labels use consistent English spacing", () => {
  assert.deepEqual(
    normalizeScoreParts(parts(["소프라노", "알토", "테너", "바리톤", "베이스"]), "spring-day.mscz")
      .map((part) => part.name),
    ["Soprano", "Alto", "Tenor", "Baritone", "Bass"],
  );
  assert.deepEqual(
    normalizeScoreParts(parts(["Soprano1", "Soprano2", "Percussion", "Percussion"], [2, 3]), "disney-medley.mscz")
      .map((part) => part.name),
    ["Soprano 1", "Soprano 2", "Percussion 1", "Percussion 2"],
  );
});

test("unlabeled Ipanema parts remain distinct without guessing voice types", () => {
  assert.deepEqual(
    normalizeScoreParts(parts(Array(6).fill("Piano")), "the-girl-from-ipanema.mscz")
      .map((part) => part.name),
    ["Voice 1", "Voice 2", "Voice 3", "Voice 4", "Voice 5", "Voice 6"],
  );
});

test("Love Yourself's five abbreviated parts receive distinct voice labels", () => {
  assert.deepEqual(
    normalizeScoreParts(parts(["S", "A", "T", "B", "B"]), "love-yourself.mscz")
      .map((part) => part.name),
    ["Soprano", "Alto", "Tenor", "Baritone", "Bass"],
  );
});
