function median(values) {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.floor(ordered.length / 2)];
}

/**
 * Keeps the continuous pitch responsive while making the displayed semitone
 * resistant to isolated spikes and boundary chatter.
 */
export class PitchStabilizer {
  constructor({
    historySize = 5,
    switchFrames = 3,
    switchThreshold = 0.58,
    slowSmoothing = 0.28,
    fastSmoothing = 0.48,
  } = {}) {
    this.historySize = historySize;
    this.switchFrames = switchFrames;
    this.switchThreshold = switchThreshold;
    this.slowSmoothing = slowSmoothing;
    this.fastSmoothing = fastSmoothing;
    this.reset();
  }

  reset() {
    this.history = [];
    this.filteredMidi = null;
    this.noteMidi = null;
    this.candidateNote = null;
    this.candidateFrames = 0;
  }

  update(midi) {
    if (!Number.isFinite(midi)) {
      return null;
    }

    this.history.push(midi);
    if (this.history.length > this.historySize) {
      this.history.shift();
    }

    const robustMidi = median(this.history);
    if (this.filteredMidi === null) {
      this.filteredMidi = robustMidi;
      this.noteMidi = Math.round(robustMidi);
    } else {
      const distance = Math.abs(robustMidi - this.filteredMidi);
      const smoothing =
        distance > 0.32 ? this.fastSmoothing : this.slowSmoothing;
      this.filteredMidi += (robustMidi - this.filteredMidi) * smoothing;
    }

    const nearestNote = Math.round(this.filteredMidi);
    const distanceFromLockedNote = Math.abs(
      this.filteredMidi - this.noteMidi,
    );

    if (
      nearestNote === this.noteMidi ||
      distanceFromLockedNote < this.switchThreshold
    ) {
      this.candidateNote = null;
      this.candidateFrames = 0;
    } else {
      if (this.candidateNote === nearestNote) {
        this.candidateFrames += 1;
      } else {
        this.candidateNote = nearestNote;
        this.candidateFrames = 1;
      }

      if (this.candidateFrames >= this.switchFrames) {
        this.noteMidi = nearestNote;
        this.candidateNote = null;
        this.candidateFrames = 0;
      }
    }

    return {
      midi: this.filteredMidi,
      noteMidi: this.noteMidi,
      cents: (this.filteredMidi - this.noteMidi) * 100,
    };
  }
}
