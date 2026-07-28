import { PitchAudioEngine, ReferenceTonePlayer } from "./audio-engine.js";
import {
  EXACT_CENTS,
  describeCents,
  formatCents,
  formatNote,
  frequencyToMidi,
  measurementFromMidi,
  midiToFrequency,
  midiToNote,
} from "./music.js";
import { readMuseScoreFile } from "./musescore-parser.js";
import { VerticalPitchGraph } from "./pitch-graph.js";
import { PitchStabilizer } from "./pitch-stabilizer.js";
import { measureIndexAtPosition } from "./score-lyrics.js";
import { LiveScoreNotation } from "./score-notation.js";
import {
  decibelsToGain,
  MuseScorePlayer,
} from "./score-player.js";

const PART_VOLUME_MIN_DB = -42;
const PART_VOLUME_MAX_DB = 15;

const elements = {
  themeToggle: document.querySelector("#themeToggle"),
  listeningStatus: document.querySelector("#listeningStatus"),
  statusLabel: document.querySelector("#statusLabel"),
  modeButtons: [...document.querySelectorAll(".mode-button")],
  tunerView: document.querySelector("#tunerView"),
  scoreView: document.querySelector("#scoreView"),
  pitchSummary: document.querySelector("#pitchSummary"),
  pitchGraph: document.querySelector("#pitchGraph"),
  pitchNote: document.querySelector("#pitchNote"),
  pitchLetter: document.querySelector("#pitchLetter"),
  pitchOctave: document.querySelector("#pitchOctave"),
  deviationLine: document.querySelector("#deviationLine"),
  deviationValue: document.querySelector("#deviationValue"),
  deviationCopy: document.querySelector("#deviationCopy"),
  pitchMessage: document.querySelector("#pitchMessage"),
  screenReaderStatus: document.querySelector("#screenReaderStatus"),
  canvas: document.querySelector("#pitchCanvas"),
  graphEmpty: document.querySelector("#graphEmpty"),
  graphEmptyText: document.querySelector("#graphEmptyText"),
  referenceButtons: [...document.querySelectorAll(".note-button")],
  helperMessage: document.querySelector("#helperMessage"),
  scoreLibrary: document.querySelector(".score-library"),
  libraryCount: document.querySelector("#libraryCount"),
  libraryList: document.querySelector("#libraryList"),
  scoreImport: document.querySelector("#scoreImport"),
  scoreFileInput: document.querySelector("#scoreFileInput"),
  selectScoreButton: document.querySelector("#selectScoreButton"),
  scorePlayerPanel: document.querySelector("#scorePlayerPanel"),
  replaceScoreButton: document.querySelector("#replaceScoreButton"),
  scoreTitle: document.querySelector("#scoreTitle"),
  scoreMeta: document.querySelector("#scoreMeta"),
  liveScorePanel: document.querySelector("#liveScorePanel"),
  scoreNotation: document.querySelector("#scoreNotation"),
  scoreNotationCount: document.querySelector("#scoreNotationCount"),
  scoreMeasureInput: document.querySelector("#scoreMeasureInput"),
  scoreMeasureTotal: document.querySelector("#scoreMeasureTotal"),
  playbackVisualizer: document.querySelector("#playbackVisualizer"),
  scorePlayButton: document.querySelector("#scorePlayButton"),
  scoreLoopButton: document.querySelector("#scoreLoopButton"),
  scoreProgress: document.querySelector("#scoreProgress"),
  scoreCurrentTime: document.querySelector("#scoreCurrentTime"),
  scoreDuration: document.querySelector("#scoreDuration"),
  partList: document.querySelector("#partList"),
  scoreMessage: document.querySelector("#scoreMessage"),
};

const graph = new VerticalPitchGraph(elements.canvas);
const state = {
  mode: "tuner",
  listening: false,
  starting: false,
  playingTone: false,
  activeToneButton: null,
  referenceMidi: 69,
  currentMidi: null,
  lastVoicedAt: 0,
  lastAnnouncementAt: 0,
  waitingTimer: null,
  wakeLock: null,
  reconnectTimer: null,
  unloading: false,
  exactSince: null,
  accuracyLocked: false,
  score: null,
  scoreLoading: false,
  scrubbing: false,
  selectedPartId: null,
};

