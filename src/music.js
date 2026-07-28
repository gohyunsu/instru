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
  "Do",
  "Di",
  "Re",
  "Ri",
  "Mi",
  "Fa",
  "Fi",
  "Sol",
  "Si",
  "La",
  "Li",
  "Ti",
];

export const DEFAULT_CONCERT_A = 440;
export const EXACT_CENTS = 8;

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

  if (magnitude <= EXACT_CENTS) {
    return { direction: "exact", label: "In tune", symbol: "" };
  }

  if (cents > 0) {
    return {
      direction: "high",
      label: magnitude <= 20 ? "Slightly sharp" : "Sharp",
      symbol: "↑",
    };
  }

  return {
    direction: "low",
    label: magnitude <= 20 ? "Slightly flat" : "Flat",
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
