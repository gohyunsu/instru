const CARRIER_SAMPLE_RATE = 8000;
const CARRIER_SECONDS = 6;

// Android grants media focus to a playing media element, not Web Audio alone.
// This silent clip carries transport controls while the score remains Web Audio.
export function createMediaCarrierWav() {
  const sampleBytes = CARRIER_SAMPLE_RATE * CARRIER_SECONDS * 2;
  const bytes = new Uint8Array(44 + sampleBytes);
  const view = new DataView(bytes.buffer);
  const writeText = (offset, value) => {
    for (let index = 0; index < value.length; index += 1) {
      bytes[offset + index] = value.charCodeAt(index);
    }
  };
  writeText(0, "RIFF");
  view.setUint32(4, bytes.length - 8, true);
  writeText(8, "WAVE");
  writeText(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, CARRIER_SAMPLE_RATE, true);
  view.setUint32(28, CARRIER_SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeText(36, "data");
  view.setUint32(40, sampleBytes, true);
  return new Blob([bytes], { type: "audio/wav" });
}

export class ScoreMediaSession {
  constructor({
    session = globalThis.navigator?.mediaSession,
    Metadata = globalThis.MediaMetadata,
    createAudio = () => document.createElement("audio"),
    createObjectURL = (blob) => URL.createObjectURL(blob),
    host = globalThis.document?.body,
    onPlay = () => {},
    onPause = () => {},
    onStop = () => {},
  } = {}) {
    this.session = typeof session?.setActionHandler === "function" ? session : null;
    this.Metadata = Metadata;
    this.createAudio = createAudio;
    this.createObjectURL = createObjectURL;
    this.host = host;
    this.onPlay = onPlay;
    this.onPause = onPause;
    this.onStop = onStop;
    this.audio = null;
    this.title = null;
    this.duration = 0;
    this.playing = false;
    this.carrierGeneration = 0;
    this.lastReportedSecond = -1;

    if (this.session) {
      for (const [action, handler] of [
        ["play", () => this.onPlay()],
        ["pause", () => this.onPause()],
        ["stop", () => this.onStop()],
      ]) {
        try {
          this.session.setActionHandler(action, handler);
        } catch {
          // A browser may support Media Session but omit an individual action.
        }
      }
    }
  }

  setScore(title, duration, position = 0) {
    if (!this.session) return;
    this.title = title;
    this.duration = duration;
    this.lastReportedSecond = -1;
    if (this.Metadata) {
      try {
        this.session.metadata = new this.Metadata({
          title,
          artist: "Instru",
          album: "Practice room",
        });
      } catch {
        // Metadata is optional on browsers with partial Media Session support.
      }
    }
    this.session.playbackState = "paused";
    this.updatePosition(position);
  }

  ensureAudio() {
    if (this.audio) return this.audio;
    const audio = this.createAudio();
    audio.hidden = true;
    audio.loop = true;
    audio.preload = "auto";
    audio.playsInline = true;
    audio.src = this.createObjectURL(createMediaCarrierWav());
    audio.addEventListener("pause", () => {
      if (this.playing) this.onPause();
    });
    this.host?.append(audio);
    this.audio = audio;
    return audio;
  }

  start() {
    if (!this.session || !this.title || this.playing) return;
    const generation = ++this.carrierGeneration;
    this.playing = true;
    this.session.playbackState = "playing";
    try {
      const attempt = this.ensureAudio().play();
      attempt?.catch(() => {
        if (generation === this.carrierGeneration) this.playing = false;
      });
    } catch {
      if (generation === this.carrierGeneration) this.playing = false;
    }
  }

  pause() {
    this.carrierGeneration += 1;
    this.playing = false;
    this.audio?.pause();
    if (this.session) {
      this.session.playbackState = this.title ? "paused" : "none";
    }
  }

  deactivate() {
    this.pause();
    this.title = null;
    this.duration = 0;
    this.lastReportedSecond = -1;
    if (this.session) {
      this.session.metadata = null;
      this.session.playbackState = "none";
    }
  }

  updatePosition(position) {
    if (!this.session?.setPositionState || !this.duration) return;
    const safePosition = Math.max(0, Math.min(this.duration, position));
    const second = Math.floor(safePosition);
    if (second === this.lastReportedSecond) return;
    this.lastReportedSecond = second;
    try {
      this.session.setPositionState({
        duration: this.duration,
        position: safePosition,
        playbackRate: 1,
      });
    } catch {
      // Position display is optional; transport buttons still work.
    }
  }
}