const audioEngine = new PitchAudioEngine(
  handleAudioMeasurement,
  handleStreamEnded,
);
const tonePlayer = new ReferenceTonePlayer(handleToneState);
const pitchStabilizer = new PitchStabilizer();
const scoreNotation = new LiveScoreNotation(
  elements.scoreNotation,
  elements.scoreNotationCount,
);
const scorePlayer = new MuseScorePlayer({
  onStateChange: handleScorePlaybackState,
  onProgress: handleScoreProgress,
});
scoreNotation.setSeekHandler((position) => scorePlayer.seek(position));

const visualizerBars = Array.from({ length: 21 }, () => {
  const bar = document.createElement("span");
  bar.className = "visualizer-bar";
  return bar;
});
const visualizerLevels = visualizerBars.map(() => 0);
const silentVisualizerLevels = visualizerBars.map(() => 0);
elements.playbackVisualizer.replaceChildren(...visualizerBars);

function renderPlaybackVisualizer() {
  const targets =
    scorePlayer.playing
      ? scorePlayer.visualizationLevels(visualizerBars.length)
      : silentVisualizerLevels;

  for (let index = 0; index < visualizerBars.length; index += 1) {
    const target = targets[index] ?? 0;
    const response = target > visualizerLevels[index] ? 0.48 : 0.16;
    visualizerLevels[index] +=
      (target - visualizerLevels[index]) * response;
    const level = 0.1 + visualizerLevels[index] * 0.9;
    visualizerBars[index].style.setProperty(
      "--visualizer-level",
      level.toFixed(3),
    );
    visualizerBars[index].style.opacity = String(
      0.28 + visualizerLevels[index] * 0.72,
    );
  }
  requestAnimationFrame(renderPlaybackVisualizer);
}
requestAnimationFrame(renderPlaybackVisualizer);

