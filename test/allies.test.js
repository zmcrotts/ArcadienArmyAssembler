"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { extractUnitDefinitions } = require("../src/bsdata/unit-definitions");
const { extractAllyDefinitions } = require("../src/bsdata/ally-definitions");
const { extractNormalizedRuleset } = require("../src/rulesets/sources");
const { createArmyState, selectDetachment, validateRosterLegality } = require("../src/domain/army");

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

test("god-specific chaos summoned daemons require the daemon detachment", () => {
  const ruleset = extractNormalizedRuleset();
  const army = ruleset.armies.find(item => item.faction === "Chaos - Thousand Sons");
  assert.ok(army, "Missing Thousand Sons army definition");

  const servantDetachment = army.detachments.find(item => item.name === "Servants of Change");
  const otherDetachment = army.detachments.find(item => item.name !== "Servants of Change");
  assert.ok(servantDetachment, "Missing Servants of Change detachment");
  assert.ok(otherDetachment, "Missing non-daemon Thousand Sons detachment");

  const nativeHorrors = ["Blue Horrors", "Pink Horrors"].map(name => {
    const definition = ruleset.units.find(item => item.faction === "Chaos - Thousand Sons" && item.name === name);
    assert.ok(definition, `Missing native Thousand Sons ${name}`);
    return {
      instanceId: `${name.toLowerCase().replace(/\s+/g, "-")}-1`,
      definition,
      points: definition.pricing.base
    };
  });
  const alliedBlueHorrors = ruleset.units.find(item => item.faction === "Chaos - Daemons Library" && item.name === "Blue Horrors");
  assert.ok(alliedBlueHorrors, "Missing Daemons Library Blue Horrors");
  const daemonRoster = [
    ...nativeHorrors,
    {
      instanceId: "daemon-library-blue-horrors-1",
      definition: alliedBlueHorrors,
      points: alliedBlueHorrors.pricing.base,
      alliedFor: { type: "chaosDaemons", label: "Chaos Daemons" }
    }
  ];

  const otherState = selectDetachment(army, createArmyState(army), otherDetachment.id);
  const otherResult = validateRosterLegality(army, otherState, daemonRoster);
  const gatedWarnings = otherResult.warnings.filter(item => item.code === "DAEMON_DETACHMENT_REQUIRED");
  assert.equal(gatedWarnings.length, 2);
  assert.deepEqual(
    gatedWarnings.flatMap(item => item.affectedInstanceIds).sort(),
    daemonRoster.map(item => item.instanceId).sort()
  );

  const servantState = selectDetachment(army, createArmyState(army), servantDetachment.id);
  const servantResult = validateRosterLegality(army, servantState, daemonRoster);
  assert.equal(servantResult.warnings.some(item => item.code === "DAEMON_DETACHMENT_REQUIRED"), false);
});
