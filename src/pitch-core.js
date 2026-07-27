export function calculateRms(buffer) {
  if (!buffer.length) {
    return 0;
  }

  let sum = 0;
  for (let index = 0; index < buffer.length; index += 1) {
    const sample = buffer[index];
    sum += sample * sample;
  }

  return Math.sqrt(sum / buffer.length);
}

/**
 * Estimate the fundamental frequency with the YIN difference function.
 * Returns null frequency for silence, noisy frames, or an ambiguous period.
 */
export function detectPitch(
  buffer,
  sampleRate,
  {
    minFrequency = 55,
    maxFrequency = 1200,
    threshold = 0.13,
    fallbackThreshold = 0.32,
    rmsThreshold = 0.007,
  } = {},
) {
  const rms = calculateRms(buffer);
  if (rms < rmsThreshold) {
    return { frequency: null, confidence: 0, rms };
  }

  const minTau = Math.max(2, Math.floor(sampleRate / maxFrequency));
  const maxTau = Math.min(
    Math.floor(sampleRate / minFrequency),
    Math.floor(buffer.length / 2),
  );
  const comparisonLength = buffer.length - maxTau;

  if (maxTau <= minTau || comparisonLength < 64) {
    return { frequency: null, confidence: 0, rms };
  }

  const difference = new Float32Array(maxTau + 1);
  for (let tau = 1; tau <= maxTau; tau += 1) {
    let sum = 0;
    for (let index = 0; index < comparisonLength; index += 1) {
      const delta = buffer[index] - buffer[index + tau];
      sum += delta * delta;
    }
    difference[tau] = sum;
  }

  const normalized = new Float32Array(maxTau + 1);
  normalized[0] = 1;
  let runningSum = 0;

  for (let tau = 1; tau <= maxTau; tau += 1) {
    runningSum += difference[tau];
    normalized[tau] =
      runningSum === 0 ? 1 : (difference[tau] * tau) / runningSum;
  }

  let selectedTau = -1;
  for (let tau = minTau; tau <= maxTau; tau += 1) {
    if (normalized[tau] >= threshold) {
      continue;
    }

    while (
      tau + 1 <= maxTau &&
      normalized[tau + 1] < normalized[tau]
    ) {
      tau += 1;
    }
    selectedTau = tau;
    break;
  }

  if (selectedTau === -1) {
    let bestValue = Number.POSITIVE_INFINITY;
    for (let tau = minTau; tau <= maxTau; tau += 1) {
      if (normalized[tau] < bestValue) {
        bestValue = normalized[tau];
        selectedTau = tau;
      }
    }

    if (bestValue > fallbackThreshold) {
      return { frequency: null, confidence: Math.max(0, 1 - bestValue), rms };
    }
  }

  const previous = normalized[selectedTau - 1] ?? normalized[selectedTau];
  const current = normalized[selectedTau];
  const next = normalized[selectedTau + 1] ?? normalized[selectedTau];
  const denominator = 2 * (2 * current - previous - next);
  const correction =
    denominator === 0 ? 0 : (next - previous) / denominator;
  const refinedTau = selectedTau + Math.max(-1, Math.min(1, correction));
  const frequency = sampleRate / refinedTau;
  const confidence = Math.max(0, Math.min(1, 1 - current));

  if (
    !Number.isFinite(frequency) ||
    frequency < minFrequency * 0.98 ||
    frequency > maxFrequency * 1.02
  ) {
    return { frequency: null, confidence, rms };
  }

  return { frequency, confidence, rms };
}
