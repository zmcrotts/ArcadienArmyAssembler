"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildFactionNavigation } = require("../src/domain/factions");

test("builder navigation groups factions and folds chapter variants into Space Marines", () => {
  const navigation = buildFactionNavigation([
    "Imperium - Adeptus Astartes - Space Marines",
    "Imperium - Adeptus Astartes - Blood Angels",
    "Imperium - Adepta Sororitas",
    "Chaos - World Eaters",
    "Chaos - Titanicus Traitoris",
    "Xenos - Aeldari",
    "Aeldari - Ynnari",
    "Library - Titans",
    "Imperium - Adeptus Titanicus",
    "Unaligned Forces"
  ]);
  assert.deepEqual(navigation.map(group => group.allegiance), ["Imperium", "Chaos", "Xenos"]);
  const marines = navigation[0].factions.find(item => item.label === "Space Marines");
  assert.deepEqual(marines.modes.map(item => item.label), ["Generic", "Blood Angels"]);
  const aeldari = navigation[2].factions.find(item => item.label === "Aeldari");
  assert.deepEqual(aeldari.modes.map(item => item.label), ["Craftworlds", "Ynnari"]);
  assert.equal(JSON.stringify(navigation).includes("Library - Titans"), false);
  assert.equal(JSON.stringify(navigation).includes("Unaligned Forces"), false);
  assert.equal(JSON.stringify(navigation).includes("Titanicus"), false);
});
