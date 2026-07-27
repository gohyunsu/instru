const HISTORY_MS = 8000;
const MAX_GAP_MS = 190;

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

export class VerticalPitchGraph {
  constructor(canvas) {
    this.canvas = canvas;
    this.context = canvas.getContext("2d");
    this.points = [];
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
    this.points.push({ time, cents, note, confidence });
    this.trim(time);
  }

  addGap(time = performance.now()) {
    const previous = this.points.at(-1);
    if (!previous || previous.gap) {
      return;
    }
    this.points.push({ time, gap: true });
  }

  clear() {
    this.points = [];
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
    return left + ((clamp(cents, -50, 50) + 50) / 100) * width;
  }

  yForTime(time, now, top, height) {
    const age = now - time;
    return top + (1 - age / HISTORY_MS) * height;
  }

  drawGrid(colors, left, top, plotWidth, plotHeight) {
    const context = this.context;
    const exactLeft = this.xForCents(-10, left, plotWidth);
    const exactRight = this.xForCents(10, left, plotWidth);

    context.fillStyle = colors.accentSoft;
    context.fillRect(exactLeft, top, exactRight - exactLeft, plotHeight);

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
    let previous = null;

    for (const point of visible) {
      if (point.gap) {
        previous = null;
        continue;
      }

      const x = this.xForCents(point.cents, left, plotWidth);
      const y = this.yForTime(point.time, now, top, plotHeight);

      if (
        previous &&
        point.time - previous.time <= MAX_GAP_MS &&
        point.note === previous.note
      ) {
        const previousX = this.xForCents(previous.cents, left, plotWidth);
        const previousY = this.yForTime(previous.time, now, top, plotHeight);
        const ageRatio = clamp(1 - (now - point.time) / HISTORY_MS, 0, 1);
        const alpha = (0.22 + ageRatio * 0.78) * clamp(point.confidence, 0.35, 1);
        const color =
          Math.abs(point.cents) <= 5
            ? colors.accent
            : point.cents < 0
              ? colors.low
              : colors.high;

        context.save();
        context.globalAlpha = alpha;
        context.beginPath();
        context.strokeStyle = color;
        context.lineWidth = 2.35;
        context.lineCap = "round";
        context.lineJoin = "round";
        context.moveTo(previousX, previousY);
        context.lineTo(x, y);
        context.stroke();
        context.restore();
      }

      previous = point;
    }

    const latest = [...visible].reverse().find((point) => !point.gap);
    if (!latest || now - latest.time > 260) {
      return;
    }

    const latestX = this.xForCents(latest.cents, left, plotWidth);
    const latestY = this.yForTime(latest.time, now, top, plotHeight);
    const color =
      Math.abs(latest.cents) <= 5
        ? colors.accent
        : latest.cents < 0
          ? colors.low
          : colors.high;

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
