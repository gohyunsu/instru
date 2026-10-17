import { midiToFrequency } from "./music.js";

const SCHEDULE_INTERVAL_MS = 80;
const LOOK_AHEAD_SECONDS = 0.45;
export const SCORE_MASTER_GAIN = 0.32;
export const MAX_PART_DECIBELS = 10;

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

export function decibelsToGain(decibels) {
  const value = Number(decibels);
  return Number.isFinite(value) ? 10 ** (value / 20) : 1;
}

export function previewEventsAt(score, partId, position) {
  if (!score?.parts.some((part) => part.id === partId)) return [];
  const time = clamp(Number(position) || 0, 0, score.duration);
  return score.events.filter((event) =>
    event.partId === partId &&
    event.startSeconds <= time + 0.005 &&
    event.startSeconds + event.durationSeconds > time + 0.005,
  );
}

const MAX_PART_GAIN = decibelsToGain(MAX_PART_DECIBELS);

export class MuseScorePlayer {
  constructor({ onStateChange = () => {}, onProgress = () => {} } = {}) {
    this.onStateChange = onStateChange;
    this.onProgress = onProgress;
    this.context = null;
    this.master = null;
    this.compressor = null;
    this.analyser = null;
    this.frequencyData = null;
    this.voiceWave = null;
    this.score = null;
    this.enabledParts = new Set();
    this.partVolumes = new Map();
    this.partGains = new Map();
    this.looping = true;
    this.playing = false;
    this.position = 0;
    this.startedAt = 0;
    this.nextEventIndex = 0;
    this.scheduler = null;
    this.nodes = new Set();
    this.previewNodes = new Set();
    this.previewGeneration = 0;
    this.playGeneration = 0;
  }

