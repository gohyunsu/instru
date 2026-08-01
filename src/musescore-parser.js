import { extractMuseScoreXml } from "./zip.js";

const DURATION_QUARTERS = {
  maxima: 32,
  longa: 16,
  breve: 8,
  whole: 4,
  half: 2,
  quarter: 1,
  eighth: 0.5,
  "16th": 0.25,
  "32nd": 0.125,
  "64th": 0.0625,
  "128th": 0.03125,
  "256th": 0.015625,
  "512th": 0.0078125,
  "1024th": 0.00390625,
};

const MAX_FILE_SIZE = 30 * 1024 * 1024;
const MAX_NOTES = 12000;
const MAX_DURATION_SECONDS = 60 * 60;

function directChildren(element, tagName) {
  return [...element.childNodes].filter(
    (child) => child.nodeType === 1 && child.tagName === tagName,
  );
}

function directChild(element, tagName) {
  return (
    [...element.childNodes].find(
      (child) => child.nodeType === 1 && child.tagName === tagName,
    ) ?? null
  );
}

function childText(element, tagName) {
  if (!element) {
    return "";
  }
  return directChild(element, tagName)?.textContent?.trim() ?? "";
}

export function fractionToTicks(fraction, division) {
  const match = String(fraction).trim().match(/^(-?\d+)\s*\/\s*(\d+)$/);
  if (!match || Number(match[2]) === 0) {
    return null;
  }
  return (Number(match[1]) / Number(match[2])) * division * 4;
}

export function durationToTicks(element, division, measureTicks) {
  const explicitDuration = childText(element, "duration");
  if (explicitDuration) {
    const ticks = fractionToTicks(explicitDuration, division);
    if (ticks !== null) {
      return ticks;
    }
  }

  const durationType = childText(element, "durationType") || "quarter";
  if (durationType === "measure") {
    return measureTicks;
  }

  const quarterLength = DURATION_QUARTERS[durationType] ?? 1;
  const dots = Math.max(0, Number(childText(element, "dots")) || 0);
  let dotMultiplier = 1;
  let addition = 0.5;
  for (let index = 0; index < dots; index += 1) {
    dotMultiplier += addition;
    addition /= 2;
  }
  return division * quarterLength * dotMultiplier;
}

export function buildTempoMap(tempoEvents, division) {
  const ordered = [...tempoEvents]
    .filter((event) => Number.isFinite(event.tick) && event.bpm > 0)
    .sort((left, right) => left.tick - right.tick);
  const deduplicated = [{ tick: 0, bpm: 120 }];

  for (const event of ordered) {
    const previous = deduplicated.at(-1);
    if (event.tick === previous.tick) {
      previous.bpm = event.bpm;
    } else {
      deduplicated.push({ tick: event.tick, bpm: event.bpm });
    }
  }

  let seconds = 0;
  for (let index = 0; index < deduplicated.length; index += 1) {
    const current = deduplicated[index];
    const previous = deduplicated[index - 1];
    if (previous) {
      seconds +=
        ((current.tick - previous.tick) * 60) / (previous.bpm * division);
    }
    current.seconds = seconds;
  }

  return deduplicated;
}

export function tickToSeconds(tick, tempoMap, division) {
  let tempo = tempoMap[0];
  for (let index = 1; index < tempoMap.length; index += 1) {
    if (tempoMap[index].tick > tick) {
      break;
    }
    tempo = tempoMap[index];
  }
  return tempo.seconds + ((tick - tempo.tick) * 60) / (tempo.bpm * division);
}

export function isPercussionPartName(name, instrumentId = "") {
  return /\b(percussion|drums?|drumset|drum kit)\b|타악|드럼/i.test(
    `${name} ${instrumentId}`,
  );
}

export function preferredTenorPart(parts = []) {
  const normalizedParts = parts.map((part) => ({
    part,
    name: String(part?.name ?? "").trim().toLocaleLowerCase(),
  }));
  const tenorNames = ["tenor", "테너"];

  return (
    normalizedParts.find(({ name }) => tenorNames.includes(name))?.part ??
    normalizedParts.find(({ name }) =>
      tenorNames.some((tenorName) => name.includes(tenorName)),
    )?.part ??
    null
  );
}

