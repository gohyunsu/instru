import test from "node:test";
import assert from "node:assert/strict";

import {
  clefForEvents,
  keySignatureLabel,
  lyricsForPart,
  measureHeaderWidth,
  noteSpelling,
  positionForScrollLeft,
  scoreOffsetForTime,
  scoreOffsetForTick,
  scoreTimeForOffset,
  scrollLeftForPosition,
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

test("maps horizontal score exploration to playback time", () => {
  assert.equal(scrollLeftForPosition(12.5), 950);
  assert.equal(positionForScrollLeft(950, 20), 12.5);
  assert.equal(positionForScrollLeft(5000, 20), 20);
});

test("keeps quarter-note spacing stable when tempo changes", () => {
  const score = {
    division: 480,
    duration: 3,
    tempoMap: [
      { tick: 0, bpm: 120, seconds: 0 },
      { tick: 960, bpm: 60, seconds: 1 },
    ],
  };
  assert.equal(scoreOffsetForTime(score, 0.5), 72);
  assert.equal(scoreOffsetForTime(score, 2), 216);
  assert.equal(scoreTimeForOffset(score, 216), 2);
  assert.equal(keySignatureLabel(3), "3♯");
  assert.equal(keySignatureLabel(-2), "2♭");
});

test("keeps note spacing proportional to beats across barlines and meter changes", () => {
  const score = {
    division: 480,
    duration: 8,
    tempoMap: [{ tick: 0, bpm: 120, seconds: 0 }],
    measures: [
      { startTick: 0, timeSignature: "4/4", keySignature: 0 },
      { startTick: 1920, timeSignature: "3/4", keySignature: -1 },
      { startTick: 3360, timeSignature: "6/8", keySignature: null },
    ],
  };

  assert.equal(measureHeaderWidth(score.measures[1]), 62);
  assert.equal(scoreOffsetForTick(score, 480) - scoreOffsetForTick(score, 0), 72);
  assert.equal(scoreOffsetForTick(score, 720) - scoreOffsetForTick(score, 480), 36);
  assert.equal(scoreOffsetForTick(score, 1920) - scoreOffsetForTick(score, 1920, true), 62);
  assert.equal(scoreOffsetForTick(score, 2400) - scoreOffsetForTick(score, 1920), 72);
  assert.equal(scoreOffsetForTick(score, 3360, true) - scoreOffsetForTick(score, 1920), 216);
  assert.equal(scoreOffsetForTick(score, 3600) - scoreOffsetForTick(score, 3360), 36);
  assert.equal(scoreTimeForOffset(score, scoreOffsetForTick(score, 2400)), 2.5);
  assert.equal(scoreTimeForOffset(score, scoreOffsetForTick(score, 1920, true) + 20), 2);
});

test("places one lyric verse on the selected part timeline", () => {
  const score = {
    lyrics: [
      {
        id: "a",
        partId: "s",
        verse: 0,
        startTick: 0,
        startSeconds: 0,
        text: "Stay",
      },
      {
        id: "duplicate",
        partId: "s",
        verse: 0,
        startTick: 0,
        startSeconds: 0,
        text: "Stay",
      },
      {
        id: "verse-two",
        partId: "s",
        verse: 1,
        startTick: 0,
        startSeconds: 0,
        text: "Go",
      },
      {
        id: "other",
        partId: "b",
        verse: 0,
        startTick: 0,
        startSeconds: 0,
        text: "Bass",
      },
    ],
  };
  assert.deepEqual(
    lyricsForPart(score, "s").map((lyric) => lyric.id),
    ["a"],
  );
});
