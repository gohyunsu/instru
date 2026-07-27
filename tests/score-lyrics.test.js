import test from "node:test";
import assert from "node:assert/strict";

import {
  activeLyricId,
  lyricContext,
  lyricTokenText,
  measureIndexAtPosition,
} from "../src/score-lyrics.js";

const measures = Array.from({ length: 8 }, (_, index) => ({
  startSeconds: index * 4,
  endSeconds: (index + 1) * 4,
}));

const lyrics = [
  {
    id: "a",
    partId: "soprano",
    measureIndex: 1,
    verse: 0,
    startSeconds: 5,
    endSeconds: 5.5,
    syllabic: "begin",
    text: "to",
  },
  {
    id: "b",
    partId: "soprano",
    measureIndex: 2,
    verse: 0,
    startSeconds: 8.5,
    endSeconds: 9,
    syllabic: "end",
    text: "gether",
  },
  {
    id: "other",
    partId: "bass",
    measureIndex: 2,
    verse: 0,
    startSeconds: 9,
    endSeconds: 10,
    syllabic: "single",
    text: "bass",
  },
];

test("finds the measure at the current playback position", () => {
  assert.equal(measureIndexAtPosition(measures, 0), 0);
  assert.equal(measureIndexAtPosition(measures, 11.9), 2);
  assert.equal(measureIndexAtPosition(measures, 200), 7);
});

test("keeps two surrounding measures for one selected part", () => {
  const context = lyricContext(
    { measures, lyrics },
    "soprano",
    9,
  );
  assert.equal(context.currentMeasureIndex, 2);
  assert.equal(context.startMeasureIndex, 0);
  assert.equal(context.endMeasureIndex, 4);
  assert.deepEqual(
    context.lyrics.map((lyric) => lyric.id),
    ["a", "b"],
  );
});

test("adds a hyphen to continuing syllables", () => {
  assert.equal(lyricTokenText(lyrics[0]), "to-");
  assert.equal(lyricTokenText(lyrics[1]), "gether");
});

test("highlights a lyric briefly until the next syllable", () => {
  assert.equal(activeLyricId(lyrics.slice(0, 2), 5.8), "a");
  assert.equal(activeLyricId(lyrics.slice(0, 2), 7), null);
  assert.equal(activeLyricId(lyrics.slice(0, 2), 8.7), "b");
});