function formatTime(seconds) {
  const safeSeconds = Math.max(0, Math.floor(seconds || 0));
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function formatFileSize(bytes) {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function currentMeasure(position = 0) {
  if (!state.score?.measures?.length) {
    return null;
  }
  return state.score.measures[
    measureIndexAtPosition(state.score.measures, position)
  ];
}

function updateMeasureNavigation(position = 0) {
  const measure = currentMeasure(position);
  if (
    !measure ||
    document.activeElement === elements.scoreMeasureInput
  ) {
    return;
  }
  elements.scoreMeasureInput.value = String(measure.number);
}

function configureMeasureNavigation(score = null) {
  const measures = score?.measures ?? [];
  const numericNumbers = measures
    .map((measure) => Number(measure.number))
    .filter(Number.isFinite);
  const firstNumber = numericNumbers[0] ?? 1;
  const lastNumber = numericNumbers.at(-1) ?? measures.length;
  elements.scoreMeasureInput.disabled = !measures.length;
  elements.scoreMeasureInput.min = String(
    Math.min(firstNumber, lastNumber),
  );
  elements.scoreMeasureInput.max = String(
    Math.max(firstNumber, lastNumber),
  );
  elements.scoreMeasureInput.value = String(firstNumber);
  elements.scoreMeasureTotal.textContent = `/ ${lastNumber || 0}`;
}

function jumpToMeasure() {
  if (!state.score?.measures?.length) {
    return;
  }
  const requested = Number(elements.scoreMeasureInput.value);
  const measure =
    state.score.measures.find(
      (candidate) => Number(candidate.number) === requested,
    ) ??
    state.score.measures[
      Math.max(0, Math.round(requested) - 1)
    ];

  if (!measure) {
    updateMeasureNavigation(scorePlayer.currentPosition());
    return;
  }
  scorePlayer.seek(measure.startSeconds);
  scoreNotation.render(measure.startSeconds, true);
  elements.scoreMeasureInput.value = String(measure.number);
}

function setStatus(label, status = "ready") {
  elements.statusLabel.textContent = label;
  elements.listeningStatus.dataset.state = status;
}

function setHelper(message, isError = false) {
  elements.helperMessage.textContent = message;
  elements.helperMessage.dataset.state = isError ? "error" : "";
}

function setScoreMessage(message = "", isError = false) {
  elements.scoreMessage.textContent = message;
  elements.scoreMessage.dataset.state = isError ? "error" : "";
}

function setAccuracyLocked(locked) {
  if (state.accuracyLocked === locked) {
    return;
  }
  state.accuracyLocked = locked;
  elements.pitchSummary.classList.toggle("is-locked", locked);
  elements.pitchGraph.classList.toggle("is-locked", locked);

  if (locked && navigator.vibrate) {
    navigator.vibrate(12);
  }
}

function updateAccuracyEffect(cents, now) {
  const exact = Math.abs(cents) <= EXACT_CENTS;
  if (exact) {
    state.exactSince ??= now;
    if (now - state.exactSince >= 320) {
      setAccuracyLocked(true);
    }
  } else if (Math.abs(cents) > EXACT_CENTS + 4) {
    state.exactSince = null;
    setAccuracyLocked(false);
  }
}

function resetPitchSummary(message = "Hold a steady note") {
  state.exactSince = null;
  setAccuracyLocked(false);
  elements.pitchNote.setAttribute("aria-label", "Waiting for pitch");
  elements.pitchLetter.textContent = "—";
  elements.pitchOctave.textContent = "";
  elements.deviationValue.textContent = state.listening
    ? "Listening"
    : state.starting
      ? "Connecting"
      : "Microphone needed";
  elements.deviationCopy.textContent = "";
  elements.deviationLine.dataset.direction = "";
  elements.pitchMessage.textContent = message;
}

function updateReferenceButtons(midi = state.referenceMidi) {
  state.referenceMidi = Math.round(midi);

  for (const button of elements.referenceButtons) {
    const offset = Number(button.dataset.offset);
    const noteMidi = state.referenceMidi + offset;
    const note = midiToNote(noteMidi);
    button.dataset.midi = String(noteMidi);
    button.querySelector(".note-button-name").textContent = note.name;
    button.querySelector(".note-button-octave").textContent = note.octave;
    button.classList.toggle("is-current", offset === 0);
    button.setAttribute("aria-label", `Play ${formatNote(noteMidi)}`);
  }
}

function showMeasurement(measurement, confidence) {
  const description = describeCents(measurement.cents);
  elements.pitchNote.setAttribute("aria-label", measurement.label);
  elements.pitchLetter.textContent = measurement.name;
  elements.pitchOctave.textContent = measurement.octave;
  elements.deviationValue.textContent = formatCents(measurement.cents);
  elements.deviationCopy.textContent =
    description.direction === "exact"
      ? "In tune"
      : description.direction === "high"
        ? "Sharp"
        : "Flat";
  elements.deviationLine.dataset.direction = description.direction;
  elements.pitchMessage.textContent = "";
  elements.graphEmpty.classList.add("is-hidden");
  updateReferenceButtons(measurement.midi);

  const now = performance.now();
  updateAccuracyEffect(measurement.cents, now);
  graph.addPoint({
    time: now,
    cents: measurement.cents,
    note: measurement.midi,
    confidence,
  });

  if (now - state.lastAnnouncementAt > 1800) {
    elements.screenReaderStatus.textContent =
      `${measurement.label}, ${formatCents(measurement.cents)}, ${description.label}`;
    state.lastAnnouncementAt = now;
  }
}

function markWaiting() {
  if (!state.listening || state.playingTone || state.mode !== "tuner") {
    return;
  }

  const silenceDuration = performance.now() - state.lastVoicedAt;
  if (silenceDuration < 360) {
    return;
  }

  state.waitingTimer = null;
  if (state.currentMidi === null) {
    return;
  }

  state.currentMidi = null;
  pitchStabilizer.reset();
  graph.addGap();
  resetPitchSummary();
}

function handleAudioMeasurement({ frequency, confidence = 0, rms = 0 }) {
  if (!state.listening || state.playingTone || state.mode !== "tuner") {
    return;
  }

  if (!frequency || confidence < 0.72 || rms < 0.007) {
    if (!state.waitingTimer) {
      state.waitingTimer = window.setTimeout(markWaiting, 380);
    }
    return;
  }

  const midi = frequencyToMidi(frequency);
  if (midi === null) {
    return;
  }

  window.clearTimeout(state.waitingTimer);
  state.waitingTimer = null;
  state.lastVoicedAt = performance.now();
  const stabilized = pitchStabilizer.update(midi);
  if (!stabilized) {
    return;
  }
  state.currentMidi = stabilized.midi;
  showMeasurement(
    measurementFromMidi(
      stabilized.midi,
      undefined,
      stabilized.noteMidi,
    ),
    confidence,
  );
}

function handleToneState(playing) {
  state.playingTone = playing;
  audioEngine.setProcessing(!playing && state.mode === "tuner");

  if (state.mode !== "tuner") {
    return;
  }
  if (playing) {
    setStatus("Reference tone", "tone");
  } else {
    state.activeToneButton?.classList.remove("is-playing");
    state.activeToneButton = null;
    if (state.listening) {
      setStatus("Listening", "listening");
      state.lastVoicedAt = performance.now();
    } else {
      setStatus("Ready");
    }
  }
}

async function handleReferenceClick(event) {
  const button = event.currentTarget;
  const midi = Number(button.dataset.midi);

  if (button === state.activeToneButton && state.playingTone) {
    tonePlayer.stop();
    return;
  }

  state.activeToneButton?.classList.remove("is-playing");
  state.activeToneButton = button;
  button.classList.add("is-playing");

  try {
    await tonePlayer.play(midiToFrequency(midi));
  } catch {
    button.classList.remove("is-playing");
    state.activeToneButton = null;
    setHelper("Reference tones are not supported in this browser.", true);
  }
}

function microphoneErrorMessage(error) {
  if (error?.message === "UNSUPPORTED") {
    return "Live audio analysis is not supported in this browser.";
  }
  if (error?.name === "NotAllowedError") {
    return "Microphone access is required. Allow it in browser settings.";
  }
  if (error?.name === "NotFoundError") {
    return "No available microphone was found.";
  }
  if (error?.name === "NotReadableError") {
    return "Check whether another app is using the microphone.";
  }
  return "Could not start the microphone. Please try again.";
}

async function startListening() {
  if (state.starting) {
    return;
  }

  state.starting = true;
  if (state.mode === "tuner") {
    setStatus("Connecting", "paused");
    setHelper("Microphone permission required");
    resetPitchSummary("");
  }

  try {
    await audioEngine.start();
    state.listening = true;
    state.lastVoicedAt = performance.now();
    audioEngine.setProcessing(state.mode === "tuner");
    if (state.mode === "tuner") {
      setStatus("Listening", "listening");
      setHelper("");
      resetPitchSummary();
      elements.graphEmptyText.textContent = "Hold a steady note";
    }
    requestWakeLock();
  } catch (error) {
    state.listening = false;
    state.starting = false;
    if (state.mode === "tuner") {
      setStatus("Try again", "error");
      setHelper(microphoneErrorMessage(error), true);
      resetPitchSummary("");
    }
  } finally {
    state.starting = false;
  }
}

async function stopListening() {
  state.listening = false;
  window.clearTimeout(state.waitingTimer);
  tonePlayer.stop();
  await audioEngine.stop();
  state.currentMidi = null;
  pitchStabilizer.reset();
  graph.clear();
  if (state.wakeLock) {
    state.wakeLock.release().catch(() => {});
    state.wakeLock = null;
  }
  elements.graphEmpty.classList.remove("is-hidden");
  if (state.mode === "tuner") {
    setStatus("Connecting", "paused");
    setHelper("");
    resetPitchSummary("");
  }
}

async function handleStreamEnded() {
  if (state.unloading) {
    return;
  }

  await stopListening();
  window.clearTimeout(state.reconnectTimer);
  state.reconnectTimer = window.setTimeout(startListening, 700);
}

async function requestWakeLock() {
  if (
    (!state.listening && !scorePlayer.playing) ||
    document.visibilityState !== "visible" ||
    !("wakeLock" in navigator) ||
    state.wakeLock
  ) {
    return;
  }

  try {
    state.wakeLock = await navigator.wakeLock.request("screen");
    state.wakeLock.addEventListener(
      "release",
      () => {
        state.wakeLock = null;
      },
      { once: true },
    );
  } catch {
    // Wake Lock is an enhancement; audio works without it.
  }
}

async function recoverAudio() {
  if (!state.listening || !audioEngine.active) {
    state.listening = false;
    if (!state.starting) {
      await startListening();
    }
    return;
  }

  try {
    await audioEngine.resume();
    requestWakeLock();
  } catch {
    if (state.mode === "tuner") {
      setStatus("Tap to resume", "paused");
      setHelper("Tap once to continue live analysis.");
    }
  }
}

function setMode(mode) {
  if (state.mode === mode) {
    return;
  }

  state.mode = mode;
  elements.tunerView.hidden = mode !== "tuner";
  elements.scoreView.hidden = mode !== "score";
  for (const button of elements.modeButtons) {
    const active = button.dataset.mode === mode;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  }

  tonePlayer.stop();
  if (mode === "score") {
    audioEngine.setProcessing(false);
    graph.addGap();
    if (scorePlayer.playing) {
      setStatus("Playing", "tone");
    } else if (state.score) {
      setStatus("Ready to play");
    } else {
      setStatus("Choose a score");
    }
    if (state.score) {
      const position = scorePlayer.currentPosition();
      scoreNotation.render(position, true);
    }
  } else {
    scorePlayer.pause();
    audioEngine.setProcessing(state.listening);
    if (state.listening) {
      setStatus("Listening", "listening");
      state.lastVoicedAt = performance.now();
    } else {
      setStatus("Try again", "error");
    }
  }
}

function scoreErrorMessage(error) {
  const messages = {
    FILE_TOO_LARGE: "Use a score smaller than 30 MB.",
    INVALID_MSCZ: "This is not a valid MuseScore archive.",
    ENCRYPTED_MSCZ: "Encrypted MuseScore files cannot be opened.",
    DECOMPRESSION_UNSUPPORTED:
      "This browser cannot unpack MSCZ files. Save the score as MSCX instead.",
    UNSUPPORTED_ZIP_COMPRESSION: "This MSCZ compression method is unsupported.",
    MSCX_NOT_FOUND: "No MuseScore source was found in this archive.",
    INVALID_MSCX: "The MuseScore XML could not be read.",
    XML_PARSER_UNSUPPORTED: "This browser cannot read MuseScore XML.",
    UNSUPPORTED_SCORE_FORMAT: "Choose an .mscz or .mscx file.",
    NO_PLAYABLE_NOTES: "This score contains no playable notes.",
    TOO_MANY_NOTES: "Scores are limited to 12,000 notes.",
    SCORE_TOO_LONG: "Scores longer than one hour are unsupported.",
  };
  return messages[error?.message] ?? "Could not read this score.";
}

function partVolumeLabel(decibels, enabled) {
  if (decibels <= PART_VOLUME_MIN_DB) {
    return "Off";
  }
  if (!enabled) {
    return "Muted";
  }
  const sign = decibels > 0 ? "+" : decibels < 0 ? "−" : "";
  return `${sign}${Math.abs(decibels)} dB`;
}

function updatePartMixerControl(button, input, output) {
  const decibels = Number(input.value);
  const enabled = button.classList.contains("is-enabled");
  const label = partVolumeLabel(decibels, enabled);
  const row = button.closest(".part-row");
  output.textContent = label;
  input.setAttribute("aria-valuetext", label);
  row?.classList.toggle("is-muted", !enabled);
  row?.classList.toggle(
    "is-boosted",
    enabled && decibels > 0,
  );
}

function setPartEnabled(button, part, input, output, enabled) {
  if (enabled && Number(input.value) <= PART_VOLUME_MIN_DB) {
    input.value = "0";
    scorePlayer.setPartVolume(part.id, 1);
  }
  button.classList.toggle("is-enabled", enabled);
  button.setAttribute("aria-pressed", String(enabled));
  scorePlayer.setPartEnabled(part.id, enabled);
  updatePartMixerControl(button, input, output);
}

function setScorePart(partId) {
  const nextPartId = state.selectedPartId === partId ? null : partId;
  state.selectedPartId = nextPartId;

  for (const button of elements.partList.querySelectorAll(".part-toggle")) {
    const selected = button.dataset.partId === nextPartId;
    button.classList.toggle("is-score-source", selected);
    button.setAttribute("aria-current", selected ? "true" : "false");
  }

  if (nextPartId) {
    scoreNotation.setPart(nextPartId);
    navigator.vibrate?.(12);
  } else {
    scoreNotation.setPart(null);
  }
  elements.liveScorePanel.hidden = !nextPartId;
}

function bindPartControl(button, part, input, output) {
  const longPressDuration = 520;
  let longPressTimer = null;
  let longPressed = false;
  let pointerOrigin = null;

  const cancelLongPress = () => {
    if (longPressTimer) {
      window.clearTimeout(longPressTimer);
      longPressTimer = null;
    }
  };

  button.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }
    longPressed = false;
    pointerOrigin = { x: event.clientX, y: event.clientY };
    longPressTimer = window.setTimeout(() => {
      longPressTimer = null;
      longPressed = true;
      setScorePart(part.id);
    }, longPressDuration);
  });
  button.addEventListener("pointermove", (event) => {
    if (
      pointerOrigin &&
      Math.hypot(
        event.clientX - pointerOrigin.x,
        event.clientY - pointerOrigin.y,
      ) > 10
    ) {
      cancelLongPress();
    }
  });
  for (const eventName of ["pointerup", "pointercancel", "pointerleave"]) {
    button.addEventListener(eventName, cancelLongPress);
  }
  button.addEventListener("contextmenu", (event) => event.preventDefault());
  button.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && event.shiftKey) {
      event.preventDefault();
      setScorePart(part.id);
    }
  });
  button.addEventListener("click", (event) => {
    if (longPressed) {
      event.preventDefault();
      longPressed = false;
      return;
    }
    setPartEnabled(
      button,
      part,
      input,
      output,
      !button.classList.contains("is-enabled"),
    );
  });

  input.addEventListener("input", () => {
    const decibels = Number(input.value);
    const off = decibels <= PART_VOLUME_MIN_DB;
    scorePlayer.setPartVolume(
      part.id,
      off ? 0 : decibelsToGain(decibels),
    );
    if (off !== !button.classList.contains("is-enabled")) {
      button.classList.toggle("is-enabled", !off);
      button.setAttribute("aria-pressed", String(!off));
      scorePlayer.setPartEnabled(part.id, !off);
    }
    updatePartMixerControl(button, input, output);
  });
}

