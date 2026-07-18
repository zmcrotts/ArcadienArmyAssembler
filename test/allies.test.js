"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("path");
const { extractUnitDefinitions } = require("../src/bsdata/unit-definitions");
const { extractAllyDefinitions } = require("../src/bsdata/ally-definitions");
const { extractNormalizedRuleset } = require("../src/rulesets/sources");
const { canAddUnitForSelectedDetachment, createArmyState, selectDetachment, validateRosterLegality } = require("../src/domain/army");

const BSDATA = path.join(__dirname, "..", "data", "wh40K", "wh40k-10e-main", "wh40k-10e-main");
const legacyTest = fs.existsSync(BSDATA) ? test : test.skip;

legacyTest("Space Marines inherit structured Imperial ally catalogues from BSData", () => {
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

  const daemonDetachment = army.detachments.find(item => item.name === "Changehost of Deceit");
  const otherDetachment = army.detachments.find(item => item.name !== "Changehost of Deceit");
  assert.ok(daemonDetachment, "Missing Changehost of Deceit detachment");
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
  assert.equal(canAddUnitForSelectedDetachment(army, otherState, nativeHorrors[0].definition), false);
  assert.equal(canAddUnitForSelectedDetachment(army, otherState, daemonRoster[2]), false);
  const otherResult = validateRosterLegality(army, otherState, daemonRoster);
  const gatedWarnings = otherResult.warnings.filter(item => item.code === "DAEMON_DETACHMENT_REQUIRED");
  assert.equal(gatedWarnings.length, 2);
  assert.deepEqual(
    gatedWarnings.flatMap(item => item.affectedInstanceIds).sort(),
    daemonRoster.map(item => item.instanceId).sort()
  );

  const daemonState = selectDetachment(army, createArmyState(army), daemonDetachment.id);
  assert.equal(canAddUnitForSelectedDetachment(army, daemonState, nativeHorrors[0].definition), true);
  assert.equal(canAddUnitForSelectedDetachment(army, daemonState, daemonRoster[2]), true);
  const daemonResult = validateRosterLegality(army, daemonState, daemonRoster);
  assert.equal(daemonResult.warnings.some(item => item.code === "DAEMON_DETACHMENT_REQUIRED"), false);
});

test("all god-specific Chaos factions hide daemon allies outside their required detachment", () => {
  const ruleset = extractNormalizedRuleset();
  const gates = {
    "Chaos - Thousand Sons": { detachment: "Changehost of Deceit", god: "Tzeentch" },
    "Chaos - Death Guard": { detachment: "Tallyband Summoners", god: "Nurgle" },
    "Chaos - World Eaters": { detachment: "Khorne Daemonkin", god: "Khorne" },
    "Chaos - Emperor's Children": { detachment: "Carnival of Excess", god: "Slaanesh" }
  };

  for (const [faction, gate] of Object.entries(gates)) {
    const army = ruleset.armies.find(item => item.faction === faction);
    assert.ok(army, `Missing army fixture for ${faction}`);
    const allowed = army.detachments.find(item => item.name === gate.detachment);
    assert.ok(allowed, `Missing ${gate.detachment} for ${faction}`);
    const blocked = army.detachments.find(item => item.id !== allowed.id);
    assert.ok(blocked, `Missing blocked detachment fixture for ${faction}`);
    const daemon = { faction: "Chaos - Daemons Library", categories: ["Daemon", gate.god], alliedFor: { type: "chaosDaemons", label: "Chaos Daemons" } };
    const wrongGod = gate.god === "Khorne" ? "Tzeentch" : "Khorne";
    const mismatchedDaemon = { ...daemon, categories: ["Daemon", wrongGod] };
    assert.equal(canAddUnitForSelectedDetachment(army, selectDetachment(army, createArmyState(army), blocked.id), daemon), false, faction);
    assert.equal(canAddUnitForSelectedDetachment(army, selectDetachment(army, createArmyState(army), allowed.id), daemon), true, faction);
    assert.equal(canAddUnitForSelectedDetachment(army, selectDetachment(army, createArmyState(army), allowed.id), mismatchedDaemon), false, faction);
  }
});

test("embedded daemon epic heroes without Summoned are still detachment-gated", () => {
  const ruleset = extractNormalizedRuleset();
  const fixtures = [
    { faction: "Chaos - World Eaters", detachment: "Khorne Daemonkin", unit: "Skarbrand", daemonFaction: "Faction: Blood Legions" },
    { faction: "Chaos - Emperor's Children", detachment: "Carnival of Excess", unit: "Shalaxi Helbane", daemonFaction: "Faction: Legions of Excess" }
  ];

  for (const fixture of fixtures) {
    const army = ruleset.armies.find(item => item.faction === fixture.faction);
    const unit = ruleset.units.find(item => item.faction === fixture.faction && item.name === fixture.unit);
    const allowed = army?.detachments.find(item => item.name === fixture.detachment);
    const blocked = army?.detachments.find(item => item.id !== allowed?.id);
    assert.ok(army && unit && allowed && blocked, `Missing embedded daemon fixture for ${fixture.faction}`);
    assert.ok(unit.categories.includes(fixture.daemonFaction));
    assert.equal(unit.categories.includes("Summoned"), false);
    assert.equal(canAddUnitForSelectedDetachment(army, selectDetachment(army, createArmyState(army), blocked.id), unit), false);
    assert.equal(canAddUnitForSelectedDetachment(army, selectDetachment(army, createArmyState(army), allowed.id), unit), true);
  }
});