function staffClef(staff) {
  const clef = staff?.getElementsByTagName("Clef")[0];
  if (!clef) {
    return null;
  }
  const type =
    childText(clef, "concertClefType") ||
    childText(clef, "transposingClefType");
  if (type.startsWith("F")) {
    return type.includes("8vb") ? "bass-8vb" : "bass";
  }
  if (type.startsWith("G")) {
    if (type.includes("8vb")) {
      return "treble-8vb";
    }
    if (type.includes("8va")) {
      return "treble-8va";
    }
    return "treble";
  }
  return null;
}

function parseParts(scoreElement, staffElements) {
  const partElements = directChildren(scoreElement, "Part");
  let staffCursor = 0;

  return partElements.map((part, partIndex) => {
    const partStaffs = directChildren(part, "Staff");
    const staffIds = partStaffs
      .map((staff) => staff.getAttribute("id"))
      .filter(Boolean);

    if (!staffIds.length) {
      const count = Math.max(1, partStaffs.length);
      staffIds.push(
        ...staffElements
          .slice(staffCursor, staffCursor + count)
          .map((staff) => staff.getAttribute("id") || String(staffCursor + 1)),
      );
      staffCursor += count;
    }

    const instrument = directChild(part, "Instrument");
    const instrumentId = childText(instrument, "instrumentId");
    const rawName =
      childText(instrument, "longName") ||
      childText(part, "longName") ||
      childText(part, "trackName") ||
      childText(instrument, "trackName") ||
      instrumentId ||
      `Part ${partIndex + 1}`;

    return {
      id: `part-${partIndex + 1}`,
      name: rawName.replace(/^.*\./, "").replaceAll("_", " "),
      staffIds,
      clef:
        staffIds
          .map((staffId) =>
            staffClef(
              staffElements.find(
                (staff) => staff.getAttribute("id") === staffId,
              ),
            ),
          )
          .find(Boolean) ?? null,
      isPercussion:
        isPercussionPartName(rawName, instrumentId) ||
        childText(instrument, "useDrumset") === "1",
    };
  });
}

function partForStaff(parts, staffId, fallbackIndex) {
  return (
    parts.find((part) => part.staffIds.includes(staffId)) ??
    parts[Math.min(fallbackIndex, parts.length - 1)] ?? {
      id: `part-${fallbackIndex + 1}`,
      name: `Part ${fallbackIndex + 1}`,
      staffIds: [staffId],
    }
  );
}

function hasTieStart(note) {
  return [...note.getElementsByTagName("Spanner")].some(
    (spanner) =>
      spanner.getAttribute("type") === "Tie" &&
      spanner.getElementsByTagName("Tie").length > 0 &&
      spanner.getElementsByTagName("prev").length === 0,
  );
}

function hasTiePrevious(note) {
  return [...note.getElementsByTagName("Spanner")].some(
    (spanner) =>
      spanner.getAttribute("type") === "Tie" &&
      spanner.getElementsByTagName("prev").length > 0,
  );
}

function scoreTitle(scoreElement, fallbackName) {
  const titleNames = ["workTitle", "movementTitle"];
  const genericTitles = new Set([
    "이름 없는 악보",
    "Untitled score",
    "untitled score",
    "untitled",
  ]);

  for (const name of titleNames) {
    const meta = [...scoreElement.getElementsByTagName("metaTag")].find(
      (candidate) => candidate.getAttribute("name") === name,
    );
    const value = meta?.textContent?.trim();
    if (value && !genericTitles.has(value.toLowerCase())) {
      return value;
    }
  }

  const titleText = [...scoreElement.getElementsByTagName("Text")].find(
    (textElement) => childText(textElement, "style") === "title",
  );
  const visibleTitle = titleText ? childText(titleText, "text") : "";
  if (visibleTitle) {
    return visibleTitle.replace(/\s+/g, " ").trim();
  }

  return fallbackName.replace(/\.(mscz|mscx)$/i, "") || "Untitled";
}

