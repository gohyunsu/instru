const VOICE_NAMES = new Map([
  ["soprano", "Soprano"],
  ["alto", "Alto"],
  ["tenor", "Tenor"],
  ["baritone", "Baritone"],
  ["bass", "Bass"],
  ["소프라노", "Soprano"],
  ["알토", "Alto"],
  ["테너", "Tenor"],
  ["바리톤", "Baritone"],
  ["베이스", "Bass"],
]);

function normalizedName(part) {
  if (part.isPercussion) return "Percussion";

  const original = String(part.name ?? "").trim();
  const cleaned = original.replace(/[_,.]+/g, " ").replace(/\s+/g, " ").trim();
  const voice = cleaned.match(
    /(?:^|\s)(soprano|alto|tenor|baritone|bass|소프라노|알토|테너|바리톤|베이스)\s*(\d+)?$/i,
  );
  if (voice) {
    const name = VOICE_NAMES.get(voice[1].toLowerCase());
    return voice[2] ? `${name} ${voice[2]}` : name;
  }

  const abbreviation = cleaned.toUpperCase();
  if (abbreviation === "S") return "Soprano";
  if (abbreviation === "A") return "Alto";
  if (abbreviation === "T") return "Tenor";
  return cleaned || "Part";
}

export function normalizeScoreParts(parts = [], sourceName = "") {
  const fileName = String(sourceName).split(/[\\/]/).pop().toLowerCase();
  const loveYourself = fileName === "love-yourself.mscz" || fileName === "love-yourself.mscx";
  const ipanema = fileName === "the-girl-from-ipanema.mscz" || fileName === "the-girl-from-ipanema.mscx";
  const shortNames = parts.map((part) => String(part.name ?? "").trim().toUpperCase());
  const isSatbb = loveYourself && shortNames.join(",") === "S,A,T,B,B";
  const unlabeledVoices = ipanema && parts.length === 6 &&
    parts.every((part) => /^piano$/i.test(String(part.name ?? "").trim()));

  const names = parts.map((part, index) => {
    if (isSatbb) return ["Soprano", "Alto", "Tenor", "Baritone", "Bass"][index];
    if (unlabeledVoices) return `Voice ${index + 1}`;
    return normalizedName(part);
  });
  const totals = new Map();
  for (const name of names) totals.set(name, (totals.get(name) ?? 0) + 1);
  const seen = new Map();

  return parts.map((part, index) => {
    const name = names[index];
    const next = (seen.get(name) ?? 0) + 1;
    seen.set(name, next);
    return { ...part, name: totals.get(name) > 1 ? `${name} ${next}` : name };
  });
}
