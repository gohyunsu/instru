const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const STAFF_HEIGHT = 112;
const STAFF_GAP = 8;
const PIXELS_PER_SECOND = 64;
const EDGE_INSET = 48;

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

export function scrollLeftForPosition(
  position,
  pixelsPerSecond = PIXELS_PER_SECOND,
) {
  return Math.max(0, Number(position) || 0) * pixelsPerSecond;
}

export function positionForScrollLeft(
  scrollLeft,
  duration,
  pixelsPerSecond = PIXELS_PER_SECOND,
) {
  return clamp(
    Math.max(0, Number(scrollLeft) || 0) / pixelsPerSecond,
    0,
    Math.max(0, Number(duration) || 0),
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

export class LiveScoreNotation {
  constructor(container, countElement = null, { onSeek = null } = {}) {
    this.container = container;
    this.countElement = countElement;
    this.onSeek = onSeek;
    this.score = null;
    this.partId = null;
    this.eventsByPart = new Map();
    this.clefs = new Map();
    this.eventNodes = [];
    this.activeNodes = new Set();
    this.position = 0;
    this.viewportWidth = 0;
    this.scrollCommitTimer = null;
    this.programmaticUntil = 0;
    this.exploringUntil = 0;

    this.svg = createSvgElement("svg", {
      class: "notation-svg",
      role: "presentation",
      "aria-hidden": "true",
    });
    this.empty = document.createElement("p");
    this.empty.className = "notation-empty";
    this.empty.textContent = "성부를 길게 선택";
    this.container.replaceChildren(this.svg, this.empty);

    this.container.addEventListener("pointerdown", () => this.beginExploring(), {
      passive: true,
    });
    this.container.addEventListener("wheel", () => this.beginExploring(), {
      passive: true,
    });
    this.container.addEventListener("scroll", () => this.handleScroll(), {
      passive: true,
    });

    this.resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => this.buildTimeline(true));
    this.resizeObserver?.observe(this.container);
    this.updateLabel();
    this.updateVisibility();
  }

  setScore(score) {
    this.score = score;
    this.partId = null;
    this.position = 0;
    this.eventsByPart = new Map();
    this.clefs = new Map();

    for (const part of score.parts) {
      const events = score.events
        .filter((event) => event.partId === part.id)
        .sort((left, right) => left.startSeconds - right.startSeconds);
      this.eventsByPart.set(part.id, events);
      this.clefs.set(part.id, part.clef || clefForEvents(events));
    }

    this.svg.replaceChildren();
    this.container.scrollLeft = 0;
    this.updateLabel();
    this.updateVisibility();
  }

  clear() {
    window.clearTimeout(this.scrollCommitTimer);
    this.score = null;
    this.partId = null;
    this.eventsByPart.clear();
    this.clefs.clear();
    this.eventNodes = [];
    this.activeNodes.clear();
    this.svg.replaceChildren();
    this.svg.removeAttribute("viewBox");
    this.svg.style.width = "";
    this.container.classList.remove("has-timeline");
    this.container.scrollLeft = 0;
    this.updateLabel();
    this.updateVisibility();
  }

  setPart(partId) {
    const exists = this.score?.parts.some((part) => part.id === partId);
    this.partId = exists ? partId : null;
    this.updateLabel();
    this.updateVisibility();
    this.buildTimeline(true);
  }

  setSeekHandler(handler) {
    this.onSeek = handler;
  }

  refreshTheme() {
    // All notation colors come from CSS variables, so the SVG updates in place.
  }

  updateLabel() {
    if (!this.countElement) {
      return;
    }
    const part = this.score?.parts.find(
      (candidate) => candidate.id === this.partId,
    );
    this.countElement.textContent = part?.name ?? "선택 없음";
  }

  updateVisibility() {
    const hasTimeline = Boolean(this.score && this.partId);
    this.svg.hidden = !hasTimeline;
    this.empty.hidden = hasTimeline;
    this.container.classList.toggle("has-timeline", hasTimeline);
    if (!this.score) {
      this.empty.textContent = "악보 없음";
    } else if (!this.partId) {
      this.empty.textContent = "성부를 길게 선택";
    }
  }

  beginExploring() {
    if (!this.partId) {
      return;
    }
    this.programmaticUntil = 0;
    this.exploringUntil = performance.now() + 1400;
  }

  handleScroll() {
    if (
      !this.score ||
      !this.partId ||
      performance.now() < this.programmaticUntil
    ) {
      return;
    }

    this.exploringUntil = performance.now() + 1400;
    const position = positionForScrollLeft(
      this.container.scrollLeft,
      this.score.duration,
    );
    this.position = position;
    this.updateActiveNotes();
    this.updateAriaLabel();

    window.clearTimeout(this.scrollCommitTimer);
    this.scrollCommitTimer = window.setTimeout(() => {
      this.onSeek?.(position);
    }, 120);
  }

  xForTime(time) {
    return this.viewportWidth / 2 + scrollLeftForPosition(time);
  }

  noteY(event, clef, staffBottom) {
    const step = staffStepForNote(event.midi, event.tpc, clef);
    return {
      step,
      y: staffBottom - step * (STAFF_GAP / 2),
      spelling: noteSpelling(event.midi, event.tpc),
    };
  }

  renderEvent(event, clef, group, staffBottom) {
    const startX = this.xForTime(event.startSeconds);
    const endX = this.xForTime(
      event.startSeconds + event.durationSeconds,
    );
    const { step, y, spelling } = this.noteY(event, clef, staffBottom);
    const eventGroup = createSvgElement("g", {
      class: "notation-event",
    });

    if (endX > startX + 7) {
      eventGroup.append(
        createSvgElement("line", {
          x1: startX + 5,
          x2: endX,
          y1: y,
          y2: y,
          class: "notation-duration",
        }),
      );
    }

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

      const flagCount =
        quarterLength < 0.375 ? 2 : quarterLength < 0.75 ? 1 : 0;
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

    group.append(eventGroup);
    this.eventNodes.push({ event, element: eventGroup });
  }

  buildTimeline(preservePosition = false) {
    if (!this.score || !this.partId) {
      this.svg.replaceChildren();
      return;
    }

    this.viewportWidth = Math.max(
      280,
      Math.round(this.container.clientWidth || 360),
    );
    const totalWidth =
      this.viewportWidth +
      scrollLeftForPosition(this.score.duration);
    const staffTop = 41;
    const staffBottom = staffTop + STAFF_GAP * 4;
    const startX = this.viewportWidth / 2 - EDGE_INSET;
    const endX =
      this.viewportWidth / 2 +
      scrollLeftForPosition(this.score.duration) +
      EDGE_INSET;
    const part = this.score.parts.find(
      (candidate) => candidate.id === this.partId,
    );
    const clef = this.clefs.get(this.partId) ?? "treble";
    const bassClef = clef.startsWith("bass");
    const group = createSvgElement("g", {
      class: "notation-staff",
      "data-part-id": this.partId,
    });

    for (let line = 0; line < 5; line += 1) {
      const y = staffTop + line * STAFF_GAP;
      group.append(
        createSvgElement("line", {
          x1: startX,
          x2: endX,
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
          x: this.viewportWidth / 2 - 39,
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
            x: this.viewportWidth / 2 - 28,
            y: clef.endsWith("8vb") ? staffBottom + 10 : staffTop - 5,
            class: "notation-clef-octave",
            "text-anchor": "middle",
          },
          "8",
        ),
      );
    }

    for (const measure of this.score.measures ?? []) {
      const x = this.xForTime(measure.startSeconds);
      group.append(
        createSvgElement("line", {
          x1: x,
          x2: x,
          y1: staffTop,
          y2: staffBottom,
          class: "notation-measure-line",
        }),
        createSvgElement(
          "text",
          {
            x: x + 3,
            y: staffTop - 8,
            class: "notation-measure-number",
          },
          measure.number,
        ),
      );
    }

    this.eventNodes = [];
    this.activeNodes.clear();
    for (const event of this.eventsByPart.get(this.partId) ?? []) {
      this.renderEvent(event, clef, group, staffBottom);
    }

    this.svg.setAttribute("viewBox", `0 0 ${totalWidth} ${STAFF_HEIGHT}`);
    this.svg.setAttribute("width", totalWidth);
    this.svg.setAttribute("height", STAFF_HEIGHT);
    this.svg.style.width = `${totalWidth}px`;
    this.svg.style.height = `${STAFF_HEIGHT}px`;
    this.svg.replaceChildren(group);
    this.updateActiveNotes();
    this.updateAriaLabel(part);

    if (preservePosition) {
      this.scrollToPosition(this.position);
    }
  }

  updateActiveNotes() {
    const nextActive = new Set();
    for (const item of this.eventNodes) {
      if (item.event.startSeconds > this.position + 0.02) {
        break;
      }
      if (
        item.event.startSeconds + item.event.durationSeconds >
        this.position
      ) {
        nextActive.add(item.element);
      }
    }

    for (const element of this.activeNodes) {
      if (!nextActive.has(element)) {
        element.classList.remove("is-active");
      }
    }
    for (const element of nextActive) {
      if (!this.activeNodes.has(element)) {
        element.classList.add("is-active");
      }
    }
    this.activeNodes = nextActive;
  }

  updateAriaLabel(part = null) {
    const selectedPart =
      part ??
      this.score?.parts.find((candidate) => candidate.id === this.partId);
    if (!selectedPart) {
      return;
    }
    this.container.setAttribute(
      "aria-label",
      `${selectedPart.name} 악보, ${Math.floor(this.position / 60)}분 ${Math.floor(this.position % 60)}초`,
    );
  }

  scrollToPosition(position) {
    const target = scrollLeftForPosition(position);
    if (Math.abs(this.container.scrollLeft - target) < 0.5) {
      return;
    }
    this.programmaticUntil = performance.now() + 140;
    this.container.scrollLeft = target;
  }

  render(position = this.position, force = false) {
    if (!this.score || !this.partId) {
      return;
    }

    this.position = clamp(
      Number(position) || 0,
      0,
      this.score.duration,
    );
    if (force && !this.eventNodes.length) {
      this.buildTimeline(true);
      return;
    }

    this.updateActiveNotes();
    this.updateAriaLabel();
    if (force || performance.now() >= this.exploringUntil) {
      this.scrollToPosition(this.position);
    }
  }
}
