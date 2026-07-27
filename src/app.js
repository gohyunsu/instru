import { PitchAudioEngine, ReferenceTonePlayer } from "./audio-engine.js";
import {
  describeCents,
  formatCents,
  formatNote,
  frequencyToMidi,
  measurementFromMidi,
  midiToFrequency,
} from "./music.js";
import { VerticalPitchGraph } from "./pitch-graph.js";

const elements = {
  themeToggle: document.querySelector("#themeToggle"),
  listeningStatus: document.querySelector("#listeningStatus"),
  statusLabel: document.querySelector("#statusLabel"),
  pitchNote: document.querySelector("#pitchNote"),
  solfege: document.querySelector("#solfege"),
  deviationLine: document.querySelector("#deviationLine"),
  deviationValue: document.querySelector("#deviationValue"),
  deviationCopy: document.querySelector("#deviationCopy"),
  frequency: document.querySelector("#frequency"),
  screenReaderStatus: document.querySelector("#screenReaderStatus"),
  canvas: document.querySelector("#pitchCanvas"),
  graphEmpty: document.querySelector("#graphEmpty"),
  graphEmptyText: document.querySelector("#graphEmptyText"),
  referenceButtons: [...document.querySelectorAll(".note-button")],
  helperMessage: document.querySelector("#helperMessage"),
};

const graph = new VerticalPitchGraph(elements.canvas);
const state = {
  listening: false,
  starting: false,
  playingTone: false,
  activeToneButton: null,
  referenceMidi: 69,
  recentMidi: [],
  smoothedMidi: null,
  lastVoicedAt: 0,
  lastAnnouncementAt: 0,
  waitingTimer: null,
  wakeLock: null,
  reconnectTimer: null,
  unloading: false,
};

const audioEngine = new PitchAudioEngine(
  handleAudioMeasurement,
  handleStreamEnded,
);
const tonePlayer = new ReferenceTonePlayer(handleToneState);

function median(values) {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.floor(ordered.length / 2)];
}

function setStatus(label, status = "ready") {
  elements.statusLabel.textContent = label;
  elements.listeningStatus.dataset.state = status;
}

function setHelper(message, isError = false) {
  elements.helperMessage.textContent = message;
  elements.helperMessage.dataset.state = isError ? "error" : "";
}

function resetPitchSummary(message = "한 음을 편하게 길게 불러보세요") {
  elements.pitchNote.textContent = "—";
  elements.solfege.textContent = "";
  elements.deviationValue.textContent = state.listening
    ? "소리를 기다리는 중"
    : state.starting
      ? "마이크 연결 중"
      : "연결을 확인해주세요";
  elements.deviationCopy.textContent = "";
  elements.deviationLine.dataset.direction = "";
  elements.frequency.textContent = message;
}

function updateReferenceButtons(midi = state.referenceMidi) {
  state.referenceMidi = Math.round(midi);

  for (const button of elements.referenceButtons) {
    const offset = Number(button.dataset.offset);
    const noteMidi = state.referenceMidi + offset;
    button.dataset.midi = String(noteMidi);
    button.querySelector(".note-button-label").textContent = formatNote(noteMidi);
    button.classList.toggle("is-current", offset === 0);
    button.setAttribute(
      "aria-label",
      `${formatNote(noteMidi)} 기준음 재생`,
    );
  }
}

function showMeasurement(measurement, confidence) {
  const description = describeCents(measurement.cents);
  elements.pitchNote.textContent = measurement.label;
  elements.solfege.textContent = measurement.solfege;
  elements.deviationValue.textContent = formatCents(measurement.cents);
  elements.deviationCopy.textContent =
    description.direction === "exact"
      ? description.label
      : `${description.symbol} ${description.label}`;
  elements.deviationLine.dataset.direction = description.direction;
  elements.frequency.textContent = `${measurement.frequency.toFixed(1)} Hz`;
  elements.graphEmpty.classList.add("is-hidden");
  updateReferenceButtons(measurement.midi);

  const now = performance.now();
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
  if (!state.listening || state.playingTone) {
    return;
  }

  const silenceDuration = performance.now() - state.lastVoicedAt;
  if (silenceDuration < 360) {
    return;
  }

  state.waitingTimer = null;
  if (state.smoothedMidi === null) {
    return;
  }

  state.recentMidi = [];
  state.smoothedMidi = null;
  graph.addGap();
  resetPitchSummary();
}

