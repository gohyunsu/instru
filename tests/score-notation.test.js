import test from "node:test";
import assert from "node:assert/strict";

import {
  clefForEvents,
  noteSpelling,
  staffStepForNote,
  visibleEvents,
} from "../src/score-notation.js";

test("preserves MuseScore tonal pitch spelling", () => {
  assert.deepEqual(noteSpelling(60, 14), {
    letter: "C",
    accidental: 0,
    symbol: "",
    octave: 4,
  });
  assert.deepEqual(noteSpelling(61, 21), {
    letter: "C",
    accidental: 1,
    symbol: "♯",
    octave: 4,
  });
  assert.deepEqual(noteSpelling(61, 9), {
    letter: "D",
    accidental: -1,
    symbol: "♭",
    octave: 4,
  });
});

test("falls back to sharp note names when TPC is unavailable", () => {
  assert.deepEqual(noteSpelling(70), {
    letter: "A",
    accidental: 1,
    symbol: "♯",
    octave: 4,
  });
});

test("maps notes to treble and bass staff steps", () => {
  assert.equal(staffStepForNote(64, 18, "treble"), 0);
  assert.equal(staffStepForNote(60, 14, "treble"), -2);
  assert.equal(staffStepForNote(43, 15, "bass"), 0);
  assert.equal(staffStepForNote(52, 18, "treble-8vb"), 0);
});

test("selects a useful clef from the part range", () => {
  assert.equal(clefForEvents([{ midi: 48 }, { midi: 52 }, { midi: 55 }]), "bass");
  assert.equal(
    clefForEvents([{ midi: 60 }, { midi: 67 }, { midi: 72 }]),
    "treble",
  );
});

test("keeps held notes visible when their start is outside the window", () => {
  const events = [
    { startSeconds: 0, durationSeconds: 5 },
    { startSeconds: 7, durationSeconds: 1 },
    { startSeconds: 10, durationSeconds: 1 },
  ];
  assert.deepEqual(visibleEvents(events, 3, 8), events.slice(0, 2));
});
