import test from "node:test";
import assert from "node:assert/strict";

import { MuseScorePlayer } from "../src/score-player.js";

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
