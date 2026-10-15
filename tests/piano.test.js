import assert from "node:assert/strict";
import test from "node:test";
import {
  PIANO_HIGH_MIDI,
  PIANO_LOW_MIDI,
  PianoTonePlayer,
  pianoWhiteKeys,
  whiteIndexForMidi,
} from "../src/piano.js";

test("the piano spans all 88 notes with 52 correctly placed white keys", () => {
  assert.equal(PIANO_HIGH_MIDI - PIANO_LOW_MIDI + 1, 88);
  assert.equal(pianoWhiteKeys.length, 52);
  assert.equal(pianoWhiteKeys[0], 21);
  assert.equal(pianoWhiteKeys.at(-1), 108);
  assert.equal(whiteIndexForMidi(60), pianoWhiteKeys.indexOf(60));
  assert.equal(whiteIndexForMidi(61), pianoWhiteKeys.indexOf(62));
});

test("piano keys sustain independently until release", async (context) => {
  const originalWindow = globalThis.window;
  const oscillators = [];
  class FakeAudioContext {
    constructor() {
      this.state = "running";
      this.currentTime = 5;
      this.destination = {};
    }
    async resume() {}
    createGain() {
      return {
        gain: {
          value: 0,
          setValueAtTime(value) { this.value = value; },
          exponentialRampToValueAtTime(value) { this.value = value; },
          cancelScheduledValues() {},
        },
        connect() { return this; },
        disconnect() {},
      };
    }
    createOscillator() {
      const oscillator = {
        frequency: { setValueAtTime(value) { this.value = value; } },
        connect(gain) { return gain; },
        addEventListener() {},
        start(at) { this.startedAt = at; },
        stop(at) { this.stoppedAt = at; },
      };
      oscillators.push(oscillator);
      return oscillator;
    }
  }
  globalThis.window = { AudioContext: FakeAudioContext };
  context.after(() => { globalThis.window = originalWindow; });

  const player = new PianoTonePlayer();
  assert.equal(await player.press(69, "finger"), true);
  assert.equal(oscillators[0].frequency.value, 440);
  assert.equal(oscillators[0].startedAt, 5);
  assert.equal(oscillators[0].stoppedAt, undefined);
  assert.equal(await player.press(72, "second finger"), true);
  assert.equal(oscillators[1].stoppedAt, undefined);
  player.release("finger");
  assert.equal(oscillators[0].stoppedAt, 5.1);
  assert.equal(oscillators[1].stoppedAt, undefined);
  player.stopAll();
  assert.equal(oscillators[1].stoppedAt, 5.1);
});

test("releasing before audio resumes prevents a delayed piano note", async () => {
  const player = new PianoTonePlayer();
  let resume;
  player.ensureContext = () => new Promise((resolve) => { resume = resolve; });
  const pending = player.press(60, "finger");
  player.release("finger");
  resume();
  assert.equal(await pending, false);
  assert.equal(player.voices.size, 0);
});
