const PUBLIC_TITLES = new Map([
  ["a-sky-full-of-stars", "A Sky Full of Stars"],
  ["and-july", "And July"],
  ["atlantis-princess", "Atlantis Princess"],
  ["candy", "Candy"],
  ["danny-boy", "Danny Boy"],
  ["disney-medley", "Disney Medley"],
  ["dream", "Dream"],
  ["dumdi-dumdi", "DUMDi DUMDi"],
  ["heal-the-world", "Heal The World"],
  ["java-jive", "Java Jive"],
  ["love-yourself", "Love Yourself"],
  ["payphone", "Payphone"],
  ["spring-day", "Spring Day"],
  ["the-girl-from-ipanema", "The Girl From Ipanema"],
  ["traffic-light", "Traffic Light"],
]);

const KOREAN_SEARCH_TERMS = new Map([
  ["and-july", ["앤드 줄라이", "그리고 7월"]],
  ["atlantis-princess", ["아틀란티스 소녀"]],
  ["candy", ["캔디"]],
  ["disney-medley", ["디즈니 메들리"]],
  ["dream", ["드림"]],
  ["dumdi-dumdi", ["덤디덤디"]],
  ["spring-day", ["봄날"]],
  ["traffic-light", ["신호등"]],
]);

function scoreSlug(fileName) {
  return String(fileName ?? "")
    .split(/[\\/]/)
    .pop()
    .replace(/\.(mscz|mscx)$/i, "")
    .toLowerCase();
}

function normalizeSearchText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

export function scoreDisplayTitle(fileName, metadataTitle = "Untitled") {
  const stem = scoreSlug(fileName);
  return PUBLIC_TITLES.get(stem) ?? metadataTitle;
}

export function scoreMatchesSearch(score, query) {
  const search = normalizeSearchText(query);
  if (!search) return true;
  const slug = scoreSlug(score.fileName);
  return [score.name, slug, ...(KOREAN_SEARCH_TERMS.get(slug) ?? [])]
    .some((term) => normalizeSearchText(term).includes(search));
}
