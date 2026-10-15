import { formatNote, midiToFrequency, midiToNote } from "./music.js";

export const PIANO_LOW_MIDI = 21;
export const PIANO_HIGH_MIDI = 108;
export const PIANO_WHITE_KEY_WIDTH = 42;

const BLACK_PITCH_CLASSES = new Set([1, 3, 6, 8, 10]);

export const pianoWhiteKeys = Array.from(
  { length: PIANO_HIGH_MIDI - PIANO_LOW_MIDI + 1 },
  (_, index) => PIANO_LOW_MIDI + index,
).filter((midi) => !BLACK_PITCH_CLASSES.has(midi % 12));

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

export function whiteIndexForMidi(midi) {
  return pianoWhiteKeys.reduce((index, key) => index + Number(key < midi), 0);
}

export class PianoTonePlayer {
  constructor() {
    this.context = null;
    this.master = null;
    this.wave = null;
    this.requests = new Map();
    this.voices = new Map();
  }

  async ensureContext() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error("UNSUPPORTED");
    if (!this.context || this.context.state === "closed") {
      this.context = new AudioContextClass({ latencyHint: "interactive" });
      this.master = this.context.createGain();
      this.master.gain.value = 0.45;
      this.master.connect(this.context.destination);
      this.wave = this.context.createPeriodicWave?.(
        new Float32Array(6),
        new Float32Array([0, 1, 0.24, 0.1, 0.045, 0.02]),
      ) ?? null;
    }
    await this.context.resume();
  }

  async press(midi, token) {
    this.release(token);
    const request = { midi };
    this.requests.set(token, request);
    try {
      await this.ensureContext();
    } catch (error) {
      if (this.requests.get(token) === request) this.requests.delete(token);
      throw error;
    }
    if (this.requests.get(token) !== request) return false;

    const now = this.context.currentTime;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    if (this.wave && oscillator.setPeriodicWave) {
      oscillator.setPeriodicWave(this.wave);
    } else {
      oscillator.type = "triangle";
    }
    oscillator.frequency.setValueAtTime(midiToFrequency(midi), now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.22, now + 0.009);
    gain.gain.exponentialRampToValueAtTime(0.075, now + 0.42);
    oscillator.connect(gain).connect(this.master);
    oscillator.addEventListener("ended", () => gain.disconnect(), { once: true });
    this.voices.set(token, { oscillator, gain });
    oscillator.start(now);
    return true;
  }

  release(token) {
    this.requests.delete(token);
    const voice = this.voices.get(token);
    if (!voice) return;
    this.voices.delete(token);
    const now = this.context.currentTime;
    voice.gain.gain.cancelScheduledValues(now);
    voice.gain.gain.setValueAtTime(Math.max(0.0001, voice.gain.gain.value), now);
    voice.gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);
    try {
      voice.oscillator.stop(now + 0.1);
    } catch {
      // A voice may already have stopped during a browser audio reset.
    }
  }

  stopAll() {
    for (const token of this.requests.keys()) this.release(token);
  }

  async suspend() {
    this.stopAll();
    if (this.context?.state === "running") await this.context.suspend();
  }
}

