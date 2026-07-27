import test from "node:test";
import assert from "node:assert/strict";

import {
  describeCents,
  formatCents,
  formatNote,
  frequencyToMidi,
  measurementFromMidi,
  midiToFrequency,
} from "../src/music.js";

test("A4 maps to MIDI 69 and 440 Hz", () => {
  assert.equal(frequencyToMidi(440), 69);
  assert.equal(midiToFrequency(69), 440);
  assert.equal(formatNote(69), "A4");
});

test("note labels include octave and sharps", () => {
  assert.equal(formatNote(60), "C4");
  assert.equal(formatNote(61), "C♯4");
  assert.equal(formatNote(70), "A♯4");
});

test("measurement expresses pitch difference in cents", () => {
  const highA = measurementFromMidi(69.25);
  assert.equal(highA.label, "A4");
  assert.ok(Math.abs(highA.cents - 25) < 0.0001);

  const lowA = measurementFromMidi(68.8);
  assert.equal(lowA.label, "A4");
  assert.ok(Math.abs(lowA.cents + 20) < 0.0001);

  const lockedA = measurementFromMidi(69.55, undefined, 69);
  assert.equal(lockedA.label, "A4");
  assert.ok(Math.abs(lockedA.cents - 55) < 0.0001);
});

test("cent descriptions are explicit", () => {
  assert.deepEqual(describeCents(4), {
    direction: "exact",
    label: "정확해요",
    symbol: "",
  });
  assert.equal(describeCents(-14).label, "조금 낮아요");
  assert.equal(describeCents(28).label, "높아요");
  assert.equal(formatCents(-14.4), "−14¢");
  assert.equal(formatCents(9.6), "+10¢");
});