function renderScore(score) {
  state.score = score;
  state.selectedPartId = null;
  configureMeasureNavigation(score);
  scorePlayer.load(score);
  elements.scoreTitle.textContent = score.title;
  elements.scoreMeta.textContent = formatTime(score.duration);
  elements.scoreProgress.max = String(score.duration);
  elements.scoreProgress.value = "0";
  elements.scoreCurrentTime.textContent = "0:00";
  elements.scoreDuration.textContent = formatTime(score.duration);
  elements.partList.replaceChildren();

  for (const [index, part] of score.parts.entries()) {
    const row = document.createElement("div");
    row.className = "part-row";
    const button = document.createElement("button");
    const name = document.createElement("span");
    const input = document.createElement("input");
    const output = document.createElement("output");
    button.type = "button";
    button.className = "part-toggle is-enabled";
    name.className = "part-name";
    name.textContent = part.name;
    button.append(name);
    button.dataset.partId = part.id;
    button.setAttribute("aria-pressed", "true");
    button.setAttribute("aria-current", "false");
    button.setAttribute(
      "aria-label",
      `${part.name}. Tap to mute or unmute. Hold to open its score and lyrics.`,
    );
    input.id = `part-volume-${index + 1}`;
    input.className = "part-volume";
    input.type = "range";
    input.min = String(PART_VOLUME_MIN_DB);
    input.max = String(PART_VOLUME_MAX_DB);
    input.step = "1";
    input.value = "0";
    input.setAttribute("aria-label", `${part.name} volume`);
    input.setAttribute("aria-valuetext", "0 dB");
    output.className = "part-volume-value";
    output.setAttribute("for", input.id);
    output.textContent = "0 dB";
    bindPartControl(button, part, input, output);
    row.append(button, input, output);
    elements.partList.append(row);
  }

  elements.scoreLibrary.hidden = true;
  elements.scoreImport.hidden = true;
  elements.scorePlayerPanel.hidden = false;
  elements.liveScorePanel.hidden = true;
  elements.playbackVisualizer.hidden = false;
  scoreNotation.setScore(score);
  setScoreMessage("");
  if (state.mode === "score") {
    setStatus("Ready to play");
  }
}

