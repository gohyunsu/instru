import test from "node:test";
import assert from "node:assert/strict";

import {
  createMediaCarrierWav,
  ScoreMediaSession,
} from "../src/score-media-session.js";

test("media carrier is a valid six-second WAV for Android media focus", async () => {
  const buffer = await createMediaCarrierWav().arrayBuffer();
  const view = new DataView(buffer);
  const label = (start, end) => String.fromCharCode(...new Uint8Array(buffer, start, end - start));
  assert.equal(label(0, 4), "RIFF");
  assert.equal(label(8, 12), "WAVE");
  assert.equal(label(36, 40), "data");
  assert.equal(view.getUint32(24, true), 8000);
  assert.equal(view.getUint32(40, true) / (8000 * 2), 6);
});

test("media controls and carrier stay in sync with score transport", () => {
  const handlers = new Map();
  const positions = [];
  const session = {
    metadata: null,
    playbackState: "none",
    setActionHandler(action, callback) { handlers.set(action, callback); },
    setPositionState(position) { positions.push(position); },
  };
  const listeners = new Map();
  const audio = {
    playCalls: 0,
    pauseCalls: 0,
    addEventListener(name, callback) { listeners.set(name, callback); },
    play() { this.playCalls += 1; return Promise.resolve(); },
    pause() { this.pauseCalls += 1; listeners.get("pause")?.(); },
  };
  const calls = [];
  const controls = new ScoreMediaSession({
    session,
    Metadata: class { constructor(details) { Object.assign(this, details); } },
    createAudio: () => audio,
    createObjectURL: () => "blob:carrier",
    host: { append() {} },
    onPlay: () => calls.push("play"),
    onPause: () => calls.push("pause"),
    onStop: () => calls.push("stop"),
  });

  controls.setScore("Disney Medley", 328, 12);
  assert.equal(session.metadata.title, "Disney Medley");
  assert.equal(session.playbackState, "paused");
  assert.equal(positions.at(-1).position, 12);

  controls.start();
  assert.equal(audio.playCalls, 1);
  assert.equal(session.playbackState, "playing");
  controls.updatePosition(13.4);
  assert.equal(positions.at(-1).position, 13.4);
  handlers.get("pause")();
  assert.deepEqual(calls, ["pause"]);

  controls.pause();
  assert.equal(audio.pauseCalls, 1);
  assert.equal(session.playbackState, "paused");
  handlers.get("play")();
  handlers.get("stop")();
  assert.deepEqual(calls, ["pause", "play", "stop"]);

  controls.start();
  listeners.get("pause")();
  assert.deepEqual(calls.at(-1), "pause");
  controls.deactivate();
  assert.equal(session.playbackState, "none");
  assert.equal(session.metadata, null);
});

test("score playback remains available without Media Session support", () => {
  const controls = new ScoreMediaSession({ session: null });
  controls.setScore("Danny Boy", 120);
  controls.start();
  controls.pause();
  assert.equal(controls.audio, null);
});

test("a media carrier failure does not block score playback", () => {
  const session = {
    playbackState: "none",
    setActionHandler() {},
  };
  const controls = new ScoreMediaSession({
    session,
    createAudio: () => { throw new Error("media element unavailable"); },
  });
  controls.setScore("Danny Boy", 120);
  assert.doesNotThrow(() => controls.start());
  assert.equal(controls.playing, false);
});
