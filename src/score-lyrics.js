const CONTEXT_MEASURES = 2;

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

export function measureIndexAtPosition(measures, position) {
  if (!measures.length) {
    return 0;
  }

  let low = 0;
  let high = measures.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (measures[middle].startSeconds <= position) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return clamp(low - 1, 0, measures.length - 1);
}

export function lyricTokenText(lyric) {
  return ["begin", "middle"].includes(lyric.syllabic)
    ? `${lyric.text}-`
    : lyric.text;
}

export function lyricContext(
  score,
  partId,
  position,
  radius = CONTEXT_MEASURES,
) {
  const partLyrics = (score.lyrics ?? []).filter(
    (lyric) => lyric.partId === partId,
  );
  if (!partLyrics.length) {
    return {
      currentMeasureIndex: measureIndexAtPosition(
        score.measures ?? [],
        position,
      ),
      lyrics: [],
      startMeasureIndex: 0,
      endMeasureIndex: 0,
    };
  }

  const verse = Math.min(...partLyrics.map((lyric) => lyric.verse ?? 0));
  const verseLyrics = partLyrics.filter(
    (lyric) => (lyric.verse ?? 0) === verse,
  );
  const currentMeasureIndex = measureIndexAtPosition(
    score.measures ?? [],
    position,
  );
  const startMeasureIndex = Math.max(0, currentMeasureIndex - radius);
  const endMeasureIndex = Math.min(
    Math.max(0, (score.measures?.length ?? 1) - 1),
    currentMeasureIndex + radius,
  );

  return {
    currentMeasureIndex,
    startMeasureIndex,
    endMeasureIndex,
    lyrics: verseLyrics.filter(
      (lyric) =>
        lyric.measureIndex >= startMeasureIndex &&
        lyric.measureIndex <= endMeasureIndex,
    ),
  };
}

export function activeLyricId(lyrics, position) {
  let active = null;
  for (let index = 0; index < lyrics.length; index += 1) {
    const lyric = lyrics[index];
    if (lyric.startSeconds > position + 0.02) {
      break;
    }
    const next = lyrics[index + 1];
    const naturalEnd = Math.max(
      lyric.endSeconds,
      lyric.startSeconds + 1.4,
    );
    const activeUntil = next
      ? Math.min(next.startSeconds, naturalEnd)
      : naturalEnd;
    if (position <= activeUntil) {
      active = lyric.id;
    }
  }
  return active;
}