async function loadScoreBytes(bytes, fileName) {
  if (state.scoreLoading) {
    return;
  }
  state.scoreLoading = true;
  scorePlayer.stop();
  setStatus("Reading score", "paused");
  setScoreMessage(`Reading ${fileName}…`);

  try {
    const score = await readMuseScoreFile(bytes, fileName);
    renderScore(score);
  } catch (error) {
    setStatus("Check file", "error");
    setScoreMessage(scoreErrorMessage(error), true);
  } finally {
    state.scoreLoading = false;
  }
}

async function handleLocalFile(file) {
  if (!file) {
    return;
  }
  await loadScoreBytes(await file.arrayBuffer(), file.name);
}

function renderLibrary(scores) {
  elements.libraryList.replaceChildren();
  elements.libraryCount.textContent = scores.length
    ? String(scores.length)
    : "Empty";

  if (!scores.length) {
    const message = document.createElement("p");
    message.className = "library-empty";
    message.textContent = "Add scores to assets/scores/ to list them here.";
    elements.libraryList.append(message);
    return;
  }

  for (const score of scores) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "library-item";
    const copy = document.createElement("div");
    const title = document.createElement("strong");
    const detail = document.createElement("small");
    title.textContent = score.name;
    detail.textContent = `${String(score.format).toUpperCase()} · ${formatFileSize(score.size)}`;
    copy.append(title, detail);
    button.append(copy);
    button.insertAdjacentHTML(
      "beforeend",
      '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m7 4 6 6-6 6"></path></svg>',
    );
    button.addEventListener("click", async () => {
      setStatus("Downloading", "paused");
      setScoreMessage(`Loading ${score.name}…`);
      try {
        const response = await fetch(new URL(score.path, document.baseURI));
        if (!response.ok) {
          throw new Error("FETCH_FAILED");
        }
        await loadScoreBytes(
          await response.arrayBuffer(),
          score.fileName ?? `${score.name}.${score.format}`,
        );
      } catch {
        setStatus("Check file", "error");
        setScoreMessage("Could not load this stored score.", true);
      }
    });
    elements.libraryList.append(button);
  }
}