export function parseMuseScoreXml(xml, fallbackName = "MuseScore") {
  if (typeof DOMParser === "undefined") {
    throw new Error("XML_PARSER_UNSUPPORTED");
  }

  const document = new DOMParser().parseFromString(xml, "application/xml");
  if (document.getElementsByTagName("parsererror").length > 0) {
    throw new Error("INVALID_MSCX");
  }

  const scoreElement = document.getElementsByTagName("Score")[0];
  if (!scoreElement) {
    throw new Error("INVALID_MSCX");
  }

  const division = Number(childText(scoreElement, "Division")) || 480;
  const staffElements = directChildren(scoreElement, "Staff");
  let parts = parseParts(scoreElement, staffElements);
  if (!parts.length) {
    parts = staffElements.map((staff, index) => ({
      id: `part-${index + 1}`,
      name: `Part ${index + 1}`,
      staffIds: [staff.getAttribute("id") || String(index + 1)],
      clef: staffClef(staff),
    }));
  }

  const events = [];
  const tempoEvents = [];
  const measureMarkers = [];
  const lyrics = [];
  const activeTies = new Map();

  for (let staffIndex = 0; staffIndex < staffElements.length; staffIndex += 1) {
    const staff = staffElements[staffIndex];
    const staffId = staff.getAttribute("id") || String(staffIndex + 1);
    const part = partForStaff(parts, staffId, staffIndex);
    let measureStart = 0;
    let timeNumerator = 4;
    let timeDenominator = 4;
    const measures = directChildren(staff, "Measure");

    for (
      let measureIndex = 0;
      measureIndex < measures.length;
      measureIndex += 1
    ) {
      const measure = measures[measureIndex];
      const currentMeasureStart = measureStart;
      const timeSignature = measure.getElementsByTagName("TimeSig")[0];
      if (timeSignature) {
        timeNumerator = Number(childText(timeSignature, "sigN")) || timeNumerator;
        timeDenominator =
          Number(childText(timeSignature, "sigD")) || timeDenominator;
      }

      const explicitMeasureLength = fractionToTicks(
        measure.getAttribute("len") ?? "",
        division,
      );
      const measureTicks =
        explicitMeasureLength ??
        (timeNumerator * division * 4) / timeDenominator;
      let furthestCursor = measureStart;
      const voices = directChildren(measure, "voice");

      for (let voiceIndex = 0; voiceIndex < voices.length; voiceIndex += 1) {
        const voice = voices[voiceIndex];
        let cursor = measureStart;
        let tupletFactor = 1;

        for (const item of [...voice.childNodes].filter(
          (node) => node.nodeType === 1,
        )) {
          if (item.tagName === "tick") {
            const tick = Number(item.textContent);
            if (Number.isFinite(tick)) {
              cursor = tick;
            }
            continue;
          }

          if (item.tagName === "Tuplet") {
            const actual = Number(childText(item, "actualNotes")) || 1;
            const normal = Number(childText(item, "normalNotes")) || 1;
            tupletFactor = normal / actual;
            continue;
          }
          if (item.tagName === "endTuplet") {
            tupletFactor = 1;
            continue;
          }

          if (item.tagName === "Tempo") {
            const beatsPerSecond = Number(childText(item, "tempo"));
            if (beatsPerSecond > 0) {
              tempoEvents.push({
                tick: cursor,
                bpm: beatsPerSecond * 60,
              });
            }
            continue;
          }

          if (item.tagName === "location") {
            const fractionTicks = fractionToTicks(
              childText(item, "fractions"),
              division,
            );
            const measureOffset = Number(childText(item, "measures")) || 0;
            cursor +=
              (fractionTicks ?? 0) + measureOffset * measureTicks;
            continue;
          }

          if (item.tagName !== "Chord" && item.tagName !== "Rest") {
            continue;
          }

          const durationTicks =
            durationToTicks(item, division, measureTicks) * tupletFactor;

          if (item.tagName === "Chord") {
            for (const [lyricIndex, lyric] of directChildren(
              item,
              "Lyrics",
            ).entries()) {
              const text = childText(lyric, "text")
                .replace(/\s+/g, " ")
                .trim();
              if (!text) {
                continue;
              }
              lyrics.push({
                id: `lyric-${staffId}-${voiceIndex}-${measureIndex}-${lyrics.length}`,
                startTick: cursor,
                durationTicks,
                partId: part.id,
                measureIndex,
                measureNumber:
                  measure.getAttribute("no") || measureIndex + 1,
                verse:
                  Number(childText(lyric, "no")) ||
                  Number(lyric.getAttribute("no")) ||
                  lyricIndex,
                syllabic: childText(lyric, "syllabic") || "single",
                text,
              });
            }

            for (const note of directChildren(item, "Note")) {
              const midi = Number(childText(note, "pitch"));
              if (!Number.isFinite(midi)) {
                continue;
              }
              const tpcText = childText(note, "tpc");
              const parsedTpc = tpcText === "" ? null : Number(tpcText);
              const tpc = Number.isFinite(parsedTpc) ? parsedTpc : null;

              const tieKey = `${staffId}:${voiceIndex}:${midi}`;
              const tiedEvent = activeTies.get(tieKey);
              const tiedFromPrevious = hasTiePrevious(note);
              const tiedToNext = hasTieStart(note);

              if (tiedFromPrevious && tiedEvent) {
                tiedEvent.durationTicks =
                  cursor + durationTicks - tiedEvent.startTick;
                if (!tiedToNext) {
                  activeTies.delete(tieKey);
                }
              } else {
                const event = {
                  startTick: cursor,
                  durationTicks,
                  midi,
                  velocity: Math.max(
                    0.2,
                    Math.min(1, (Number(childText(note, "velocity")) || 80) / 100),
                  ),
                  partId: part.id,
                  tpc,
                };
                events.push(event);
                if (tiedToNext) {
                  activeTies.set(tieKey, event);
                }
              }

              if (events.length > MAX_NOTES) {
                throw new Error("TOO_MANY_NOTES");
              }
            }
          }

          cursor += durationTicks;
          furthestCursor = Math.max(furthestCursor, cursor);
        }
      }

      measureStart = Math.max(measureStart + measureTicks, furthestCursor);
      if (staffIndex === 0) {
        measureMarkers.push({
          number: measure.getAttribute("no") || measureIndex + 1,
          startTick: currentMeasureStart,
          endTick: measureStart,
        });
      }
    }
  }

  const tempoMap = buildTempoMap(tempoEvents, division);
  for (const event of events) {
    event.startSeconds = tickToSeconds(event.startTick, tempoMap, division);
    const endSeconds = tickToSeconds(
      event.startTick + event.durationTicks,
      tempoMap,
      division,
    );
    event.durationSeconds = Math.max(0.035, endSeconds - event.startSeconds);
  }
  const percussionPartIds = new Set(
    parts
      .filter((part) => part.isPercussion)
      .map((part) => part.id),
  );
  const playableEvents = events
    .filter((event) => !percussionPartIds.has(event.partId))
    .sort((left, right) => left.startSeconds - right.startSeconds);
  if (!playableEvents.length) {
    throw new Error("NO_PLAYABLE_NOTES");
  }
  const measures = measureMarkers.map((measure) => ({
    ...measure,
    startSeconds: tickToSeconds(measure.startTick, tempoMap, division),
    endSeconds: tickToSeconds(measure.endTick, tempoMap, division),
  }));
  for (const lyric of lyrics) {
    lyric.startSeconds = tickToSeconds(
      lyric.startTick,
      tempoMap,
      division,
    );
    lyric.endSeconds = tickToSeconds(
      lyric.startTick + lyric.durationTicks,
      tempoMap,
      division,
    );
  }
  const playableLyrics = lyrics
    .filter((lyric) => !percussionPartIds.has(lyric.partId))
    .sort((left, right) => left.startSeconds - right.startSeconds);

  const duration = Math.max(
    ...playableEvents.map(
      (event) => event.startSeconds + event.durationSeconds,
    ),
  );
  if (duration > MAX_DURATION_SECONDS) {
    throw new Error("SCORE_TOO_LONG");
  }

  parts = parts
    .filter((part) => !part.isPercussion)
    .map((part) => ({
      ...part,
      noteCount: playableEvents.filter(
        (event) => event.partId === part.id,
      ).length,
    }))
    .filter((part) => part.noteCount > 0);

  return {
    title: scoreTitle(scoreElement, fallbackName),
    sourceName: fallbackName,
    division,
    parts,
    events: playableEvents,
    measures,
    lyrics: playableLyrics,
    duration,
  };
}

export async function readMuseScoreFile(input, fileName = "score.mscz") {
  const bytes =
    input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.byteLength > MAX_FILE_SIZE) {
    throw new Error("FILE_TOO_LARGE");
  }

  let xml;
  if (/\.mscx$/i.test(fileName)) {
    xml = new TextDecoder().decode(bytes);
  } else if (/\.mscz$/i.test(fileName)) {
    xml = await extractMuseScoreXml(bytes);
  } else {
    throw new Error("UNSUPPORTED_SCORE_FORMAT");
  }

  return parseMuseScoreXml(xml, fileName);
}
