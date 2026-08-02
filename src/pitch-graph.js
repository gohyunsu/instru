import { EXACT_CENTS } from "./music.js";

const HISTORY_MS = 8000;
const MAX_GAP_MS = 260;
export const GRAPH_CENTS_RANGE = 60;

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function wrapBoundary(previous, point) {
  const noteDelta = point.note - previous.note;
  if (Math.abs(noteDelta) !== 1) {
    return null;
  }

  const direction = Math.sign(noteDelta);
  const previousCents = previous.cents;
  const nextUnwrappedCents = point.cents + noteDelta * 100;
  const crossingCents = direction * 50;
  const centsDelta = nextUnwrappedCents - previousCents;
  const crossingRatio =
    Math.abs(centsDelta) > 0.001
      ? clamp((crossingCents - previousCents) / centsDelta, 0, 1)
      : 0.5;
  const time =
    previous.time + (point.time - previous.time) * crossingRatio;
  const confidence = Math.min(
    previous.confidence ?? 1,
    point.confidence ?? 1,
  );

  return {
    outgoing: {
      ...previous,
      time,
      cents: direction * GRAPH_CENTS_RANGE,
      trendCents: direction * GRAPH_CENTS_RANGE,
      confidence,
    },
    incoming: {
      ...point,
      time,
      cents: -direction * GRAPH_CENTS_RANGE,
      trendCents: -direction * GRAPH_CENTS_RANGE,
      confidence,
    },
  };
}

export function splitPitchTrace(points, maxGapMs = MAX_GAP_MS) {
  const chunks = [];
  let chunk = [];

  for (const point of points) {
    const previous = chunk.at(-1);
    if (point.gap) {
      if (chunk.length) {
        chunks.push(chunk);
      }
      chunk = [];
      continue;
    }

    if (previous && point.time - previous.time > maxGapMs) {
      chunks.push(chunk);
      chunk = [point];
      continue;
    }

    if (previous && point.note !== previous.note) {
      const boundary = wrapBoundary(previous, point);
      if (boundary) {
        chunk.push(boundary.outgoing);
        chunks.push(chunk);
        chunk = [boundary.incoming, point];
      } else {
        chunks.push(chunk);
        chunk = [point];
      }
      continue;
    }

    chunk.push(point);
  }

  if (chunk.length) {
    chunks.push(chunk);
  }
  return chunks;
}

export class PitchTraceSmoother {
  constructor({ windowSize = 3, stableTimeMs = 230, movingTimeMs = 105 } = {}) {
    this.windowSize = windowSize;
    this.stableTimeMs = stableTimeMs;
    this.movingTimeMs = movingTimeMs;
    this.reset();
  }

  reset() {
    this.note = null;
    this.samples = [];
    this.value = null;
    this.lastTime = null;
  }

  update({ time, cents, note, confidence = 1 }) {
    const noteChanged = this.note !== null && note !== this.note;
    const stale =
      this.lastTime !== null && time - this.lastTime > MAX_GAP_MS;

    if (noteChanged || stale || this.value === null) {
      this.note = note;
      this.samples = [cents];
      this.value = cents;
      this.lastTime = time;
      return cents;
    }

    this.note = note;
    this.samples.push(cents);
    if (this.samples.length > this.windowSize) {
      this.samples.shift();
    }

    const target = median(this.samples);
    const distance = Math.abs(target - this.value);
    const timeConstant =
      distance > 11 ? this.movingTimeMs : this.stableTimeMs;
    const elapsed = clamp(time - this.lastTime, 16, MAX_GAP_MS);
    const baseAlpha = 1 - Math.exp(-elapsed / timeConstant);
    const confidenceWeight = 0.7 + 0.3 * clamp(confidence, 0, 1);
    this.value += (target - this.value) * baseAlpha * confidenceWeight;
    this.lastTime = time;
    return this.value;
  }
}

export class VerticalPitchGraph {
  constructor(canvas) {
    this.canvas = canvas;
    this.context = canvas.getContext("2d");
    this.points = [];
    this.smoother = new PitchTraceSmoother();
    this.width = 0;
    this.height = 0;
    this.running = true;
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();
    this.draw = this.draw.bind(this);
    this.frameRequest = requestAnimationFrame(this.draw);
  }

