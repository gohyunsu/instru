import test from "node:test";
import assert from "node:assert/strict";

import {
  GRAPH_CENTS_RANGE,
  PitchTraceSmoother,
  splitPitchTrace,
} from "../src/pitch-graph.js";

test("pitch trace wraps smoothly at semitone boundaries", () => {
  const chunks = splitPitchTrace([
    { time: 0, cents: 46, note: 69 },
    { time: 50, cents: 49, note: 69 },
    { time: 100, cents: -48, note: 70 },
    { time: 150, cents: -45, note: 70 },
    { time: 200, gap: true },
    { time: 250, cents: 2, note: 70 },
  ]);

  assert.deepEqual(chunks.map((chunk) => chunk.length), [3, 3, 1]);
  assert.ok(
    chunks.every(
      (chunk) => new Set(chunk.map((point) => point.note)).size === 1,
    ),
  );
  assert.equal(chunks[0].at(-1).cents, GRAPH_CENTS_RANGE);
  assert.equal(chunks[1][0].cents, -GRAPH_CENTS_RANGE);
  assert.equal(chunks[0].at(-1).time, chunks[1][0].time);
});

test("pitch trend reduces frame-to-frame visual jitter", () => {
  const smoother = new PitchTraceSmoother();
  const raw = [0, 8, -7, 9, -8, 7, -6, 8, -7, 6];
  const smoothed = raw.map((cents, index) =>
    smoother.update({
      time: index * 50,
      cents,
      note: 69,
      confidence: 0.9,
    }),
  );
  const totalMovement = (values) =>
    values
      .slice(1)
      .reduce(
        (sum, value, index) => sum + Math.abs(value - values[index]),
        0,
      );

  assert.ok(totalMovement(smoothed) < totalMovement(raw) * 0.35);
});

test("pitch trend resets instead of crossing the graph on a note change", () => {
  const smoother = new PitchTraceSmoother();
  smoother.update({ time: 0, cents: 46, note: 69 });
  smoother.update({ time: 50, cents: 49, note: 69 });

  const switched = smoother.update({
    time: 100,
    cents: -48,
    note: 70,
  });

  assert.equal(switched, -48);
  assert.equal(GRAPH_CENTS_RANGE, 60);
});
