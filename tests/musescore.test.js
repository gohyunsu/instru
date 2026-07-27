import test from "node:test";
import assert from "node:assert/strict";

import {
  buildTempoMap,
  fractionToTicks,
  tickToSeconds,
} from "../src/musescore-parser.js";

test("converts whole-note fractions to MuseScore ticks", () => {
  assert.equal(fractionToTicks("1/4", 480), 480);
  assert.equal(fractionToTicks("3/4", 480), 1440);
  assert.equal(fractionToTicks("1/8", 480), 240);
  assert.equal(fractionToTicks("invalid", 480), null);
});

test("integrates tempo changes when converting ticks to seconds", () => {
  const tempoMap = buildTempoMap(
    [
      { tick: 0, bpm: 120 },
      { tick: 960, bpm: 60 },
    ],
    480,
  );

  assert.equal(tickToSeconds(480, tempoMap, 480), 0.5);
  assert.equal(tickToSeconds(960, tempoMap, 480), 1);
  assert.equal(tickToSeconds(1440, tempoMap, 480), 2);
});

test("last tempo at a shared tick wins", () => {
  const tempoMap = buildTempoMap(
    [
      { tick: 0, bpm: 90 },
      { tick: 0, bpm: 60 },
    ],
    480,
  );
  assert.equal(tempoMap.length, 1);
  assert.equal(tempoMap[0].bpm, 60);
});
