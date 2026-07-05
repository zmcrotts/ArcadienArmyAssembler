"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { extractUnitDefinitions } = require("../src/bsdata/unit-definitions");
const { extractAllyDefinitions } = require("../src/bsdata/ally-definitions");
const { createArmyState, validateRosterLegality } = require("../src/domain/army");

const BSDATA = path.join(__dirname, "..", "data", "wh40K", "wh40k-10e-main", "wh40k-10e-main");

test("Space Marines inherit structured Imperial ally catalogues from BSData", () => {
  const units = extractUnitDefinitions(BSDATA).definitions;
  const allies = extractAllyDefinitions(BSDATA, units)["Imperium - Adeptus Astartes - Space Marines"];
  assert.ok(allies.some(item => item.type === "agents" && item.selectionKeys.length > 10));
  assert.ok(allies.some(item => item.type === "imperialKnights" && item.selectionKeys.length > 10));
  assert.ok(allies.some(item => item.type === "titans"));
  assert.ok(allies.some(item => item.type === "unaligned"));
});

test("ally restrictions are structured warnings and never remove selections", () => {
  const army = { id: "army", detachments: [{ id: "detachment" }], enhancements: [], allowedSelectionKeys: ["knight"] };
  const roster = Array.from({ length: 4 }, (_, index) => ({
    instanceId: `knight-${index}`,
    selectionKey: "knight",
    name: "Armiger Warglaive",
    points: 140,
    categories: ["Armiger"],
    roles: {},
    rosterRules: { maxCopies: 6 },
    alliedFor: { type: "imperialKnights", label: "Imperial Knights" }
  }));
  const state = { ...createArmyState(army), detachmentId: "detachment" };
  const result = validateRosterLegality(army, state, roster, { pointsLimit: 2000, totalPoints: 560 });
  assert.ok(result.warnings.some(item => item.code === "KNIGHT_ALLY_LIMIT_EXCEEDED"));
  assert.equal(roster.length, 4);
});
