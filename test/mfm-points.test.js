"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { createDefaultRosterEntry, setUnitSize } = require("../src/domain/loadout");
const { calculateEntryPoints } = require("../src/domain/pricing");
const { extractNormalizedRuleset } = require("../src/rulesets/sources");

const ruleset = extractNormalizedRuleset(undefined, { fresh: true });

function unit(faction, name) {
  const result = ruleset.units.find(item => item.faction === faction && item.name === name);
  assert.ok(result, `Missing ${faction} / ${name}`);
  return result;
}

function points(definition, size, context = {}, options = {}) {
  let entry = createDefaultRosterEntry(definition);
  if (size !== null) entry = setUnitSize(definition, entry, size);
  entry.context = { ...(entry.context || {}), ...context };
  return calculateEntryPoints(definition, entry, options).points;
}

test("MFM v1.1 preserves separate model-count and copy-count bands", () => {
  const faction = "Imperium - Adepta Sororitas";
  const repentia = unit(faction, "Repentia Squad");
  assert.equal(points(repentia, 5), 70);
  assert.equal(points(repentia, 10), 140);

  const hospitaller = unit(faction, "Hospitaller");
  assert.equal(points(hospitaller, 1, { previousCopies: 0 }), 65);
  assert.equal(points(hospitaller, 1, { previousCopies: 1 }), 75);

  const immolator = unit(faction, "Immolator");
  assert.equal(points(immolator, 1, { previousCopies: 2 }), 100);
  assert.equal(points(immolator, 1, { previousCopies: 3 }), 115);
});

test("MFM v1.1 includes red increases", () => {
  const morvenn = unit("Imperium - Adepta Sororitas", "Morvenn Vahl");
  assert.equal(points(morvenn, 1), 200);
});

test("MFM v1.1 keeps Chapter-specific Space Marine schedules distinct", () => {
  const bloodAngelsJumpIntercessors = unit(
    "Imperium - Adeptus Astartes - Blood Angels",
    "Assault Intercessors with Jump Packs"
  );
  assert.equal(points(bloodAngelsJumpIntercessors, 5, { previousCopies: 0 }), 95);
  assert.equal(points(bloodAngelsJumpIntercessors, 10, { previousCopies: 0 }, { allowInvalid: true }), 180);
  assert.equal(points(bloodAngelsJumpIntercessors, 5, { previousCopies: 2 }), 105);
  assert.equal(points(bloodAngelsJumpIntercessors, 10, { previousCopies: 2 }, { allowInvalid: true }), 190);

  const bloodAngelsBladeguard = unit(
    "Imperium - Adeptus Astartes - Blood Angels",
    "Bladeguard Veteran Squad"
  );
  assert.equal(points(bloodAngelsBladeguard, 3, { previousCopies: 0 }), 85);
  assert.equal(points(bloodAngelsBladeguard, 6, { previousCopies: 0 }), 170);
  assert.equal(points(bloodAngelsBladeguard, 3, { previousCopies: 2 }), 95);
  assert.equal(points(bloodAngelsBladeguard, 6, { previousCopies: 2 }), 180);

  const genericJumpIntercessors = unit(
    "Imperium - Adeptus Astartes - Space Marines",
    "Assault Intercessors with Jump Packs"
  );
  assert.equal(points(genericJumpIntercessors, 5, { previousCopies: 0 }), 85);
  assert.equal(points(genericJumpIntercessors, 10, { previousCopies: 0 }, { allowInvalid: true }), 160);

  const bloodAngelsOutriders = unit(
    "Imperium - Adeptus Astartes - Blood Angels",
    "Outrider Squad"
  );
  const outriderNodes = [];
  (function visit(node) {
    if (!node) return;
    outriderNodes.push(node);
    for (const child of node.children || []) visit(child);
  })(bloodAngelsOutriders.selectionTree);
  assert.equal(outriderNodes.find(node => node.name === "Invader ATV")?.points, 60);
});

test("Imperial Agents conditional schedules remain distinct", () => {
  const eversor = unit("Imperium - Agents of the Imperium", "Eversor Assassin");
  assert.equal(points(eversor, 1, { mfmContext: "Imperial Agents army" }), 100);
  assert.equal(points(eversor, 1, { mfmContext: "Every model has the Imperium keyword" }), 110);
});

test("MFM v1.1 applies enhancement and wargear totals", () => {
  const sisters = ruleset.armies.find(item => item.faction === "Imperium - Adepta Sororitas");
  const expected = new Map([
    ["Catechism of Divine Penitence", 15],
    ["Psalm of Righteous Judgement", 20],
    ["Refrain of Enduring Faith", 15]
  ]);
  for (const [name, value] of expected) {
    assert.equal(sisters.enhancements.find(item => item.name === name)?.points, value);
  }

  const venatari = unit("Imperium - Adeptus Custodes", "Venatari Custodians");
  const nodes = [];
  (function visit(node) {
    if (!node) return;
    nodes.push(node);
    for (const child of node.children || []) visit(child);
  })(venatari.selectionTree);
  assert.equal(nodes.find(node => node.name === "Venatari lance")?.points, 5);
});

test("Faction Pack v1.1 adds the two flagged detachments", () => {
  const marines = ruleset.armies.find(item => item.faction === "Imperium - Adeptus Astartes - Space Marines");
  const vengeful = marines.detachments.find(item => item.name === "Vengeful Hosts");
  assert.deepEqual(
    { points: vengeful.detachmentPoints, disposition: vengeful.forceDisposition.name, rules: vengeful.rules.length, stratagems: vengeful.stratagems.length },
    { points: 1, disposition: "Take and Hold", rules: 1, stratagems: 3 }
  );
  assert.equal(marines.enhancements.find(item => item.name === "Avenging Angel")?.points, 20);
  assert.equal(marines.enhancements.find(item => item.name === "Orksbane")?.points, 20);

  const orks = ruleset.armies.find(item => item.faction === "Xenos - Orks");
  const equatorial = orks.detachments.find(item => item.name === "Equatorial Hordes");
  assert.deepEqual(
    { points: equatorial.detachmentPoints, disposition: equatorial.forceDisposition.name, rules: equatorial.rules.length, stratagems: equatorial.stratagems.length },
    { points: 1, disposition: "Disruption", rules: 1, stratagems: 3 }
  );
  assert.equal(orks.enhancements.find(item => item.name === "Kunnin’ Hunta")?.points, 25);
  assert.equal(orks.enhancements.find(item => item.name === "Unkillable Scourge")?.points, 25);
});

test("every MFM v1.1 row attaches to normalized roster data", () => {
  assert.equal(ruleset.mfmPointSource.total, 1527);
  assert.equal(ruleset.mfmPointSource.unmatched, 0);
});
