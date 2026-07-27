const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const WINDOW_PAST_SECONDS = 1.5;
const WINDOW_FUTURE_SECONDS = 5.5;
const STAFF_ROW_HEIGHT = 96;
const STAFF_GAP = 8;
const STAFF_LEFT = 52;
const NOTE_AREA_LEFT = 96;
const NOTE_AREA_RIGHT = 12;

const LETTER_INDEX = {
  C: 0,
  D: 1,
  E: 2,
  F: 3,
  G: 4,
  A: 5,
  B: 6,
};

const NATURAL_PITCH_CLASS = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};

const NATURAL_TPC = {
  C: 14,
  D: 16,
  E: 18,
  F: 13,
  G: 15,
  A: 17,
  B: 19,
};

const TPC_LETTERS = ["C", "G", "D", "A", "E", "B", "F"];
const SHARP_SPELLINGS = [
  ["C", 0],
  ["C", 1],
  ["D", 0],
  ["D", 1],
  ["E", 0],
  ["F", 0],
  ["F", 1],
  ["G", 0],
  ["G", 1],
  ["A", 0],
  ["A", 1],
  ["B", 0],
];

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function accidentalSymbol(accidental) {
  const symbols = {
    "-2": "𝄫",
    "-1": "♭",
    0: "",
    1: "♯",
    2: "𝄪",
  };
  return symbols[accidental] ?? "";
}

export function noteSpelling(midi, tpc = null) {
  const roundedMidi = Math.round(midi);
  let letter;
  let accidental;

  if (Number.isInteger(tpc)) {
    letter = TPC_LETTERS[((tpc % 7) + 7) % 7];
    accidental = (tpc - NATURAL_TPC[letter]) / 7;
  }

  if (
    !letter ||
    !Number.isInteger(accidental) ||
    Math.abs(accidental) > 2
  ) {
    [letter, accidental] =
      SHARP_SPELLINGS[((roundedMidi % 12) + 12) % 12];
  }

  const octave =
    (roundedMidi - NATURAL_PITCH_CLASS[letter] - accidental) / 12 - 1;
  if (!Number.isInteger(octave)) {
    const [fallbackLetter, fallbackAccidental] =
      SHARP_SPELLINGS[((roundedMidi % 12) + 12) % 12];
    return {
      letter: fallbackLetter,
      accidental: fallbackAccidental,
      symbol: accidentalSymbol(fallbackAccidental),
      octave: Math.floor(roundedMidi / 12) - 1,
    };
  }

  return {
    letter,
    accidental,
    symbol: accidentalSymbol(accidental),
    octave,
  };
}

export function clefForEvents(events) {
  if (!events.length) {
    return "treble";
  }
  const ordered = events
    .map((event) => event.midi)
    .filter(Number.isFinite)
    .sort((left, right) => left - right);
  if (!ordered.length) {
    return "treble";
  }
  const median = ordered[Math.floor(ordered.length / 2)];
  return median < 58 ? "bass" : "treble";
}

export function staffStepForNote(midi, tpc, clef = "treble") {
  const spelling = noteSpelling(midi, tpc);
  let displayOctave = spelling.octave;
  if (clef.endsWith("8vb")) {
    displayOctave += 1;
  } else if (clef.endsWith("8va")) {
    displayOctave -= 1;
  }
  const diatonicIndex =
    displayOctave * 7 + LETTER_INDEX[spelling.letter];
  const bottomLineIndex =
    clef.startsWith("bass")
      ? 2 * 7 + LETTER_INDEX.G
      : 4 * 7 + LETTER_INDEX.E;
  return diatonicIndex - bottomLineIndex;
}

export function visibleEvents(events, startSeconds, endSeconds) {
  return events.filter(
    (event) =>
      event.startSeconds <= endSeconds &&
      event.startSeconds + event.durationSeconds >= startSeconds,
  );
}

function createSvgElement(tagName, attributes = {}, text = "") {
  const element = document.createElementNS(SVG_NAMESPACE, tagName);
  for (const [name, value] of Object.entries(attributes)) {
    if (value !== null && value !== undefined) {
      element.setAttribute(name, String(value));
    }
  }
  if (text) {
    element.textContent = text;
  }
  return element;
}

