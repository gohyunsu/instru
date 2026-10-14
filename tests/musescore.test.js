import test from "node:test";
import assert from "node:assert/strict";

import {
  buildTempoMap,
  fractionToTicks,
  isPercussionPartName,
  measureVoiceContainers,
  preferredTenorPart,
  secondsToTick,
  slurMarkers,
  tickToSeconds,
} from "../src/musescore-parser.js";

test("reads MuseScore 2 measures without voice wrappers", () => {
  const chord = { nodeType: 1, tagName: "Chord" };
  const legacyMeasure = { childNodes: [chord] };
  const voice = { nodeType: 1, tagName: "voice" };
  const modernMeasure = { childNodes: [voice] };

  assert.deepEqual(measureVoiceContainers(legacyMeasure), [legacyMeasure]);
  assert.deepEqual(measureVoiceContainers(modernMeasure), [voice]);
});

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

test("converts time back to ticks across a tempo change", () => {
  const tempoMap = buildTempoMap(
    [{ tick: 0, bpm: 120 }, { tick: 960, bpm: 60 }],
    480,
  );
  assert.equal(secondsToTick(0.5, tempoMap, 480), 480);
  assert.equal(secondsToTick(2, tempoMap, 480), 1440);
});

test("distinguishes MuseScore chord slur endpoints from note ties", () => {
  const element = (tagName, children = [], type = null) => ({
    nodeType: 1,
    tagName,
    childNodes: children,
    getAttribute: (name) => (name === "type" ? type : null),
  });
  const start = element("Chord", [element("Spanner", [element("Slur")], "Slur")]);
  const end = element("Chord", [element("Spanner", [element("prev")], "Slur")]);
  const tie = element("Chord", [element("Note", [element("Spanner", [element("Tie")], "Tie")])]);
  assert.deepEqual(slurMarkers(start), { start: true, end: false });
  assert.deepEqual(slurMarkers(end), { start: false, end: true });
  assert.deepEqual(slurMarkers(tie), { start: false, end: false });
});

test("recognizes percussion parts that should not be played", () => {
  assert.equal(isPercussionPartName("Percussion"), true);
  assert.equal(isPercussionPartName("드럼"), true);
  assert.equal(isPercussionPartName("Soprano", "voice.soprano"), false);
});

test("selects an English or Korean tenor part by default", () => {
  const englishParts = [
    { id: "s", name: "Soprano" },
    { id: "t", name: "Tenor" },
  ];
  const koreanParts = [
    { id: "a", name: "알토" },
    { id: "t", name: "테너 1" },
  ];

  assert.equal(preferredTenorPart(englishParts)?.id, "t");
  assert.equal(preferredTenorPart(koreanParts)?.id, "t");
  assert.equal(preferredTenorPart([{ id: "b", name: "Bass" }]), null);
});
