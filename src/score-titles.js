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

export function scoreDisplayTitle(fileName, metadataTitle = "Untitled") {
  const stem = String(fileName ?? "")
    .split(/[\\/]/)
    .pop()
    .replace(/\.(mscz|mscx)$/i, "")
    .toLowerCase();
  return PUBLIC_TITLES.get(stem) ?? metadataTitle;
}
