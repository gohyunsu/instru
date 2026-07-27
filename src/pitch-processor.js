import { detectPitch } from "./pitch-core.js";

class PitchProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.downsampleFactor = 2;
    this.analysisSampleRate = sampleRate / this.downsampleFactor;
    this.frame = new Float32Array(2048);
    this.writeIndex = 0;
    this.filledSamples = 0;
    this.samplesSinceAnalysis = 0;
    this.decimationSample = 0;
    this.decimationCount = 0;
    this.enabled = true;

    this.port.onmessage = ({ data }) => {
      if (data?.type === "enabled") {
        this.enabled = Boolean(data.value);
      }
    };
  }

  addSample(sample) {
    this.decimationSample += sample;
    this.decimationCount += 1;

    if (this.decimationCount < this.downsampleFactor) {
      return;
    }

    this.frame[this.writeIndex] = this.decimationSample / this.decimationCount;
    this.writeIndex = (this.writeIndex + 1) % this.frame.length;
    this.filledSamples = Math.min(this.frame.length, this.filledSamples + 1);
    this.samplesSinceAnalysis += 1;
    this.decimationSample = 0;
    this.decimationCount = 0;
  }

  copyFrame() {
    const ordered = new Float32Array(this.frame.length);
    const firstLength = this.frame.length - this.writeIndex;
    ordered.set(this.frame.subarray(this.writeIndex), 0);
    ordered.set(this.frame.subarray(0, this.writeIndex), firstLength);
    return ordered;
  }

  process(inputs, outputs) {
    const output = outputs[0];
    if (output) {
      for (const channel of output) {
        channel.fill(0);
      }
    }

    const input = inputs[0]?.[0];
    if (!input || !this.enabled) {
      return true;
    }

    for (let index = 0; index < input.length; index += 1) {
      this.addSample(input[index]);
    }

    const analysisInterval = Math.floor(this.analysisSampleRate / 20);
    if (
      this.filledSamples === this.frame.length &&
      this.samplesSinceAnalysis >= analysisInterval
    ) {
      this.samplesSinceAnalysis = 0;
      const result = detectPitch(this.copyFrame(), this.analysisSampleRate);
      this.port.postMessage({
        ...result,
        audioTime: currentTime,
      });
    }

    return true;
  }
}

registerProcessor("pitch-processor", PitchProcessor);