async function loadScoreLibrary() {
  try {
    const manifestUrl = new URL("../assets/scores/index.json", import.meta.url);
    const response = await fetch(manifestUrl, { cache: "no-cache" });
    if (!response.ok) {
      throw new Error("MANIFEST_NOT_FOUND");
    }
    const manifest = await response.json();
    renderLibrary(Array.isArray(manifest.scores) ? manifest.scores : []);
  } catch {
    elements.libraryCount.textContent = "Unavailable";
    renderLibrary([]);
  }
}

function resetScoreSelection() {
  scorePlayer.stop();
  scoreNotation.clear();
  state.selectedPartId = null;
  state.score = null;
  configureMeasureNavigation();
  elements.scorePlayerPanel.hidden = true;
  elements.scoreLibrary.hidden = false;
  elements.scoreImport.hidden = false;
  elements.scoreFileInput.value = "";
  setStatus("Choose a score");
  setScoreMessage("");
}

async function toggleScorePlayback() {
  if (!state.score) {
    return;
  }
  try {
    if (scorePlayer.playing) {
      scorePlayer.pause();
    } else {
      await scorePlayer.play();
      requestWakeLock();
    }
  } catch {
    setStatus("Playback unavailable", "error");
    setScoreMessage("Could not start score playback in this browser.", true);
  }
}