function uniqueLyrics(lyrics) {
  const seen = new Set();
  return lyrics.filter((lyric) => {
    const key = `${lyric.startTick}:${lyric.text}:${lyric.verse}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export class LiveLyrics {
  constructor({ panel, partLabel, track, empty }) {
    this.panel = panel;
    this.partLabel = partLabel;
    this.track = track;
    this.empty = empty;
    this.score = null;
    this.partId = null;
    this.position = 0;
    this.contextKey = "";
    this.contextLyrics = [];
    this.allPartLyrics = [];
    this.tokenElements = new Map();
    this.lastActiveId = null;
    this.scrollFrame = null;
  }

  setScore(score) {
    this.score = score;
    this.clearPart();
  }

  clear() {
    this.score = null;
    this.clearPart();
  }

  setPart(partId) {
    if (!this.score || !partId) {
      this.clearPart();
      return;
    }

    const part = this.score.parts.find((candidate) => candidate.id === partId);
    if (!part) {
      this.clearPart();
      return;
    }

    this.partId = partId;
    this.contextKey = "";
    this.partLabel.textContent = part.name;
    this.allPartLyrics = uniqueLyrics(
      (this.score.lyrics ?? [])
        .filter((lyric) => lyric.partId === partId)
        .sort((left, right) => left.startSeconds - right.startSeconds),
    );
    this.panel.classList.add("is-visible");
    this.panel.setAttribute("aria-hidden", "false");
    this.panel.setAttribute("aria-label", `${part.name} 가사`);
    this.render(this.position, true);
  }

  clearPart() {
    this.partId = null;
    this.contextKey = "";
    this.contextLyrics = [];
    this.allPartLyrics = [];
    this.tokenElements.clear();
    this.lastActiveId = null;
    this.track.replaceChildren();
    this.empty.hidden = true;
    this.panel.classList.remove("is-visible");
    this.panel.setAttribute("aria-hidden", "true");
  }

  buildContext(context) {
    this.contextLyrics = uniqueLyrics(context.lyrics);
    this.tokenElements.clear();
    this.track.replaceChildren();
    this.empty.hidden = Boolean(this.contextLyrics.length);

    if (!this.contextLyrics.length) {
      this.empty.textContent = this.allPartLyrics.length
        ? "이 구간에는 가사가 없습니다"
        : "가사 없음";
      return;
    }

    const lyricsByMeasure = new Map();
    for (const lyric of this.contextLyrics) {
      if (!lyricsByMeasure.has(lyric.measureIndex)) {
        lyricsByMeasure.set(lyric.measureIndex, []);
      }
      lyricsByMeasure.get(lyric.measureIndex).push(lyric);
    }

    for (const [measureIndex, lyrics] of lyricsByMeasure) {
      const measure = document.createElement("span");
      const distance = Math.abs(
        measureIndex - context.currentMeasureIndex,
      );
      measure.className =
        `lyric-measure${distance === 0 ? " is-current" : ""}${distance === 1 ? " is-near" : ""}`;
      measure.dataset.measureIndex = String(measureIndex);

      for (const lyric of lyrics) {
        const token = document.createElement("span");
        token.className = "lyric-token";
        token.dataset.lyricId = lyric.id;
        token.textContent = lyricTokenText(lyric);
        measure.append(token);
        this.tokenElements.set(lyric.id, token);
      }
      this.track.append(measure);
    }

    this.track.classList.remove("is-entering");
    void this.track.offsetWidth;
    this.track.classList.add("is-entering");

    const currentMeasure = this.track.querySelector(
      `.lyric-measure[data-measure-index="${context.currentMeasureIndex}"]`,
    );
    this.scheduleScroll(currentMeasure, "smooth");
  }

  scheduleScroll(element, behavior = "smooth") {
    if (!element) {
      return;
    }
    if (this.scrollFrame) {
      cancelAnimationFrame(this.scrollFrame);
    }
    this.scrollFrame = requestAnimationFrame(() => {
      element.scrollIntoView({
        behavior,
        block: "nearest",
        inline: "center",
      });
      this.scrollFrame = null;
    });
  }

  updateActiveToken() {
    const activeId = activeLyricId(this.allPartLyrics, this.position);
    if (activeId === this.lastActiveId) {
      return;
    }

    this.tokenElements
      .get(this.lastActiveId)
      ?.classList.remove("is-active");
    const activeElement = this.tokenElements.get(activeId);
    activeElement?.classList.add("is-active");
    if (activeElement) {
      this.scheduleScroll(activeElement);
    }
    this.lastActiveId = activeId;

    for (const [lyricId, element] of this.tokenElements) {
      const lyric = this.contextLyrics.find(
        (candidate) => candidate.id === lyricId,
      );
      element.classList.toggle(
        "is-past",
        Boolean(lyric && lyric.startSeconds < this.position && lyricId !== activeId),
      );
    }
  }

  render(position = this.position, force = false) {
    this.position = Math.max(0, Number(position) || 0);
    if (!this.score || !this.partId) {
      return;
    }

    const context = lyricContext(
      this.score,
      this.partId,
      this.position,
    );
    const key = `${this.partId}:${context.startMeasureIndex}:${context.endMeasureIndex}:${context.currentMeasureIndex}`;
    if (force || key !== this.contextKey) {
      this.contextKey = key;
      this.buildContext(context);
    }
    this.updateActiveToken();
  }
}
