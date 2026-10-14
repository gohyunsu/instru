import test from "node:test";
import assert from "node:assert/strict";

import { ReferenceTonePlayer } from "../src/audio-engine.js";

class FakeAudioParam {
  constructor() {
    this.values = [];
  }

  setValueAtTime(value) {
    this.values.push(value);
  }

  exponentialRampToValueAtTime(value) {
    this.values.push(value);
  }

  cancelScheduledValues() {}

  setTargetAtTime(value) {
    this.values.push(value);
  }
}

class FakeAudioNode {
  connect(next) {
    return next;
  }
}

class FakeOscillator extends FakeAudioNode {
  constructor() {
    super();
    this.frequency = new FakeAudioParam();
    this.stopCalls = 0;
  }

  start() {}

  stop() { this.stopCalls += 1; }
}

class FakeGain extends FakeAudioNode {
  constructor() {
    super();
    this.gain = new FakeAudioParam();
  }
}

class FakeAudioContext {
  constructor() {
    this.state = "suspended";
    this.currentTime = 2;
    this.destination = {};
    this.gains = [];
    this.oscillators = [];
    this.resumeCount = 0;
    this.suspendCount = 0;
  }

  async resume() {
    this.resumeCount += 1;
    this.state = "running";
  }

  async suspend() {
    this.suspendCount += 1;
    this.state = "suspended";
  }

  createOscillator() {
    const oscillator = new FakeOscillator();
    this.oscillators.push(oscillator);
    return oscillator;
  }

  createGain() {
    const gain = new FakeGain();
    this.gains.push(gain);
    return gain;
  }
}

globalThis.window = {
  AudioContext: FakeAudioContext,
  clearTimeout() {},
  setTimeout() {
    return 1;
  },
};

test("reference tone resumes reliably after its context was suspended", async () => {
  const states = [];
  const player = new ReferenceTonePlayer((playing) => states.push(playing));

  await player.prepare();
  await player.play(440);
  const context = player.context;
  assert.equal(context.state, "running");
  assert.equal(states.at(-1), true);
  assert.ok(context.gains.at(-1).gain.values.includes(0.18));

  await player.suspend();
  assert.equal(context.state, "suspended");
  assert.equal(states.at(-1), false);

  await player.play(466.16);
  assert.equal(context.state, "running");
  assert.ok(context.resumeCount >= 3);
  assert.equal(states.at(-1), true);
});

test("reference tone sustains until the hold is released", async () => {
  const player = new ReferenceTonePlayer();
  await player.play(440, null);
  const oscillator = player.context.oscillators.at(-1);
  assert.equal(oscillator.stopCalls, 0);
  assert.equal(player.stopTimer, null);
  player.stop();
  assert.equal(oscillator.stopCalls, 1);
});
