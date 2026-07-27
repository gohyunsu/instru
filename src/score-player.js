import { midiToFrequency } from "./music.js";

const SCHEDULE_INTERVAL_MS = 80;
const LOOK_AHEAD_SECONDS = 0.45;

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

export class MuseScorePlayer {
  constructor({ onStateChange = () => {}, onProgress = () => {} } = {}) {
    this.onStateChange = onStateChange;
    this.onProgress = onProgress;
    this.context = null;
    this.master = null;
    this.compressor = null;
    this.score = null;
    this.enabledParts = new Set();
    this.playing = false;
    this.position = 0;
    this.startedAt = 0;
    this.nextEventIndex = 0;
    this.scheduler = null;
    this.nodes = new Set();
  }

  load(score) {
    this.stop();
    this.score = score;
    this.enabledParts = new Set(score.parts.map((part) => part.id));
    this.position = 0;
    this.onProgress(0, score.duration);
  }

  async ensureContext() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      throw new Error("UNSUPPORTED");
    }

    if (!this.context || this.context.state === "closed") {
      this.context = new AudioContextClass({ latencyHint: "interactive" });
      this.master = this.context.createGain();
      this.compressor = this.context.createDynamicsCompressor();
      this.master.gain.value = 0.13;
      this.compressor.threshold.value = -15;
      this.compressor.knee.value = 18;
      this.compressor.ratio.value = 5;
      this.compressor.attack.value = 0.004;
      this.compressor.release.value = 0.15;
      this.master.connect(this.compressor).connect(this.context.destination);
    }
    await this.context.resume();
  }

  currentPosition() {
    if (!this.playing || !this.context) {
      return this.position;
    }
    return clamp(
      this.context.currentTime - this.startedAt,
      0,
      this.score?.duration ?? 0,
    );
  }

  findEventIndex(position) {
    if (!this.score) {
      return 0;
    }
    const events = this.score.events;
    let low = 0;
    let high = events.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (events[middle].startSeconds < position - 0.01) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }

    while (
      low > 0 &&
      events[low - 1].startSeconds + events[low - 1].durationSeconds > position
    ) {
      low -= 1;
    }
    return low;
  }

  scheduleNote(event, position, contextNow) {
    if (!this.enabledParts.has(event.partId)) {
      return;
    }

    const eventEnd = event.startSeconds + event.durationSeconds;
    if (eventEnd <= position) {
      return;
    }

    const delay = Math.max(0, event.startSeconds - position);
    const startAt = contextNow + delay;
    const audibleDuration = eventEnd - Math.max(position, event.startSeconds);
    const endAt = startAt + Math.max(0.035, audibleDuration);
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    const node = { oscillator, gain, partId: event.partId };

    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(midiToFrequency(event.midi), startAt);

    const peak = 0.52 * event.velocity;
    const attackEnd = Math.min(startAt + 0.015, endAt - 0.012);
    const releaseStart = Math.max(attackEnd, endAt - 0.07);
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.02, peak), attackEnd);
    gain.gain.exponentialRampToValueAtTime(
      Math.max(0.015, peak * 0.58),
      releaseStart,
    );
    gain.gain.exponentialRampToValueAtTime(0.0001, endAt);

    oscillator.connect(gain).connect(this.master);
    oscillator.addEventListener(
      "ended",
      () => {
        gain.disconnect();
        this.nodes.delete(node);
      },
      { once: true },
    );
    this.nodes.add(node);
    oscillator.start(startAt);
    oscillator.stop(endAt + 0.02);
  }

  scheduleUpcoming() {
    if (!this.playing || !this.score) {
      return;
    }

    const position = this.currentPosition();
    if (position >= this.score.duration) {
      this.finish();
      return;
    }

    const horizon = position + LOOK_AHEAD_SECONDS;
    const contextNow = this.context.currentTime;
    while (this.nextEventIndex < this.score.events.length) {
      const event = this.score.events[this.nextEventIndex];
      if (event.startSeconds > horizon) {
        break;
      }
      this.scheduleNote(event, position, contextNow);
      this.nextEventIndex += 1;
    }
    this.onProgress(position, this.score.duration);
  }

  async play() {
    if (!this.score || this.playing) {
      return;
    }
    await this.ensureContext();

    if (this.position >= this.score.duration - 0.03) {
      this.position = 0;
    }
    this.playing = true;
    this.startedAt = this.context.currentTime - this.position;
    this.nextEventIndex = this.findEventIndex(this.position);
    this.scheduleUpcoming();
    this.scheduler = window.setInterval(
      () => this.scheduleUpcoming(),
      SCHEDULE_INTERVAL_MS,
    );
    this.onStateChange(true);
  }

  pause() {
    if (!this.playing) {
      return;
    }
    this.position = this.currentPosition();
    this.playing = false;
    window.clearInterval(this.scheduler);
    this.scheduler = null;
    this.stopNodes();
    this.onProgress(this.position, this.score?.duration ?? 0);
    this.onStateChange(false);
  }

  finish() {
    this.playing = false;
    this.position = this.score?.duration ?? 0;
    window.clearInterval(this.scheduler);
    this.scheduler = null;
    this.stopNodes();
    this.onProgress(this.position, this.score?.duration ?? 0);
    this.onStateChange(false);
  }

  stop() {
    const wasPlaying = this.playing;
    this.playing = false;
    this.position = 0;
    window.clearInterval(this.scheduler);
    this.scheduler = null;
    this.stopNodes();
    if (wasPlaying) {
      this.onStateChange(false);
    }
    if (this.score) {
      this.onProgress(0, this.score.duration);
    }
  }

  seek(position) {
    if (!this.score) {
      return;
    }
    const wasPlaying = this.playing;
    if (wasPlaying) {
      this.pause();
    }
    this.position = clamp(position, 0, this.score.duration);
    this.nextEventIndex = this.findEventIndex(this.position);
    this.onProgress(this.position, this.score.duration);
    if (wasPlaying) {
      this.play();
    }
  }

  setPartEnabled(partId, enabled) {
    if (enabled) {
      this.enabledParts.add(partId);
    } else {
      this.enabledParts.delete(partId);
      this.stopNodes(partId);
    }

    if (this.playing) {
      const position = this.currentPosition();
      this.stopNodes();
      this.nextEventIndex = this.findEventIndex(position);
      this.scheduleUpcoming();
    }
  }

  stopNodes(partId = null) {
    for (const node of [...this.nodes]) {
      if (partId && node.partId !== partId) {
        continue;
      }
      try {
        node.oscillator.stop();
      } catch {
        // Already stopped.
      }
      this.nodes.delete(node);
    }
  }
}