function ledgerSteps(step) {
  const steps = [];
  if (step < 0) {
    for (let ledger = -2; ledger >= step; ledger -= 2) {
      steps.push(ledger);
    }
  } else if (step > 8) {
    for (let ledger = 10; ledger <= step; ledger += 2) {
      steps.push(ledger);
    }
  }
  return steps;
}

function abbreviatedName(name, maximum = 16) {
  const normalized = String(name || "성부").trim();
  return normalized.length > maximum
    ? `${normalized.slice(0, maximum - 1)}…`
    : normalized;
}

export class LiveScoreNotation {
  constructor(container, countElement = null) {
    this.container = container;
    this.countElement = countElement;
    this.score = null;
    this.enabledParts = new Set();
    this.eventsByPart = new Map();
    this.clefs = new Map();
    this.position = 0;
    this.lastRenderedPosition = null;
    this.lastWidth = 0;

    this.svg = createSvgElement("svg", {
      class: "notation-svg",
      role: "presentation",
      "aria-hidden": "true",
    });
    this.empty = document.createElement("p");
    this.empty.className = "notation-empty";
    this.empty.textContent = "성부를 선택하세요";
    this.container.replaceChildren(this.svg, this.empty);

    this.resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => this.render(this.position, true));
    this.resizeObserver?.observe(this.container);
    this.updateCount();
    this.updateVisibility();
  }

  setScore(score) {
    this.score = score;
    this.position = 0;
    this.lastRenderedPosition = null;
    this.enabledParts = new Set(score.parts.map((part) => part.id));
    this.eventsByPart = new Map();
    this.clefs = new Map();

    for (const part of score.parts) {
      const events = score.events.filter((event) => event.partId === part.id);
      this.eventsByPart.set(part.id, events);
      this.clefs.set(part.id, part.clef || clefForEvents(events));
    }

    this.updateCount();
    this.updateVisibility();
    this.render(0, true);
  }

  clear() {
    this.score = null;
    this.enabledParts.clear();
    this.eventsByPart.clear();
    this.clefs.clear();
    this.svg.replaceChildren();
    this.svg.removeAttribute("viewBox");
    this.svg.style.height = "";
    this.updateCount();
    this.updateVisibility();
  }

  setEnabledParts(parts) {
    this.enabledParts = new Set(parts);
    this.lastRenderedPosition = null;
    this.updateCount();
    this.updateVisibility();
    this.render(this.position, true);
  }

  refreshTheme() {
    this.render(this.position, true);
  }

  updateCount() {
    if (!this.countElement) {
      return;
    }
    const count = this.enabledParts.size;
    this.countElement.textContent = count ? `${count}성부` : "선택 없음";
  }

  updateVisibility() {
    const hasParts = Boolean(this.score && this.enabledParts.size);
    this.svg.hidden = !hasParts;
    this.empty.hidden = hasParts;
    if (!this.score) {
      this.empty.textContent = "악보 없음";
    } else if (!hasParts) {
      this.empty.textContent = "성부를 선택하세요";
    }
  }

  timeToX(time, windowStart, width) {
    const plotWidth = Math.max(
      1,
      width - NOTE_AREA_LEFT - NOTE_AREA_RIGHT,
    );
    const windowDuration =
      WINDOW_PAST_SECONDS + WINDOW_FUTURE_SECONDS;
    return (
      NOTE_AREA_LEFT +
      ((time - windowStart) / windowDuration) * plotWidth
    );
  }

  noteY(event, clef, staffBottom) {
    const step = staffStepForNote(event.midi, event.tpc, clef);
    return {
      step,
      y: staffBottom - step * (STAFF_GAP / 2),
      spelling: noteSpelling(event.midi, event.tpc),
    };
  }

  renderStaff({
    part,
    rowIndex,
    width,
    windowStart,
    windowEnd,
    playheadX,
  }) {
    const rowTop = rowIndex * STAFF_ROW_HEIGHT;
    const staffTop = rowTop + 35;
    const staffBottom = staffTop + STAFF_GAP * 4;
    const clef = this.clefs.get(part.id) ?? "treble";
    const bassClef = clef.startsWith("bass");
    const group = createSvgElement("g", {
      class: "notation-staff",
      "data-part-id": part.id,
    });

    group.append(
      createSvgElement(
        "text",
        {
          x: 10,
          y: rowTop + 17,
          class: "notation-part-name",
        },
        abbreviatedName(part.name),
      ),
      createSvgElement("rect", {
        x: playheadX - 11,
        y: rowTop + 4,
        width: 22,
        height: STAFF_ROW_HEIGHT - 8,
        rx: 8,
        class: "notation-current-band",
      }),
    );

    if (rowIndex > 0) {
      group.append(
        createSvgElement("line", {
          x1: 10,
          x2: width - 10,
          y1: rowTop,
          y2: rowTop,
          class: "notation-row-separator",
        }),
      );
    }

    for (let line = 0; line < 5; line += 1) {
      const y = staffTop + line * STAFF_GAP;
      group.append(
        createSvgElement("line", {
          x1: STAFF_LEFT,
          x2: width - NOTE_AREA_RIGHT,
          y1: y,
          y2: y,
          class: "notation-staff-line",
        }),
      );
    }

    group.append(
      createSvgElement(
        "text",
        {
          x: bassClef ? 60 : 58,
          y: bassClef ? staffTop + 25 : staffTop + 31,
          class: `notation-clef notation-clef-${bassClef ? "bass" : "treble"}`,
        },
        bassClef ? "𝄢" : "𝄞",
      ),
    );
    if (clef.endsWith("8vb") || clef.endsWith("8va")) {
      group.append(
        createSvgElement(
          "text",
          {
            x: bassClef ? 70 : 69,
            y: clef.endsWith("8vb") ? staffBottom + 10 : staffTop - 5,
            class: "notation-clef-octave",
            "text-anchor": "middle",
          },
          "8",
        ),
      );
    }

    const measures = (this.score.measures ?? []).filter(
      (measure) =>
        measure.startSeconds >= windowStart &&
        measure.startSeconds <= windowEnd,
    );
    for (const measure of measures) {
      const x = this.timeToX(measure.startSeconds, windowStart, width);
      group.append(
        createSvgElement("line", {
          x1: x,
          x2: x,
          y1: staffTop,
          y2: staffBottom,
          class: "notation-measure-line",
        }),
      );
      if (rowIndex === 0) {
        group.append(
          createSvgElement(
            "text",
            {
              x: x + 3,
              y: staffTop - 7,
              class: "notation-measure-number",
            },
            measure.number,
          ),
        );
      }
    }

    const events = visibleEvents(
      this.eventsByPart.get(part.id) ?? [],
      windowStart,
      windowEnd,
    );
    for (const event of events) {
      this.renderEvent({
        event,
        clef,
        group,
        staffBottom,
        width,
        windowStart,
        playheadX,
      });
    }

    group.append(
      createSvgElement("line", {
        x1: playheadX,
        x2: playheadX,
        y1: rowTop + 4,
        y2: rowTop + STAFF_ROW_HEIGHT - 7,
        class: "notation-playhead",
      }),
      createSvgElement("path", {
        d: `M ${playheadX - 4} ${rowTop + 4} L ${playheadX + 4} ${rowTop + 4} L ${playheadX} ${rowTop + 10} Z`,
        class: "notation-playhead-marker",
      }),
    );

    return group;
  }

  renderEvent({
    event,
    clef,
    group,
    staffBottom,
    width,
    windowStart,
  }) {
    const startX = this.timeToX(event.startSeconds, windowStart, width);
    const endX = this.timeToX(
      event.startSeconds + event.durationSeconds,
      windowStart,
      width,
    );
    const { step, y, spelling } = this.noteY(event, clef, staffBottom);
    const isActive =
      event.startSeconds <= this.position + 0.015 &&
      event.startSeconds + event.durationSeconds > this.position;
    const isPast =
      event.startSeconds + event.durationSeconds <= this.position;
    const eventGroup = createSvgElement("g", {
      class: `notation-event${isActive ? " is-active" : ""}${isPast ? " is-past" : ""}`,
    });

    const durationStart = clamp(
      startX + 5,
      NOTE_AREA_LEFT,
      width - NOTE_AREA_RIGHT,
    );
    const durationEnd = clamp(
      endX,
      NOTE_AREA_LEFT,
      width - NOTE_AREA_RIGHT,
    );
    if (durationEnd > durationStart + 2) {
      eventGroup.append(
        createSvgElement("line", {
          x1: durationStart,
          x2: durationEnd,
          y1: y,
          y2: y,
          class: "notation-duration",
        }),
      );
    }

    if (
      startX >= NOTE_AREA_LEFT - 10 &&
      startX <= width - NOTE_AREA_RIGHT + 10
    ) {
      for (const ledgerStep of ledgerSteps(step)) {
        const ledgerY = staffBottom - ledgerStep * (STAFF_GAP / 2);
        eventGroup.append(
          createSvgElement("line", {
            x1: startX - 9,
            x2: startX + 9,
            y1: ledgerY,
            y2: ledgerY,
            class: "notation-ledger-line",
          }),
        );
      }

      if (spelling.symbol) {
        eventGroup.append(
          createSvgElement(
            "text",
            {
              x: startX - 13,
              y: y + 4,
              class: "notation-accidental",
              "text-anchor": "middle",
            },
            spelling.symbol,
          ),
        );
      }

      const quarterLength =
        event.durationTicks / (this.score.division || 480);
      const wholeNote = quarterLength >= 3.5;
      const hollowNote = quarterLength >= 1.75;
      eventGroup.append(
        createSvgElement("ellipse", {
          cx: startX,
          cy: y,
          rx: 5.6,
          ry: 4,
          transform: `rotate(-16 ${startX} ${y})`,
          class: `notation-note-head${hollowNote ? " is-hollow" : ""}`,
        }),
      );

      if (!wholeNote) {
        const stemUp = step < 4;
        const stemX = startX + (stemUp ? 5 : -5);
        const stemEndY = y + (stemUp ? -24 : 24);
        eventGroup.append(
          createSvgElement("line", {
            x1: stemX,
            x2: stemX,
            y1: y,
            y2: stemEndY,
            class: "notation-stem",
          }),
        );

        const flagCount = quarterLength < 0.375 ? 2 : quarterLength < 0.75 ? 1 : 0;
        for (let flag = 0; flag < flagCount; flag += 1) {
          const flagY = stemEndY + (stemUp ? flag * 6 : -flag * 6);
          const direction = stemUp ? 1 : -1;
          eventGroup.append(
            createSvgElement("path", {
              d: `M ${stemX} ${flagY} C ${stemX + 9} ${flagY + 3 * direction}, ${stemX + 9} ${flagY + 10 * direction}, ${stemX + 2} ${flagY + 14 * direction}`,
              class: "notation-flag",
            }),
          );
        }
      }
    }

    group.append(eventGroup);
  }

  render(position = this.position, force = false) {
    if (!this.score || !this.enabledParts.size) {
      return;
    }

    this.position = clamp(position || 0, 0, this.score.duration);
    const width = Math.max(280, Math.round(this.container.clientWidth || 360));
    if (
      !force &&
      this.lastRenderedPosition !== null &&
      Math.abs(this.position - this.lastRenderedPosition) < 0.035 &&
      width === this.lastWidth
    ) {
      return;
    }
    this.lastRenderedPosition = this.position;
    this.lastWidth = width;

    const parts = this.score.parts.filter((part) =>
      this.enabledParts.has(part.id),
    );
    const height = Math.max(STAFF_ROW_HEIGHT, parts.length * STAFF_ROW_HEIGHT);
    const windowStart = this.position - WINDOW_PAST_SECONDS;
    const windowEnd = this.position + WINDOW_FUTURE_SECONDS;
    const playheadX = this.timeToX(this.position, windowStart, width);

    this.svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    this.svg.setAttribute("width", width);
    this.svg.setAttribute("height", height);
    this.svg.style.height = `${height}px`;
    this.svg.replaceChildren(
      ...parts.map((part, rowIndex) =>
        this.renderStaff({
          part,
          rowIndex,
          width,
          windowStart,
          windowEnd,
          playheadX,
        }),
      ),
    );

    const partNames = parts.map((part) => part.name).join(", ");
    this.container.setAttribute(
      "aria-label",
      `${partNames} 실시간 악보, ${Math.floor(this.position / 60)}분 ${Math.floor(this.position % 60)}초`,
    );
  }
}
