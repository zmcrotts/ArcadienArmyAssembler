"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("path");
const { extractUnitDefinitions } = require("../src/bsdata/unit-definitions");
const { calculateEntryPoints } = require("../src/domain/pricing");
const { createDefaultRosterEntry } = require("../src/domain/loadout");

const BSDATA = path.join(__dirname, "..", "data", "wh40K", "wh40k-10e-main", "wh40k-10e-main");
const hasLegacyBsdata = fs.existsSync(BSDATA);
const legacyTest = hasLegacyBsdata ? test : test.skip;
const extracted = hasLegacyBsdata ? extractUnitDefinitions(BSDATA) : { definitions: [] };

function unit(faction, name) {
  const found = extracted.definitions.find(item => item.faction === faction && item.name === name);
  assert.ok(found, `Missing fixture unit: ${faction} / ${name}`);
  return found;
}

function entryFor(definition, counts = {}) {
  return {
    schemaVersion: 1,
    instanceId: "test-entry",
    unitId: definition.id,
    selections: Object.fromEntries(
      definition.composition.map(item => [item.id, counts[item.id] ?? item.defaultCount ?? 0])
    )
  };
}

legacyTest("Arco-Flagellants use BSData base price at three models", () => {
  const definition = unit("Imperium - Adepta Sororitas", "Arco-Flagellants");
  const model = definition.composition.find(item => item.name === "Arco-Flagellant");
  const result = calculateEntryPoints(definition, entryFor(definition, { [model.id]: 3 }));
  assert.equal(result.points, 45);
});

legacyTest("Arco-Flagellants apply the BSData conditional price above three models", () => {
  const definition = unit("Imperium - Adepta Sororitas", "Arco-Flagellants");
  const model = definition.composition.find(item => item.name === "Arco-Flagellant");
  const result = calculateEntryPoints(definition, entryFor(definition, { [model.id]: 10 }));
  assert.equal(result.points, 140);
  assert.equal(result.applied.at(-1).operation, "set");
});

legacyTest("composition limits reject illegal model counts", () => {
  const definition = unit("Imperium - Adepta Sororitas", "Arco-Flagellants");
  const model = definition.composition.find(item => item.name === "Arco-Flagellant");
  assert.throws(
    () => calculateEntryPoints(definition, entryFor(definition, { [model.id]: 2 })),
    error => error.code === "INVALID_ROSTER_ENTRY"
  );
});

legacyTest("per-model BSData costs are included for units without a unit-level base", () => {
  const definition = unit("Imperium - Adeptus Mechanicus", "Ironstrider Ballistarii");
  const model = definition.composition[0];
  const result = calculateEntryPoints(definition, entryFor(definition, { [model.id]: 1 }));
  assert.equal(result.points, 85);
});

legacyTest("aggregate model-count modifiers support mixed model selections", () => {
  const definition = unit("Xenos - Aeldari", "Windriders");
  const counts = Object.fromEntries(definition.composition.map((item, index) => [item.id, index === 0 ? 6 : 0]));
  const result = calculateEntryPoints(definition, entryFor(definition, counts));
  assert.equal(result.points, 160);
});

test("point modifiers can multiply a base value", () => {
  const definition = {
    schemaVersion: 1,
    id: "multiply-fixture",
    source: {},
    composition: [],
    compositionConstraints: [],
    pricing: {
      base: 50,
      baseSource: "fixture",
      modifiers: [{
        operation: "multiply",
        value: 2,
        supported: true,
        source: "fixture",
        when: { kind: "all", conditions: [] }
      }]
    }
  };
  const result = calculateEntryPoints(definition, {
    schemaVersion: 1,
    instanceId: "multiply-entry",
    unitId: "multiply-fixture",
    selections: {}
  });

  assert.equal(result.points, 100);
  assert.equal(result.applied.at(-1).operation, "multiply");
});

legacyTest("generated entries bridge occurrence IDs into composition validation", () => {
  for (const definition of [
    unit("Xenos - Tyranids", "Barbgaunts"),
    unit("Xenos - Tyranids", "Barbed Hierodule [Legends]")
  ]) {
    const result = calculateEntryPoints(definition, createDefaultRosterEntry(definition), { allowInvalid: true });
    assert.deepEqual(result.validationErrors, []);
    if (definition.name === "Barbed Hierodule [Legends]") assert.equal(result.points, 340);
  }
});
