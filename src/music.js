export const NOTE_NAMES = [
  "C",
  "C♯",
  "D",
  "D♯",
  "E",
  "F",
  "F♯",
  "G",
  "G♯",
  "A",
  "A♯",
  "B",
];

export const SOLFEGE_NAMES = [
  "도",
  "도♯",
  "레",
  "레♯",
  "미",
  "파",
  "파♯",
  "솔",
  "솔♯",
  "라",
  "라♯",
  "시",
];

export const DEFAULT_CONCERT_A = 440;

export function frequencyToMidi(frequency, concertA = DEFAULT_CONCERT_A) {
  if (!Number.isFinite(frequency) || frequency <= 0) {
    return null;
  }

  return 69 + 12 * Math.log2(frequency / concertA);
}

export function midiToFrequency(midi, concertA = DEFAULT_CONCERT_A) {
  return concertA * 2 ** ((midi - 69) / 12);
}

export function midiToNote(midi) {
  const roundedMidi = Math.round(midi);
  const noteIndex = ((roundedMidi % 12) + 12) % 12;

  return {
    midi: roundedMidi,
    name: NOTE_NAMES[noteIndex],
    solfege: SOLFEGE_NAMES[noteIndex],
    octave: Math.floor(roundedMidi / 12) - 1,
  };
}

export function formatNote(midi) {
  const note = midiToNote(midi);
  return `${note.name}${note.octave}`;
}

export function measurementFromMidi(
  midi,
  concertA = DEFAULT_CONCERT_A,
  targetMidi = Math.round(midi),
) {
  const note = midiToNote(targetMidi);
  const cents = (midi - note.midi) * 100;

  return {
    ...note,
    cents,
    frequency: midiToFrequency(midi, concertA),
    targetFrequency: midiToFrequency(note.midi, concertA),
    label: `${note.name}${note.octave}`,
  };
}

export function describeCents(cents) {
  const magnitude = Math.abs(cents);

  if (magnitude <= 5) {
    return { direction: "exact", label: "정확해요", symbol: "" };
  }

  if (cents > 0) {
    return {
      direction: "high",
      label: magnitude <= 20 ? "조금 높아요" : "높아요",
      symbol: "↑",
    };
  }

  return {
    direction: "low",
    label: magnitude <= 20 ? "조금 낮아요" : "낮아요",
    symbol: "↓",
  };
}

export function formatCents(cents) {
  const rounded = Math.round(cents);
  if (rounded === 0) {
    return "0¢";
  }
  return `${rounded > 0 ? "+" : "−"}${Math.abs(rounded)}¢`;
}
