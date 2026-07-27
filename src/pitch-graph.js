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
    const exactLeft = this.xForCents(-5, left, plotWidth);
    const exactRight = this.xForCents(5, left, plotWidth);

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
    const chunks = [];
    let chunk = [];

    for (const point of visible) {
      const previous = chunk.at(-1);
      const disconnected =
        point.gap ||
        (previous &&
          (point.time - previous.time > MAX_GAP_MS ||
            point.note !== previous.note));

      if (disconnected) {
        if (chunk.length > 1) {
          chunks.push(chunk);
        }
        chunk = [];
      }
      if (!point.gap) {
        chunk.push(point);
      }
    }
    if (chunk.length > 1) {
      chunks.push(chunk);
    }

    const pitchGradient = context.createLinearGradient(
      left,
      0,
      left + plotWidth,
      0,
    );
    pitchGradient.addColorStop(0, colors.low);
    pitchGradient.addColorStop(0.42, colors.low);
    pitchGradient.addColorStop(0.48, colors.accent);
    pitchGradient.addColorStop(0.52, colors.accent);
    pitchGradient.addColorStop(0.58, colors.high);
    pitchGradient.addColorStop(1, colors.high);

    for (const points of chunks) {
      const mapped = points.map((point) => ({
        x: this.xForCents(point.cents, left, plotWidth),
        y: this.yForTime(point.time, now, top, plotHeight),
      }));
      const confidence =
        points.reduce((sum, point) => sum + point.confidence, 0) /
        points.length;
      const newestAge = now - points.at(-1).time;
      const ageAlpha = 0.32 + 0.68 * clamp(1 - newestAge / HISTORY_MS, 0, 1);

      context.save();
      context.globalAlpha = ageAlpha * clamp(confidence, 0.45, 1);
      context.strokeStyle = pitchGradient;
      context.lineWidth = 2.6;
      context.lineCap = "round";
      context.lineJoin = "round";
      context.shadowBlur = 5;
      context.shadowColor = colors.accentSoft;
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

      context.stroke();
      context.restore();
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