  load(score) {
    this.stop();
    for (const gain of this.partGains.values()) {
      gain.disconnect();
    }
    this.partGains.clear();
    this.score = score;
    this.enabledParts = new Set(score.parts.map((part) => part.id));
    this.partVolumes = new Map(
      score.parts.map((part) => [part.id, 1]),
    );
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
      this.partGains.clear();
      this.master = this.context.createGain();
      this.compressor = this.context.createDynamicsCompressor();
      this.analyser = this.context.createAnalyser();
      this.master.gain.value = SCORE_MASTER_GAIN;
      this.compressor.threshold.value = -8;
      this.compressor.knee.value = 12;
      this.compressor.ratio.value = 2.5;
      this.compressor.attack.value = 0.003;
      this.compressor.release.value = 0.12;
      this.analyser.fftSize = 256;
      this.analyser.minDecibels = -86;
      this.analyser.maxDecibels = -20;
      this.analyser.smoothingTimeConstant = 0.74;
      this.frequencyData = new Uint8Array(
        this.analyser.frequencyBinCount,
      );
      this.voiceWave = this.context.createPeriodicWave
        ? this.context.createPeriodicWave(
            new Float32Array(6),
            new Float32Array([0, 1, 0.36, 0.18, 0.08, 0.035]),
          )
        : null;
      this.master
        .connect(this.compressor)
        .connect(this.analyser)
        .connect(this.context.destination);
    }
    await this.context.resume();
  }

  outputForPart(partId) {
    let output = this.partGains.get(partId);
    if (!output) {
      output = this.context.createGain();
      output.gain.value = this.getPartVolume(partId);
      output.connect(this.master);
      this.partGains.set(partId, output);
    }
    return output;
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
    const endAt = startAt + Math.max(0.035, audibleDuration) +
      (event.slurToNext ? 0.025 : 0);
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    const node = { oscillator, gain, partId: event.partId };

    // A small harmonic spectrum reads more like a sung vowel than a bare sine.
    // Fall back to triangle on browsers without PeriodicWave support.
    if (this.voiceWave && oscillator.setPeriodicWave) {
      oscillator.setPeriodicWave(this.voiceWave);
    } else {
      oscillator.type = "triangle";
    }
    oscillator.frequency.setValueAtTime(midiToFrequency(event.midi), startAt);

    const peak = 0.52 * event.velocity;
    const attackEnd = Math.min(startAt + 0.015, endAt - 0.012);
    const releaseStart = Math.max(attackEnd, endAt - (event.slurToNext ? 0.025 : 0.07));
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.02, peak), attackEnd);
    gain.gain.exponentialRampToValueAtTime(
      Math.max(0.015, peak * (event.slurToNext ? 0.86 : 0.58)),
      releaseStart,
    );
    gain.gain.exponentialRampToValueAtTime(0.0001, endAt);

    oscillator.connect(gain).connect(this.outputForPart(event.partId));
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

  async preparePreview() {
    if (this.score && !this.playing) await this.ensureContext();
  }

  async previewAt(position, partId) {
    this.stopPreview();
    if (!this.score || this.playing || !this.enabledParts.has(partId)) return false;
    const score = this.score;
    const events = previewEventsAt(score, partId, position);
    if (!events.length) return false;
    const generation = this.previewGeneration;

    await this.ensureContext();
    if (generation !== this.previewGeneration || this.playing || this.score !== score) {
      return false;
    }

    const now = this.context.currentTime;
    const peakScale = 0.52 / Math.sqrt(events.length);
    for (const event of events) {
      const oscillator = this.context.createOscillator();
      const gain = this.context.createGain();
      const node = { oscillator, gain, partId };
      if (this.voiceWave && oscillator.setPeriodicWave) {
        oscillator.setPeriodicWave(this.voiceWave);
      } else {
        oscillator.type = "triangle";
      }
      oscillator.frequency.setValueAtTime(midiToFrequency(event.midi), now);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(
        Math.max(0.02, peakScale * event.velocity),
        now + 0.018,
      );
      oscillator.connect(gain).connect(this.outputForPart(partId));
      oscillator.addEventListener("ended", () => {
        gain.disconnect();
        this.previewNodes.delete(node);
      }, { once: true });
      this.previewNodes.add(node);
      oscillator.start(now);
    }
    return true;
  }

  stopPreview(immediate = false) {
    this.previewGeneration += 1;
    const now = this.context?.currentTime ?? 0;
    for (const node of this.previewNodes) {
      node.gain.gain.cancelScheduledValues(now);
      if (immediate) {
        node.gain.gain.setValueAtTime(0.0001, now);
      } else {
        node.gain.gain.setValueAtTime(node.gain.gain.value, now);
        node.gain.gain.setTargetAtTime(0.0001, now, 0.012);
      }
      try {
        node.oscillator.stop(immediate ? now : now + 0.06);
      } catch {
        // Already stopped.
      }
    }
  }

  async play() {
    if (!this.score || this.playing) {
      return;
    }
    const score = this.score;
    const generation = this.playGeneration;
    await this.ensureContext();
    if (this.score !== score || this.playGeneration !== generation || this.playing) {
      return;
    }
    this.stopPreview(true);

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
    this.playGeneration += 1;
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

  async suspendAudio() {
    this.stopPreview(true);
    if (this.context?.state === "running") {
      await this.context.suspend();
    }
  }

  finish() {
    if (this.looping && this.score && this.context) {
      this.stopNodes();
      this.position = 0;
      this.startedAt = this.context.currentTime;
      this.nextEventIndex = this.findEventIndex(0);
      this.scheduleUpcoming();
      return;
    }

    this.playing = false;
    this.position = this.score?.duration ?? 0;
    window.clearInterval(this.scheduler);
    this.scheduler = null;
    this.stopNodes();
    this.onProgress(this.position, this.score?.duration ?? 0);
    this.onStateChange(false);
  }

  stop() {
    this.playGeneration += 1;
    this.stopPreview(true);
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
    this.stopPreview(true);
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
      if ([...this.previewNodes].some((node) => node.partId === partId)) {
        this.stopPreview(true);
      }
    }

    if (this.playing) {
      const position = this.currentPosition();
      this.stopNodes();
      this.nextEventIndex = this.findEventIndex(position);
      this.scheduleUpcoming();
    }
  }

  setLooping(looping) {
    this.looping = Boolean(looping);
  }

  getPartVolume(partId) {
    return this.partVolumes.get(partId) ?? 1;
  }

  setPartVolume(partId, volume) {
    if (!this.score?.parts.some((part) => part.id === partId)) {
      return;
    }
    const nextVolume = clamp(Number(volume) || 0, 0, MAX_PART_GAIN);
    this.partVolumes.set(partId, nextVolume);

    const output = this.partGains.get(partId);
    if (output && this.context) {
      const now = this.context.currentTime;
      output.gain.cancelScheduledValues(now);
      output.gain.setTargetAtTime(nextVolume, now, 0.018);
    }
  }

  visualizationLevels(count = 21) {
    const bandCount = Math.max(1, Math.round(count));
    const levels = Array.from({ length: bandCount }, () => 0);
    const sampleRate = this.context?.sampleRate ?? 48000;
    const nyquist = sampleRate / 2;
    const minimumFrequency = 70;
    const maximumFrequency = Math.min(3200, nyquist);

    if (this.analyser && this.frequencyData) {
      this.analyser.getByteFrequencyData(this.frequencyData);
      for (let index = 0; index < bandCount; index += 1) {
        const startRatio = index / bandCount;
        const endRatio = (index + 1) / bandCount;
        const startFrequency =
          minimumFrequency *
          (maximumFrequency / minimumFrequency) ** startRatio;
        const endFrequency =
          minimumFrequency *
          (maximumFrequency / minimumFrequency) ** endRatio;
        const startBin = clamp(
          Math.floor(
            (startFrequency / nyquist) * this.frequencyData.length,
          ),
          0,
          this.frequencyData.length - 1,
        );
        const endBin = clamp(
          Math.ceil(
            (endFrequency / nyquist) * this.frequencyData.length,
          ),
          startBin + 1,
          this.frequencyData.length,
        );

        let peak = 0;
        let total = 0;
        for (let bin = startBin; bin < endBin; bin += 1) {
          const value = this.frequencyData[bin] / 255;
          peak = Math.max(peak, value);
          total += value;
        }
        const average = total / Math.max(1, endBin - startBin);
        levels[index] = clamp(
          (peak * 0.68 + average * 0.32) ** 0.72,
          0,
          1,
        );
      }
    }

    if (!this.playing || !this.score) {
      return levels;
    }

    const position = this.currentPosition();
    const frequencySpan = Math.log(maximumFrequency / minimumFrequency);
    for (const event of this.score.events) {
      if (event.startSeconds > position + 0.06) {
        break;
      }
      const eventEnd = event.startSeconds + event.durationSeconds;
      if (
        eventEnd <= position ||
        !this.enabledParts.has(event.partId)
      ) {
        continue;
      }

      const elapsed = Math.max(0, position - event.startSeconds);
      const remaining = Math.max(0, eventEnd - position);
      const envelope =
        Math.min(1, elapsed / 0.055 + 0.24) *
        Math.min(1, remaining / 0.12);
      const energy = clamp(
        event.velocity * this.getPartVolume(event.partId) * envelope,
        0,
        1,
      );
      const frequency = midiToFrequency(event.midi);
      const center =
        (Math.log(frequency / minimumFrequency) / frequencySpan) *
        (bandCount - 1);

      for (let index = 0; index < bandCount; index += 1) {
        const distance = index - center;
        const contribution =
          energy * Math.exp(-(distance * distance) / 2.8);
        levels[index] = clamp(
          Math.max(levels[index], contribution),
          0,
          1,
        );
      }
    }
    return levels;
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