function handleScorePlaybackState(playing) {
  elements.scorePlayButton.classList.toggle("is-playing", playing);
  elements.scorePlayButton.setAttribute(
    "aria-label",
    playing ? "Pause score" : "Play score",
  );
  if (state.mode === "score") {
    setStatus(playing ? "Playing" : "Paused", playing ? "tone" : "ready");
  }
}

function handleScoreProgress(position, duration) {
  if (!state.scrubbing) {
    elements.scoreProgress.value = String(position);
    elements.scoreCurrentTime.textContent = formatTime(position);
  }
  elements.scoreDuration.textContent = formatTime(duration);
  scoreNotation.render(position);
  updateMeasureNavigation(position);
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem("instru-theme", theme);
  elements.themeToggle.setAttribute(
    "aria-label",
    theme === "dark" ? "Use light theme" : "Use dark theme",
  );
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", theme === "dark" ? "#101512" : "#f3f1eb");
  graph.refreshTheme();
  scoreNotation.refreshTheme();
}

function initializeTheme() {
  const stored = localStorage.getItem("instru-theme");
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  applyTheme(stored || (prefersDark ? "dark" : "light"));
}

elements.themeToggle.addEventListener("click", () => {
  const current = document.documentElement.dataset.theme;
  applyTheme(current === "dark" ? "light" : "dark");
});

