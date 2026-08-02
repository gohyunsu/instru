import test from "node:test";
import assert from "node:assert/strict";

import {
  decibelsToGain,
  MAX_PART_DECIBELS,
  MuseScorePlayer,
  SCORE_MASTER_GAIN,
} from "../src/score-player.js";

globalThis.window = {
  clearInterval,
  setInterval,
};

const score = {
  duration: 8,
  parts: [
    { id: "soprano", name: "Soprano" },
    { id: "bass", name: "Bass" },
  ],
  events: [
    {
      startSeconds: 0,
      durationSeconds: 1,
      midi: 69,
      velocity: 0.8,
      partId: "soprano",
    },
    {
      startSeconds: 3,
      durationSeconds: 2,
      midi: 45,
      velocity: 0.8,
      partId: "bass",
    },
    {
      startSeconds: 7,
      durationSeconds: 1,
      midi: 72,
      velocity: 0.8,
      partId: "soprano",
    },
  ],
};

test("loads all parts enabled and seeks to a requested position", () => {
  const progress = [];
  const player = new MuseScorePlayer({
    onProgress: (position) => progress.push(position),
  });
  player.load(score);

  assert.deepEqual([...player.enabledParts], ["soprano", "bass"]);
  player.seek(4.25);
  assert.equal(player.position, 4.25);
  assert.equal(player.nextEventIndex, 1);
  assert.equal(progress.at(-1), 4.25);
});

test("part controls can mute and restore an individual part", () => {
  const player = new MuseScorePlayer();
  player.load(score);

  player.setPartEnabled("bass", false);
  assert.equal(player.enabledParts.has("bass"), false);
  assert.equal(player.enabledParts.has("soprano"), true);

  player.setPartEnabled("bass", true);
  assert.equal(player.enabledParts.has("bass"), true);
});

test("part volume can be boosted and is clamped to a safe range", () => {
  const player = new MuseScorePlayer();
  player.load(score);

  player.setPartVolume("soprano", 1.65);
  assert.equal(player.getPartVolume("soprano"), 1.65);

  player.setPartVolume("soprano", 100);
  assert.equal(
    player.getPartVolume("soprano"),
    decibelsToGain(MAX_PART_DECIBELS),
  );

  player.setPartVolume("soprano", -1);
  assert.equal(player.getPartVolume("soprano"), 0);
});

test("converts mixer decibels to linear audio gain", () => {
  assert.equal(decibelsToGain(0), 1);
  assert.ok(Math.abs(decibelsToGain(6) - 1.9953) < 0.0001);
  assert.ok(Math.abs(decibelsToGain(-6) - 0.5012) < 0.0001);
  assert.equal(SCORE_MASTER_GAIN, 0.32);
});

test("score playback loops by default at the end", () => {
  const progress = [];
  const player = new MuseScorePlayer({
    onProgress: (position) => progress.push(position),
  });
  player.load(score);
  player.context = { currentTime: 12 };
  player.playing = true;
  player.position = score.duration;
  progress.length = 0;
  let scheduled = 0;
  player.scheduleUpcoming = () => {
    scheduled += 1;
    player.onProgress(player.currentPosition(), score.duration);
  };

  player.finish();

  assert.equal(player.looping, true);
  assert.equal(player.playing, true);
  assert.equal(player.position, 0);
  assert.equal(player.startedAt, 12);
  assert.equal(player.nextEventIndex, 0);
  assert.equal(progress.at(-1), 0);
  assert.equal(scheduled, 1);
});

test("score playback can finish when looping is disabled", () => {
  const states = [];
  const player = new MuseScorePlayer({
    onStateChange: (playing) => states.push(playing),
  });
  player.load(score);
  player.setLooping(false);
  player.playing = true;

  player.finish();

  assert.equal(player.looping, false);
  assert.equal(player.playing, false);
  assert.equal(player.position, score.duration);
  assert.equal(states.at(-1), false);
});

test("score audio can be suspended between modes and resumed on play", async () => {
  const player = new MuseScorePlayer();
  let suspendCount = 0;
  player.context = {
    state: "running",
    async suspend() {
      suspendCount += 1;
      this.state = "suspended";
    },
  };

  await player.suspendAudio();

  assert.equal(suspendCount, 1);
  assert.equal(player.context.state, "suspended");
});

test("seek positions are clamped to the score duration", () => {
  const player = new MuseScorePlayer();
  player.load(score);
  player.seek(100);
  assert.equal(player.position, 8);
  player.seek(-5);
  assert.equal(player.position, 0);
});

test("returns quiet visualization bands before audio starts", () => {
  const player = new MuseScorePlayer();
  assert.deepEqual(player.visualizationLevels(5), [0, 0, 0, 0, 0]);
});

test("maps active score notes into distinct visualization bands", () => {
  const player = new MuseScorePlayer();
  player.load(score);
  player.playing = true;
  player.position = 0.2;
  const levels = player.visualizationLevels(9);
  player.playing = false;

  assert.ok(Math.max(...levels) > 0.5);
  assert.ok(new Set(levels.map((level) => level.toFixed(2))).size > 2);
});
