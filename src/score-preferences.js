import { preferredTenorPart } from "./musescore-parser.js";

const BARITONE_DEFAULT_SCORES = new Set([
  "disney-medley",
  "a-sky-full-of-stars",
]);

function scoreSlug(value) {
  return String(value ?? "")
    .split(/[\\/]/)
    .pop()
    .replace(/\.(mscz|mscx)$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function preferredNotationPart(score) {
  const parts = score.parts ?? [];
  const wantsBaritone = [score.sourceName, score.title]
    .some((name) => BARITONE_DEFAULT_SCORES.has(scoreSlug(name)));
  if (wantsBaritone) {
    const baritone = parts.find((part) =>
      /^(baritone|바리톤)/i.test(String(part.name ?? "").trim()),
    );
    if (baritone) return baritone;
  }
  return preferredTenorPart(parts);
}
