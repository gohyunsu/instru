import { PitchAudioEngine, ReferenceTonePlayer } from "./audio-engine.js";
import {
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
import { MuseScorePlayer } from "./score-player.js";

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
  scorePlayButton: document.querySelector("#scorePlayButton"),
  playbackPulse: document.querySelector("#playbackPulse"),
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
};

const audioEngine = new PitchAudioEngine(
  handleAudioMeasurement,
  handleStreamEnded,
);
const tonePlayer = new ReferenceTonePlayer(handleToneState);
const pitchStabilizer = new PitchStabilizer();
const scorePlayer = new MuseScorePlayer({
  onStateChange: handleScorePlaybackState,
  onProgress: handleScoreProgress,
});

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
  const exact = Math.abs(cents) <= 5;
  if (exact) {
    state.exactSince ??= now;
    if (now - state.exactSince >= 320) {
      setAccuracyLocked(true);
    }
  } else if (Math.abs(cents) > 8) {
    state.exactSince = null;
    setAccuracyLocked(false);
  }
}

function resetPitchSummary(message = "한 음을 길게") {
  state.exactSince = null;
  setAccuracyLocked(false);
  elements.pitchNote.setAttribute("aria-label", "음정 대기");
  elements.pitchLetter.textContent = "—";
  elements.pitchOctave.textContent = "";
  elements.deviationValue.textContent = state.listening
    ? "대기 중"
    : state.starting
      ? "연결 중"
      : "연결 필요";
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
    button.setAttribute("aria-label", `${formatNote(noteMidi)} 기준음 재생`);
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
      ? "정확"
      : description.direction === "high"
        ? "높음"
        : "낮음";
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
  if (state.mode === "tuner") {
    setStatus("연결 중", "paused");
    setHelper("마이크 권한 필요");
    resetPitchSummary("");
  }

  try {
    await audioEngine.start();
    state.listening = true;
    state.lastVoicedAt = performance.now();
    audioEngine.setProcessing(state.mode === "tuner");
    if (state.mode === "tuner") {
      setStatus("듣는 중", "listening");
      setHelper("");
      resetPitchSummary();
      elements.graphEmptyText.textContent = "한 음을 길게";
    }
    requestWakeLock();
  } catch (error) {
    state.listening = false;
    if (state.mode === "tuner") {
      setStatus("다시 시도", "error");
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
    setStatus("연결 중", "paused");
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
      setStatus("화면 터치", "paused");
      setHelper("화면을 한 번 터치하면 실시간 분석을 계속합니다.");
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
      setStatus("재생 중", "tone");
    } else if (state.score) {
      setStatus("재생 준비");
    } else {
      setStatus("파일 대기");
    }
  } else {
    scorePlayer.pause();
    audioEngine.setProcessing(state.listening);
    if (state.listening) {
      setStatus("듣는 중", "listening");
      state.lastVoicedAt = performance.now();
    } else {
      setStatus("다시 시도", "error");
    }
  }
}

function scoreErrorMessage(error) {
  const messages = {
    FILE_TOO_LARGE: "파일이 너무 큽니다. 30MB 이하 악보를 사용해주세요.",
    INVALID_MSCZ: "올바른 MuseScore 압축 파일이 아닙니다.",
    ENCRYPTED_MSCZ: "암호화된 MuseScore 파일은 열 수 없습니다.",
    DECOMPRESSION_UNSUPPORTED:
      "이 브라우저는 MSCZ 압축 해제를 지원하지 않습니다. MSCX로 저장해 사용해주세요.",
    UNSUPPORTED_ZIP_COMPRESSION: "지원하지 않는 MSCZ 압축 방식입니다.",
    MSCX_NOT_FOUND: "MSCZ 안에서 악보 원본을 찾지 못했습니다.",
    INVALID_MSCX: "MuseScore XML 형식을 읽지 못했습니다.",
    XML_PARSER_UNSUPPORTED: "이 브라우저는 XML 악보를 지원하지 않습니다.",
    UNSUPPORTED_SCORE_FORMAT: ".mscz 또는 .mscx 파일을 선택해주세요.",
    NO_PLAYABLE_NOTES: "재생할 수 있는 음표가 없습니다.",
    TOO_MANY_NOTES: "음표가 너무 많은 악보입니다. 12,000음 이하를 지원합니다.",
    SCORE_TOO_LONG: "한 시간보다 긴 악보는 현재 지원하지 않습니다.",
  };
  return messages[error?.message] ?? "악보를 읽지 못했습니다. 파일을 확인해주세요.";
}

