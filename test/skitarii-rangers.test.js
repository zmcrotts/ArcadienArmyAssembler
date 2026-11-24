"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { extractNormalizedRuleset } = require("../src/rulesets/sources");
const { buildTreeIndex } = require("../src/domain/loadout");

test("Skitarii Rangers and Vanguard allow every special weapon, one equipment bearer, and exactly ten models", () => {
  const units = extractNormalizedRuleset().units.filter(unit => ["Skitarii Rangers", "Skitarii Vanguard"].includes(unit.name));
  for (const name of ["Skitarii Rangers", "Skitarii Vanguard"]) {
    assert.ok(units.some(unit => unit.faction === "Imperium - Adeptus Mechanicus" && unit.name === name));
  }
  global.window = {};
  require("../ui/engine-runtime");
  for (const engine of [require("../src/domain/loadout"), window.RosterEngine]) {
    const { createDefaultRosterEntry, getConfiguredModels, getConfiguredProfiles, getOptionStates,
      getUnitSizeState, normalizeRosterEntry, setSelection, setUnitSize, validateLoadout } = engine;
    for (const unit of units) {
      const index = buildTreeIndex(unit);
      const bearerName = unit.name === "Skitarii Vanguard" ? "Skitarii Vanguard" : "Skitarii Ranger";
      const model = suffix => index.all.find(node => node.kind === "model" && node.name === bearerName + " w/ " + suffix);
      const weapons = ["arc rifle", "plasma caliver", "transuranic arquebus"].map(model);
      const equipment = [model("data-tether"), model("omnispex")];
      const size = entry => getConfiguredModels(unit, entry).reduce((sum, item) => sum + item.count, 0);
      for (let mask = 0; mask < 8; mask++) {
        for (const bearer of [null, ...equipment]) {
          let entry = createDefaultRosterEntry(unit);
          for (let i = 0; i < weapons.length; i++) {
            if (mask & (1 << i)) entry = setSelection(unit, entry, weapons[i].id, 1);
          }
          if (bearer) entry = setSelection(unit, entry, bearer.id, 1);
          assert.equal(size(entry), 10, unit.faction);
          assert.deepEqual(validateLoadout(unit, entry), []);
          assert.deepEqual(Object.fromEntries(weapons.map(node => [node.name, entry.selections[node.id] || 0])),
            Object.fromEntries(weapons.map((node, i) => [node.name, mask & (1 << i) ? 1 : 0])));
          const sizeState = getUnitSizeState(unit, entry);
          assert.equal(sizeState.minimum, 10);
          assert.equal(sizeState.maximum, 10);
          assert.equal(sizeState.editable, false);
          assert.equal(size(setUnitSize(unit, entry, 11)), 10);
          for (const weapon of weapons) {
            assert.equal(getOptionStates(unit, entry).find(state => state.id === weapon.id).maximum, 1);
          }
          if (bearer) {
            const other = equipment.find(node => node !== bearer);
            const switched = setSelection(unit, entry, other.id, 1);
            assert.equal(switched.selections[bearer.id] || 0, 0);
            assert.equal(switched.selections[other.id], 1);
            assert.equal(size(switched), 10);
            assert.deepEqual(validateLoadout(unit, switched), []);
          }
        }
      }
      let entry = createDefaultRosterEntry(unit);
      for (const weapon of weapons) entry = setSelection(unit, entry, weapon.id, 1);
      const profiles = getConfiguredProfiles(unit, entry);
      for (const name of ["Arc rifle", "Plasma caliver", "Transuranic arquebus"]) {
        assert.ok(profiles.weapons.some(profile => profile.name.includes(name)), name);
      }
      // Repair an old eleven-model saved entry with a specialist added on top.
      const old = createDefaultRosterEntry(unit);
      old.selections[weapons[0].id] = 1;
      const repaired = normalizeRosterEntry(unit, old);
      assert.equal(size(repaired), 10);
      assert.equal(repaired.selections[weapons[0].id], 1);
      assert.deepEqual(validateLoadout(unit, repaired), []);
    }
  }
});
