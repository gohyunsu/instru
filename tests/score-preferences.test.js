import test from "node:test";
import assert from "node:assert/strict";

import { preferredNotationPart } from "../src/score-preferences.js";

const parts = [
  { id: "s", name: "Soprano 2" },
  { id: "t", name: "Tenor" },
  { id: "b", name: "Baritone " },
];

test("Disney Medley and A Sky Full of Stars open on Baritone", () => {
  for (const sourceName of [
    "disney-medley.mscz",
    "A Sky Full of Stars.mscz",
  ]) {
    assert.equal(preferredNotationPart({ sourceName, parts })?.id, "b");
  }
});

test("other scores keep Tenor as their default notation part", () => {
  assert.equal(
    preferredNotationPart({ sourceName: "danny-boy.mscz", parts })?.id,
    "t",
  );
});
