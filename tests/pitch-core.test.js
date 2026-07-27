import test from "node:test";
import assert from "node:assert/strict";

import { detectPitch } from "../src/pitch-core.js";

const SAMPLE_RATE = 24000;
const FRAME_SIZE = 2048;

function sineWave(frequency, amplitude = 0.5) {
  const buffer = new Float32Array(FRAME_SIZE);
  for (let index = 0; index < buffer.length; index += 1) {
    buffer[index] =
      amplitude * Math.sin((2 * Math.PI * frequency * index) / SAMPLE_RATE);
  }
  return buffer;
}

for (const frequency of [55, 82.41, 110, 220, 440, 880]) {
  test(`detects a ${frequency} Hz steady tone`, () => {
    const result = detectPitch(sineWave(frequency), SAMPLE_RATE);
    assert.notEqual(result.frequency, null);
    const relativeError = Math.abs(result.frequency - frequency) / frequency;
    assert.ok(
      relativeError < 0.008,
      `expected ${frequency} Hz, received ${result.frequency} Hz`,
    );
    assert.ok(result.confidence > 0.85);
  });
}

test("rejects silence", () => {
  const result = detectPitch(new Float32Array(FRAME_SIZE), SAMPLE_RATE);
  assert.equal(result.frequency, null);
  assert.equal(result.confidence, 0);
});