export class PianoKeyboard {
  constructor({ viewport, keys, map, mapKeys, selection, rangeLabel, onNotesChange }) {
    this.viewport = viewport;
    this.keys = keys;
    this.map = map;
    this.mapKeys = mapKeys;
    this.selection = selection;
    this.rangeLabel = rangeLabel;
    this.onNotesChange = onNotesChange;
    this.audio = new PianoTonePlayer();
    this.presses = new Map();
    this.keyButtons = new Map();
    this.centerMidi = 60;
    this.orientation = this.isPortrait();
    this.mapPointer = null;
    this.mapOffset = 0;
    this.renderKeys();

    this.viewport.addEventListener("scroll", () => this.updateRange(), { passive: true });
    this.map.addEventListener("pointerdown", (event) => this.startMapDrag(event));
    this.map.addEventListener("pointermove", (event) => this.moveMapDrag(event));
    this.map.addEventListener("keydown", (event) => {
      const step = {
        ArrowLeft: -1,
        ArrowDown: -1,
        ArrowRight: 1,
        ArrowUp: 1,
        PageDown: -12,
        PageUp: 12,
      }[event.key];
      if (step === undefined && event.key !== "Home" && event.key !== "End") return;
      event.preventDefault();
      const midi = event.key === "Home" ? PIANO_LOW_MIDI
        : event.key === "End" ? PIANO_HIGH_MIDI
          : clamp(this.centerMidi + step, PIANO_LOW_MIDI, PIANO_HIGH_MIDI);
      this.scrollToMidi(midi);
      this.updateRange();
    });
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
      this.map.addEventListener(type, (event) => {
        if (event.pointerId === this.mapPointer) this.mapPointer = null;
      });
    }
    window.addEventListener("resize", () => this.refresh());
    window.addEventListener("blur", () => this.stopAll());
  }

  isPortrait() {
    return window.matchMedia("(orientation: portrait)").matches;
  }

  renderKeys() {
    const whiteButtons = [];
    const blackButtons = [];
    for (let midi = PIANO_LOW_MIDI; midi <= PIANO_HIGH_MIDI; midi += 1) {
      const black = BLACK_PITCH_CLASSES.has(midi % 12);
      const button = document.createElement("button");
      button.type = "button";
      button.className = `piano-key ${black ? "piano-key-black" : "piano-key-white"}`;
      button.dataset.midi = String(midi);
      button.setAttribute("aria-label", `${formatNote(midi)} piano key`);
      button.style.setProperty(
        black ? "--black-index" : "--white-index",
        String(black ? whiteIndexForMidi(midi) : pianoWhiteKeys.indexOf(midi)),
      );
      const note = midiToNote(midi);
      if (!black && (note.name === "C" || midi === PIANO_LOW_MIDI)) {
        const label = document.createElement("span");
        label.className = "piano-key-label";
        label.textContent = formatNote(midi);
        button.append(label);
      }
      button.addEventListener("pointerdown", (event) => {
        if (event.pointerType === "mouse" && event.button !== 0) return;
        event.preventDefault();
        button.setPointerCapture?.(event.pointerId);
        this.press(button, event.pointerId);
      });
      for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
        button.addEventListener(type, (event) => this.release(event.pointerId));
      }
      button.addEventListener("keydown", (event) => {
        if (event.key !== " " && event.key !== "Enter") return;
        event.preventDefault();
        if (!event.repeat) this.press(button, `keyboard-${midi}`);
      });
      button.addEventListener("keyup", (event) => {
        if (event.key === " " || event.key === "Enter") {
          event.preventDefault();
          this.release(`keyboard-${midi}`);
        }
      });
      button.addEventListener("blur", () => this.release(`keyboard-${midi}`));
      this.keyButtons.set(midi, button);
      (black ? blackButtons : whiteButtons).push(button);
    }
    this.keys.replaceChildren(...whiteButtons, ...blackButtons);
    this.mapKeys.replaceChildren(...pianoWhiteKeys.map((midi) => {
      const mark = document.createElement("span");
      mark.className = midiToNote(midi).name === "C"
        ? "piano-map-key is-c"
        : "piano-map-key";
      return mark;
    }));
  }

  press(button, token) {
    this.release(token);
    const midi = Number(button.dataset.midi);
    const press = { button, midi };
    this.presses.set(token, press);
    button.classList.add("is-down");
    this.onNotesChange?.(this.activeNotes());
    this.audio.press(midi, token).catch(() => {
      if (this.presses.get(token) === press) this.release(token);
    });
  }

  release(token) {
    const press = this.presses.get(token);
    if (!press) return;
    this.presses.delete(token);
    this.audio.release(token);
    if (![...this.presses.values()].some((other) => other.button === press.button)) {
      press.button.classList.remove("is-down");
    }
    this.onNotesChange?.(this.activeNotes());
  }

  activeNotes() {
    return [...new Set([...this.presses.values()].map((press) => press.midi))];
  }

  stopAll() {
    for (const token of this.presses.keys()) this.release(token);
    this.audio.stopAll();
    this.mapPointer = null;
  }

  suspend() {
    this.stopAll();
    return this.audio.suspend();
  }

  refresh() {
    if (!this.viewport.clientWidth || !this.viewport.clientHeight) return;
    const portrait = this.isPortrait();
    const changed = portrait !== this.orientation;
    this.orientation = portrait;
    if (changed || !this.initialized) {
      this.scrollToMidi(this.centerMidi);
      this.initialized = true;
    }
    this.updateRange();
  }

  scrollToMidi(midi) {
    const index = clamp(whiteIndexForMidi(midi), 0, pianoWhiteKeys.length - 1);
    const total = pianoWhiteKeys.length * PIANO_WHITE_KEY_WIDTH;
    if (this.orientation) {
      this.viewport.scrollTop = total - (index + 0.5) * PIANO_WHITE_KEY_WIDTH -
        this.viewport.clientHeight / 2;
    } else {
      this.viewport.scrollLeft = (index + 0.5) * PIANO_WHITE_KEY_WIDTH -
        this.viewport.clientWidth / 2;
    }
  }

  updateRange() {
    if (!this.viewport.clientWidth || !this.viewport.clientHeight) return;
    const portrait = this.orientation;
    const size = portrait ? this.viewport.clientHeight : this.viewport.clientWidth;
    const total = pianoWhiteKeys.length * PIANO_WHITE_KEY_WIDTH;
    const scroll = portrait ? this.viewport.scrollTop : this.viewport.scrollLeft;
    const first = clamp(Math.floor((portrait ? total - scroll - size : scroll) /
      PIANO_WHITE_KEY_WIDTH), 0, pianoWhiteKeys.length - 1);
    const last = clamp(Math.ceil((portrait ? total - scroll : scroll + size) /
      PIANO_WHITE_KEY_WIDTH) - 1, first, pianoWhiteKeys.length - 1);
    this.rangeLabel.textContent = `${formatNote(pianoWhiteKeys[first])}–${formatNote(pianoWhiteKeys[last])}`;
    this.centerMidi = pianoWhiteKeys[Math.round((first + last) / 2)];
    this.map.setAttribute("aria-valuenow", String(this.centerMidi));
    this.map.setAttribute("aria-valuetext", this.rangeLabel.textContent);

    const fraction = clamp(size / total, 0, 1);
    const start = clamp(scroll / total, 0, 1 - fraction);
    this.selection.style.left = portrait ? "" : `${start * 100}%`;
    this.selection.style.width = portrait ? "" : `${fraction * 100}%`;
    this.selection.style.top = portrait ? `${start * 100}%` : "";
    this.selection.style.height = portrait ? `${fraction * 100}%` : "";
  }

  mapPosition(event) {
    const rect = this.map.getBoundingClientRect();
    const coordinate = this.orientation ? event.clientY - rect.top : event.clientX - rect.left;
    const dimension = this.orientation ? rect.height : rect.width;
    return clamp(coordinate / dimension, 0, 1);
  }

  startMapDrag(event) {
    if (this.mapPointer !== null || (event.pointerType === "mouse" && event.button !== 0)) return;
    event.preventDefault();
    this.mapPointer = event.pointerId;
    this.map.setPointerCapture?.(event.pointerId);
    const fraction = (this.orientation ? this.viewport.clientHeight : this.viewport.clientWidth) /
      (pianoWhiteKeys.length * PIANO_WHITE_KEY_WIDTH);
    const start = this.orientation ? this.viewport.scrollTop /
      (pianoWhiteKeys.length * PIANO_WHITE_KEY_WIDTH) : this.viewport.scrollLeft /
      (pianoWhiteKeys.length * PIANO_WHITE_KEY_WIDTH);
    const position = this.mapPosition(event);
    this.mapOffset = position >= start && position <= start + fraction
      ? position - start
      : fraction / 2;
    this.moveMapDrag(event);
  }

  moveMapDrag(event) {
    if (event.pointerId !== this.mapPointer) return;
    const total = pianoWhiteKeys.length * PIANO_WHITE_KEY_WIDTH;
    const size = this.orientation ? this.viewport.clientHeight : this.viewport.clientWidth;
    const next = clamp((this.mapPosition(event) - this.mapOffset) * total, 0, total - size);
    if (this.orientation) this.viewport.scrollTop = next;
    else this.viewport.scrollLeft = next;
    this.updateRange();
  }
}