elements.modeButtons.forEach((button) =>
  button.addEventListener("click", () => setMode(button.dataset.mode)),
);

elements.listeningStatus.addEventListener("click", () => {
  if (
    state.mode === "tuner" &&
    (!state.listening || elements.listeningStatus.dataset.state === "paused")
  ) {
    recoverAudio();
  }
});

elements.referenceButtons.forEach((button) =>
  button.addEventListener("click", handleReferenceClick),
);

elements.selectScoreButton.addEventListener("click", () =>
  elements.scoreFileInput.click(),
);
elements.replaceScoreButton.addEventListener("click", resetScoreSelection);
elements.scoreFileInput.addEventListener("change", async () => {
  await handleLocalFile(elements.scoreFileInput.files?.[0]);
});

for (const eventName of ["dragenter", "dragover"]) {
  elements.scoreImport.addEventListener(eventName, (event) => {
    event.preventDefault();
    elements.scoreImport.classList.add("is-dragging");
  });
}
for (const eventName of ["dragleave", "drop"]) {
  elements.scoreImport.addEventListener(eventName, (event) => {
    event.preventDefault();
    elements.scoreImport.classList.remove("is-dragging");
  });
}
elements.scoreImport.addEventListener("drop", async (event) => {
  await handleLocalFile(event.dataTransfer?.files?.[0]);
});

elements.scorePlayButton.addEventListener("click", toggleScorePlayback);
elements.scoreLoopButton.addEventListener("click", () => {
  const looping = !scorePlayer.looping;
  scorePlayer.setLooping(looping);
  elements.scoreLoopButton.classList.toggle("is-active", looping);
  elements.scoreLoopButton.setAttribute("aria-pressed", String(looping));
  elements.scoreLoopButton.setAttribute(
    "aria-label",
    looping ? "Disable loop" : "Enable loop",
  );
});
elements.scoreProgress.addEventListener("pointerdown", () => {
  state.scrubbing = true;
});
elements.scoreProgress.addEventListener("input", () => {
  state.scrubbing = true;
  const position = Number(elements.scoreProgress.value);
  elements.scoreCurrentTime.textContent = formatTime(position);
  scoreNotation.render(position, true);
});
elements.scoreProgress.addEventListener("change", () => {
  scorePlayer.seek(Number(elements.scoreProgress.value));
  state.scrubbing = false;
});
elements.scoreProgress.addEventListener("pointerup", () => {
  scorePlayer.seek(Number(elements.scoreProgress.value));
  state.scrubbing = false;
});
elements.scoreMeasureInput.addEventListener("change", jumpToMeasure);
elements.scoreMeasureInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    jumpToMeasure();
    elements.scoreMeasureInput.blur();
  }
});
document.addEventListener(
  "pointerdown",
  () => {
    if (state.listening) {
      audioEngine.resume().catch(() => {});
    }
  },
  { passive: true },
);

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    recoverAudio();
  }
});

window.addEventListener("pagehide", () => {
  state.unloading = true;
  state.listening = false;
  window.clearTimeout(state.reconnectTimer);
  if (state.wakeLock) {
    state.wakeLock.release().catch(() => {});
    state.wakeLock = null;
  }
  tonePlayer.stop();
  scorePlayer.stop();
  audioEngine.stop();
});

window.addEventListener("pageshow", () => {
  state.unloading = false;
  recoverAudio();
});

initializeTheme();
updateReferenceButtons();
resetPitchSummary();
loadScoreLibrary();
startListening();
