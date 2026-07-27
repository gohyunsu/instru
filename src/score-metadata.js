const GENERIC_TITLES = new Set([
  "이름 없는 악보",
  "untitled score",
  "untitled",
]);

function decodeXmlEntities(value) {
  const entities = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    quot: '"',
  };
  return String(value).replace(
    /&(#x[\da-f]+|#\d+|amp|apos|gt|lt|quot);/gi,
    (match, entity) => {
      if (entity[0] === "#") {
        const hexadecimal = entity[1]?.toLowerCase() === "x";
        const codePoint = Number.parseInt(
          entity.slice(hexadecimal ? 2 : 1),
          hexadecimal ? 16 : 10,
        );
        return Number.isFinite(codePoint)
          ? String.fromCodePoint(codePoint)
          : match;
      }
      return entities[entity.toLowerCase()] ?? match;
    },
  );
}

function plainText(value) {
  return decodeXmlEntities(
    String(value ?? "")
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

function metaTitle(xml, name) {
  const expression = new RegExp(
    `<metaTag\\b(?=[^>]*\\bname=["']${name}["'])[^>]*>([\\s\\S]*?)<\\/metaTag>`,
    "i",
  );
  return plainText(xml.match(expression)?.[1] ?? "");
}

export function titleFromMuseScoreXml(xml, fallbackName = "제목 없음") {
  for (const name of ["workTitle", "movementTitle"]) {
    const value = metaTitle(xml, name);
    if (value && !GENERIC_TITLES.has(value.toLowerCase())) {
      return value;
    }
  }

  for (const match of String(xml).matchAll(/<Text\b[^>]*>([\s\S]*?)<\/Text>/g)) {
    const block = match[1];
    if (!/<style>\s*title\s*<\/style>/i.test(block)) {
      continue;
    }
    const text = plainText(block.match(/<text\b[^>]*>([\s\S]*?)<\/text>/i)?.[1]);
    if (text) {
      return text;
    }
  }

  return String(fallbackName).replace(/\.(mscz|mscx)$/i, "") || "제목 없음";
}
