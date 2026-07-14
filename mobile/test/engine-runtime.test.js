"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

global.window = {};
require("../ui/engine-runtime.js");

test("configured profiles retain Transport and other non-weapon datasheet profiles", () => {
  const unit = {
    id: "transport-unit",
    selectionKey: "transport-unit",
    composition: [],
    selectionTree: {
      id: "transport-unit",
      kind: "unit",
      children: [],
      profiles: [
        { id: "unit-profile", typeName: "Unit", name: "Test Transport", characteristics: { M: '10"' } },
        { id: "weapon-profile", typeName: "Ranged Weapons", name: "Test gun", characteristics: { A: "1" } },
        { id: "ability-profile", typeName: "Abilities", name: "Smoke", characteristics: { Description: "Smoke ability." } },
        { id: "transport-profile", typeName: "Transport", name: "Test Transport", characteristics: { Capacity: "This model has a transport capacity of 12 INFANTRY models." } }
      ]
    }
  };
  const entry = window.RosterEngine.createDefaultRosterEntry(unit);
  const configured = window.RosterEngine.getConfiguredProfiles(unit, entry);

  assert.deepEqual(configured.abilities.map(profile => profile.typeName), ["Abilities", "Transport"]);
  assert.match(configured.abilities[1].characteristics.Capacity, /transport capacity of 12/i);
});