  addPoint({ time = performance.now(), cents, note, confidence = 1 }) {
    const trendCents = this.smoother.update({
      time,
      cents,
      note,
      confidence,
    });
    this.points.push({ time, cents, trendCents, note, confidence });
    this.trim(time);
  }

  addGap(time = performance.now()) {
    const previous = this.points.at(-1);
    if (previous && !previous.gap) {
      this.points.push({ time, gap: true });
    }
    this.smoother.reset();
  }

  clear() {
    this.points = [];
    this.smoother.reset();
  }

  refreshTheme() {
    this.colors = null;
  }

  trim(now) {
    const cutoff = now - HISTORY_MS - 500;
    const firstValidIndex = this.points.findIndex((point) => point.time >= cutoff);
    if (firstValidIndex > 0) {
      this.points.splice(0, firstValidIndex);
    } else if (firstValidIndex === -1) {
      this.points = [];
    }
  }

  resize() {
    const bounds = this.canvas.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(bounds.width));
    const height = Math.max(1, Math.round(bounds.height));

    if (width === this.width && height === this.height && ratio === this.ratio) {
      return;
    }

    this.width = width;
    this.height = height;
    this.ratio = ratio;
    this.canvas.width = Math.round(width * ratio);
    this.canvas.height = Math.round(height * ratio);
    this.context.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  readColors() {
    if (this.colors) {
      return this.colors;
    }

    const styles = getComputedStyle(document.documentElement);
    this.colors = {
      line: styles.getPropertyValue("--line").trim(),
      lineStrong: styles.getPropertyValue("--line-strong").trim(),
      accent: styles.getPropertyValue("--accent").trim(),
      accentSoft: styles.getPropertyValue("--accent-soft").trim(),
      low: styles.getPropertyValue("--low").trim(),
      high: styles.getPropertyValue("--high").trim(),
      surface: styles.getPropertyValue("--surface-strong").trim(),
    };
    return this.colors;
  }

  xForCents(cents, left, width) {
    const range = GRAPH_CENTS_RANGE;
    return left + ((clamp(cents, -range, range) + range) / (range * 2)) * width;
  }

  yForTime(time, now, top, height) {
    const age = now - time;
    return top + (1 - age / HISTORY_MS) * height;
  }

  drawGrid(colors, left, top, plotWidth, plotHeight) {
    const context = this.context;
    const exactLeft = this.xForCents(-EXACT_CENTS, left, plotWidth);
    const exactRight = this.xForCents(EXACT_CENTS, left, plotWidth);

    context.save();
    context.globalAlpha = 0.82;
    context.fillStyle = colors.accentSoft;
    context.fillRect(exactLeft, top, exactRight - exactLeft, plotHeight);
    context.restore();

    for (const cents of [-50, -25, 0, 25, 50]) {
      const x = this.xForCents(cents, left, plotWidth);
      context.beginPath();
      context.strokeStyle = cents === 0 ? colors.lineStrong : colors.line;
      context.lineWidth = cents === 0 ? 1.25 : 1;
      context.setLineDash(cents === 0 ? [] : [2, 6]);
      context.moveTo(x, top);
      context.lineTo(x, top + plotHeight);
      context.stroke();
    }

    for (let seconds = 2; seconds < 8; seconds += 2) {
      const y = top + (seconds / 8) * plotHeight;
      context.beginPath();
      context.strokeStyle = colors.line;
      context.lineWidth = 1;
      context.setLineDash([2, 7]);
      context.moveTo(left, y);
      context.lineTo(left + plotWidth, y);
      context.stroke();
    }

    context.setLineDash([]);
  }

