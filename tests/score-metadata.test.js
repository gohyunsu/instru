import test from "node:test";
import assert from "node:assert/strict";

import { titleFromMuseScoreXml } from "../src/score-metadata.js";

test("reads the stored MuseScore work title", () => {
  const xml =
    '<Score><metaTag name="workTitle">Heal &amp; Sing</metaTag></Score>';
  assert.equal(titleFromMuseScoreXml(xml, "file.mscz"), "Heal & Sing");
});

test("uses a visible title when metadata is generic", () => {
  const xml = `
    <Score>
      <metaTag name="workTitle">이름 없는 악보</metaTag>
      <Text><style>title</style><text>And July</text></Text>
    </Score>
  `;
  assert.equal(titleFromMuseScoreXml(xml, "file.mscz"), "And July");
});

test("falls back to the file name when no title is stored", () => {
  assert.equal(titleFromMuseScoreXml("<Score />", "candy.mscz"), "candy");
});
