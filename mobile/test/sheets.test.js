"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildRosterSheets } = require("../src/domain/sheets");

test("mobile sheets preserve Transport capacity as a dedicated profile type", () => {
  const sheets = buildRosterSheets({
    rosterEntries: [{
      instanceId: "transport-1",
      name: "Tyrannocyte",
      configured: {
        units: [],
        weapons: [],
        abilities: [{
          typeName: "Transport",
          name: "Tyrannocyte",
          characteristics: { Capacity: "This model has a transport capacity of 20 TYRANIDS INFANTRY models." }
        }],
        rules: []
      }
    }]
  });
  const transport = sheets.combinedUnitSheets[0].abilities[0];

  assert.equal(transport.profileType, "Transport");
  assert.match(transport.description, /transport capacity of 20 TYRANIDS INFANTRY/i);
});
