import test from "node:test";
import assert from "node:assert/strict";

import { PitchStabilizer } from "../src/pitch-stabilizer.js";

test("rejects a single large pitch spike", () => {
  const stabilizer = new PitchStabilizer();
  const stableInputs = [69.02, 68.99, 69.01, 69, 69.03];
  let result;
  for (const midi of stableInputs) {
    result = stabilizer.update(midi);
  }

  const beforeSpike = result.midi;
  const spike = stabilizer.update(81);
  assert.equal(spike.noteMidi, 69);
  assert.ok(Math.abs(spike.midi - beforeSpike) < 0.04);
});

test("does not chatter when pitch hovers around a semitone boundary", () => {
  const stabilizer = new PitchStabilizer();
  stabilizer.update(69.1);

  const displayedNotes = [];
  for (const midi of [69.46, 69.53, 69.48, 69.54, 69.49, 69.52, 69.47]) {
    displayedNotes.push(stabilizer.update(midi).noteMidi);
  }

  assert.deepEqual(new Set(displayedNotes), new Set([69]));
});

test("switches after a new semitone remains stable for consecutive frames", () => {
  const stabilizer = new PitchStabilizer();
  for (let index = 0; index < 6; index += 1) {
    stabilizer.update(69.02);
  }

  let result;
  for (let index = 0; index < 10; index += 1) {
    result = stabilizer.update(70.01);
  }

  assert.equal(result.noteMidi, 70);
  assert.ok(Math.abs(result.cents) < 8);
});

test("reset forgets the previous note immediately", () => {
  const stabilizer = new PitchStabilizer();
  stabilizer.update(69);
  stabilizer.reset();
  const result = stabilizer.update(72);
  assert.equal(result.noteMidi, 72);
  assert.equal(result.midi, 72);
});
