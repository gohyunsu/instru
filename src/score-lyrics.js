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