function handleAudioMeasurement({ frequency, confidence = 0, rms = 0 }) {
  if (!state.listening || state.playingTone) {
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
  state.recentMidi.push(midi);
  if (state.recentMidi.length > 5) {
    state.recentMidi.shift();
  }

  const stableMidi = median(state.recentMidi);
  state.smoothedMidi =
    state.smoothedMidi === null
      ? stableMidi
      : state.smoothedMidi * 0.62 + stableMidi * 0.38;

  showMeasurement(measurementFromMidi(state.smoothedMidi), confidence);
}

function handleToneState(playing) {
  state.playingTone = playing;
  audioEngine.setProcessing(!playing);

  if (playing) {
    setStatus("기준음 재생", "tone");
  } else {
    state.activeToneButton?.classList.remove("is-playing");
    state.activeToneButton = null;
    if (state.listening) {
      setStatus("듣는 중", "listening");
      state.lastVoicedAt = performance.now();
    } else {
      setStatus("준비");
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
    setHelper("이 브라우저에서는 기준음을 재생할 수 없습니다.", true);
  }
}

function microphoneErrorMessage(error) {
  if (error?.message === "UNSUPPORTED") {
    return "이 브라우저는 실시간 오디오 분석을 지원하지 않습니다.";
  }
  if (error?.name === "NotAllowedError") {
    return "마이크 권한이 필요합니다. 브라우저 설정에서 허용해주세요.";
  }
  if (error?.name === "NotFoundError") {
    return "사용할 수 있는 마이크를 찾지 못했습니다.";
  }
  if (error?.name === "NotReadableError") {
    return "다른 앱이 마이크를 사용 중인지 확인해주세요.";
  }
  return "마이크를 시작하지 못했습니다. 잠시 후 다시 시도해주세요.";
}

async function startListening() {
  if (state.starting) {
    return;
  }

  state.starting = true;
  setStatus("연결 중", "paused");
  setHelper("브라우저의 마이크 권한을 허용해주세요.");
  resetPitchSummary("연결되면 자동으로 분석을 시작합니다");

  try {
    await audioEngine.start();
    state.listening = true;
    state.lastVoicedAt = performance.now();
    setStatus("듣는 중", "listening");
    setHelper("실시간 분석 중 · 오디오는 저장하지 않습니다");
    resetPitchSummary();
    elements.graphEmptyText.innerHTML =
      "한 음을 길게 부르면<br />아래에서 위로 흐름이 쌓입니다";
    requestWakeLock();
  } catch (error) {
    state.listening = false;
    setStatus("다시 시도", "error");
    setHelper(microphoneErrorMessage(error), true);
    resetPitchSummary("상단의 ‘다시 시도’를 눌러 연결할 수 있습니다");
  } finally {
    state.starting = false;
  }
}

async function stopListening() {
  state.listening = false;
  window.clearTimeout(state.waitingTimer);
  tonePlayer.stop();
  await audioEngine.stop();
  state.recentMidi = [];
  state.smoothedMidi = null;
  graph.clear();
  if (state.wakeLock) {
    state.wakeLock.release().catch(() => {});
    state.wakeLock = null;
  }
  elements.graphEmpty.classList.remove("is-hidden");
  setStatus("연결 중", "paused");
  setHelper("마이크 다시 연결 중 · 오디오는 저장하지 않습니다");
  resetPitchSummary();
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
    !state.listening ||
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
    // Wake Lock is an enhancement; pitch analysis works without it.
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
    setStatus("화면 터치", "paused");
    setHelper("화면을 한 번 터치하면 실시간 분석을 계속합니다.");
  }
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem("acapella-theme", theme);
  elements.themeToggle.setAttribute(
    "aria-label",
    theme === "dark" ? "라이트 모드 켜기" : "다크 모드 켜기",
  );
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", theme === "dark" ? "#101512" : "#f3f1eb");
  graph.refreshTheme();
}

function initializeTheme() {
  const stored = localStorage.getItem("acapella-theme");
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  applyTheme(stored || (prefersDark ? "dark" : "light"));
}

elements.themeToggle.addEventListener("click", () => {
  const current = document.documentElement.dataset.theme;
  applyTheme(current === "dark" ? "light" : "dark");
});

elements.listeningStatus.addEventListener("click", () => {
  if (!state.listening || elements.listeningStatus.dataset.state === "paused") {
    recoverAudio();
  }
});
elements.referenceButtons.forEach((button) =>
  button.addEventListener("click", handleReferenceClick),
);

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
  audioEngine.stop();
});

window.addEventListener("pageshow", () => {
  state.unloading = false;
  recoverAudio();
});

initializeTheme();
updateReferenceButtons();
resetPitchSummary();
startListening();
