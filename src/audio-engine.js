export class PitchAudioEngine {
  constructor(onMeasurement, onStreamEnded = () => {}) {
    this.onMeasurement = onMeasurement;
    this.onStreamEnded = onStreamEnded;
    this.context = null;
    this.stream = null;
    this.source = null;
    this.processor = null;
    this.silentGain = null;
    this.stopping = false;
  }

  get active() {
    return Boolean(this.stream);
  }

  async start() {
    if (this.active) {
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("UNSUPPORTED");
    }

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: { ideal: 1 },
        echoCancellation: { ideal: false },
        noiseSuppression: { ideal: false },
        autoGainControl: { ideal: false },
      },
      video: false,
    });
    this.stream.getAudioTracks().forEach((track) => {
      track.addEventListener(
        "ended",
        () => {
          if (!this.stopping) {
            this.onStreamEnded();
          }
        },
        { once: true },
      );
    });

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass || !window.AudioWorkletNode) {
      this.stopTracks();
      throw new Error("UNSUPPORTED");
    }

    try {
      this.context = new AudioContextClass({ latencyHint: "interactive" });
      await this.context.audioWorklet.addModule(
        new URL("./pitch-processor.js", import.meta.url),
      );

      this.source = this.context.createMediaStreamSource(this.stream);
      this.processor = new AudioWorkletNode(this.context, "pitch-processor", {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
      });
      this.silentGain = this.context.createGain();
      this.silentGain.gain.value = 0;
      this.processor.port.onmessage = ({ data }) => this.onMeasurement(data);

      this.source
        .connect(this.processor)
        .connect(this.silentGain)
        .connect(this.context.destination);

      this.context.resume().catch(() => {
        // Mobile browsers can require the next page interaction before resuming.
      });
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  setProcessing(enabled) {
    this.processor?.port.postMessage({ type: "enabled", value: enabled });
  }

  async resume() {
    if (this.context?.state === "suspended") {
      await this.context.resume();
    }
  }

  stopTracks() {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
  }

  async stop() {
    this.stopping = true;
    this.stopTracks();
    this.source?.disconnect();
    this.processor?.disconnect();
    this.silentGain?.disconnect();
    this.source = null;
    this.processor = null;
    this.silentGain = null;

    if (this.context && this.context.state !== "closed") {
      await this.context.close();
    }
    this.context = null;
    this.stopping = false;
  }
}

export class ReferenceTonePlayer {
  constructor(onStateChange = () => {}) {
    this.onStateChange = onStateChange;
    this.context = null;
    this.oscillator = null;
    this.gain = null;
    this.stopTimer = null;
  }

  async ensureContext() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      throw new Error("UNSUPPORTED");
    }
    if (!this.context || this.context.state === "closed") {
      this.context = new AudioContextClass({ latencyHint: "interactive" });
    }
    await this.context.resume();
  }

  async play(frequency, duration = 0.9) {
    await this.ensureContext();
    this.stop(false);

    const now = this.context.currentTime;
    const releaseAt = now + duration;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();

    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.13, now + 0.025);
    gain.gain.setValueAtTime(0.13, Math.max(now + 0.03, releaseAt - 0.08));
    gain.gain.exponentialRampToValueAtTime(0.0001, releaseAt);

    oscillator.connect(gain).connect(this.context.destination);
    oscillator.start(now);
    oscillator.stop(releaseAt + 0.025);

    this.oscillator = oscillator;
    this.gain = gain;
    this.onStateChange(true);
    this.stopTimer = window.setTimeout(() => this.stop(), (duration + 0.04) * 1000);
  }

  stop(announce = true) {
    if (this.stopTimer) {
      window.clearTimeout(this.stopTimer);
      this.stopTimer = null;
    }

    if (this.oscillator) {
      try {
        const now = this.context.currentTime;
        this.gain.gain.cancelScheduledValues(now);
        this.gain.gain.setTargetAtTime(0.0001, now, 0.012);
        this.oscillator.stop(now + 0.06);
      } catch {
        // The oscillator may already have stopped naturally.
      }
      this.oscillator = null;
      this.gain = null;
    }

    if (announce) {
      this.onStateChange(false);
    }
  }
}