  drawTrace(colors, now, left, top, plotWidth, plotHeight) {
    const context = this.context;
    const visible = this.points.filter(
      (point) => point.time >= now - HISTORY_MS && point.time <= now + 50,
    );
    const chunks = splitPitchTrace(visible).filter(
      (points) => points.length > 1,
    );

    const pitchGradient = context.createLinearGradient(
      left,
      0,
      left + plotWidth,
      0,
    );
    pitchGradient.addColorStop(0, colors.low);
    pitchGradient.addColorStop(0.4, colors.low);
    pitchGradient.addColorStop(0.45, colors.accent);
    pitchGradient.addColorStop(0.55, colors.accent);
    pitchGradient.addColorStop(0.6, colors.high);
    pitchGradient.addColorStop(1, colors.high);

    const drawChunks = ({
      valueKey,
      lineWidth,
      glowWidth = 0,
      alpha = 1,
    }) => {
      for (const points of chunks) {
        const mapped = points.map((point) => ({
          x: this.xForCents(point[valueKey], left, plotWidth),
          y: this.yForTime(point.time, now, top, plotHeight),
        }));
        const confidence =
          points.reduce((sum, point) => sum + point.confidence, 0) /
          points.length;
        const newestAge = now - points.at(-1).time;
        const ageAlpha =
          0.32 + 0.68 * clamp(1 - newestAge / HISTORY_MS, 0, 1);

        context.save();
        context.globalAlpha =
          alpha * ageAlpha * clamp(confidence, 0.45, 1);
        context.lineCap = "round";
        context.lineJoin = "round";
        context.beginPath();
        context.moveTo(mapped[0].x, mapped[0].y);

        if (mapped.length === 2) {
          context.lineTo(mapped[1].x, mapped[1].y);
        } else {
          for (let index = 1; index < mapped.length - 1; index += 1) {
            const current = mapped[index];
            const next = mapped[index + 1];
            const midpointX = (current.x + next.x) / 2;
            const midpointY = (current.y + next.y) / 2;
            context.quadraticCurveTo(
              current.x,
              current.y,
              midpointX,
              midpointY,
            );
          }
          const last = mapped.at(-1);
          context.quadraticCurveTo(last.x, last.y, last.x, last.y);
        }

        if (glowWidth > 0) {
          context.strokeStyle = colors.accentSoft;
          context.lineWidth = glowWidth;
          context.shadowBlur = 12;
          context.shadowColor = colors.accentSoft;
          context.stroke();
        }
        context.strokeStyle = pitchGradient;
        context.lineWidth = lineWidth;
        context.shadowBlur = glowWidth > 0 ? 5 : 0;
        context.stroke();
        context.restore();
      }
    };

    drawChunks({
      valueKey: "cents",
      lineWidth: 1.15,
      alpha: 0.24,
    });
    drawChunks({
      valueKey: "trendCents",
      lineWidth: 2.8,
      glowWidth: 6.5,
      alpha: 0.94,
    });

    const latest = [...visible].reverse().find((point) => !point.gap);
    if (!latest || now - latest.time > MAX_GAP_MS) {
      return;
    }

    const latestX = this.xForCents(latest.trendCents, left, plotWidth);
    const latestY = this.yForTime(latest.time, now, top, plotHeight);
    const color =
      Math.abs(latest.trendCents) <= EXACT_CENTS
        ? colors.accent
        : latest.trendCents < 0
          ? colors.low
          : colors.high;

    context.beginPath();
    context.fillStyle = colors.accentSoft;
    context.arc(latestX, latestY, 8, 0, Math.PI * 2);
    context.fill();
    context.beginPath();
    context.fillStyle = colors.surface;
    context.arc(latestX, latestY, 5.5, 0, Math.PI * 2);
    context.fill();
    context.beginPath();
    context.fillStyle = color;
    context.arc(latestX, latestY, 3.5, 0, Math.PI * 2);
    context.fill();
  }

  draw(now) {
    this.trim(now);
    const colors = this.readColors();
    const context = this.context;
    const left = 28;
    const right = 8;
    const top = 7;
    const bottom = 8;
    const plotWidth = Math.max(1, this.width - left - right);
    const plotHeight = Math.max(1, this.height - top - bottom);

    context.clearRect(0, 0, this.width, this.height);
    this.drawGrid(colors, left, top, plotWidth, plotHeight);
    this.drawTrace(colors, now, left, top, plotWidth, plotHeight);
    this.frameRequest = requestAnimationFrame(this.draw);
  }

  destroy() {
    cancelAnimationFrame(this.frameRequest);
    this.resizeObserver.disconnect();
  }
}