function renderScore(score) {
  state.score = score;
  scorePlayer.load(score);
  elements.scoreTitle.textContent = score.title;
  elements.scoreMeta.textContent =
    `${score.parts.length}성부 · ${score.events.length.toLocaleString()}음 · ${formatTime(score.duration)}`;
  elements.scoreProgress.max = String(score.duration);
  elements.scoreProgress.value = "0";
  elements.scoreCurrentTime.textContent = "0:00";
  elements.scoreDuration.textContent = formatTime(score.duration);
  elements.partList.replaceChildren();

  for (const part of score.parts) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "part-toggle is-enabled";
    button.textContent = `${part.name} · ${part.noteCount}`;
    button.dataset.partId = part.id;
    button.setAttribute("aria-pressed", "true");
    button.addEventListener("click", () => {
      const enabled = !button.classList.contains("is-enabled");
      button.classList.toggle("is-enabled", enabled);
      button.setAttribute("aria-pressed", String(enabled));
      scorePlayer.setPartEnabled(part.id, enabled);
    });
    elements.partList.append(button);
  }

  elements.scoreLibrary.hidden = true;
  elements.scoreImport.hidden = true;
  elements.scorePlayerPanel.hidden = false;
  setScoreMessage("");
  if (state.mode === "score") {
    setStatus("재생 준비");
  }
}

async function loadScoreBytes(bytes, fileName) {
  if (state.scoreLoading) {
    return;
  }
  state.scoreLoading = true;
  scorePlayer.stop();
  setStatus("악보 읽는 중", "paused");
  setScoreMessage(`${fileName} 읽는 중…`);

  try {
    const score = await readMuseScoreFile(bytes, fileName);
    renderScore(score);
  } catch (error) {
    setStatus("파일 확인", "error");
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
    ? `${scores.length}개`
    : "비어 있음";

  if (!scores.length) {
    const message = document.createElement("p");
    message.className = "library-empty";
    message.textContent =
      "assets/scores/에 악보를 저장하면 이곳에 표시됩니다.";
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
      setStatus("다운로드 중", "paused");
      setScoreMessage(`${score.name} 불러오는 중…`);
      try {
        const response = await fetch(new URL(score.path, document.baseURI));
        if (!response.ok) {
          throw new Error("FETCH_FAILED");
        }
        await loadScoreBytes(await response.arrayBuffer(), `${score.name}.${score.format}`);
      } catch {
        setStatus("파일 확인", "error");
        setScoreMessage("보관된 악보를 불러오지 못했습니다.", true);
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
    elements.libraryCount.textContent = "확인 실패";
    renderLibrary([]);
  }
}

function resetScoreSelection() {
  scorePlayer.stop();
  state.score = null;
  elements.scorePlayerPanel.hidden = true;
  elements.scoreLibrary.hidden = false;
  elements.scoreImport.hidden = false;
  elements.scoreFileInput.value = "";
  setStatus("파일 대기");
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
    setStatus("재생 불가", "error");
    setScoreMessage("이 브라우저에서 악보 소리를 시작하지 못했습니다.", true);
  }
}

function handleScorePlaybackState(playing) {
  elements.scorePlayButton.classList.toggle("is-playing", playing);
  elements.playbackPulse.classList.toggle("is-playing", playing);
  elements.scorePlayButton.setAttribute(
    "aria-label",
    playing ? "악보 일시정지" : "악보 재생",
  );
  if (state.mode === "score") {
    setStatus(playing ? "재생 중" : "일시정지", playing ? "tone" : "ready");
  }
}

function handleScoreProgress(position, duration) {
  if (!state.scrubbing) {
    elements.scoreProgress.value = String(position);
    elements.scoreCurrentTime.textContent = formatTime(position);
  }
  elements.scoreDuration.textContent = formatTime(duration);
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem("instru-theme", theme);
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
elements.scoreProgress.addEventListener("pointerdown", () => {
  state.scrubbing = true;
});
elements.scoreProgress.addEventListener("input", () => {
  state.scrubbing = true;
  elements.scoreCurrentTime.textContent = formatTime(
    Number(elements.scoreProgress.value),
  );
});
elements.scoreProgress.addEventListener("change", () => {
  scorePlayer.seek(Number(elements.scoreProgress.value));
  state.scrubbing = false;
});
elements.scoreProgress.addEventListener("pointerup", () => {
  scorePlayer.seek(Number(elements.scoreProgress.value));
  state.scrubbing = false;
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
