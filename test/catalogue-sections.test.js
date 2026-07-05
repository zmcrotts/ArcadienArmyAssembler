"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { SECTION_ORDER, sectionForUnit, groupUnits } = require("../ui/catalogue-sections");

function unit(name, categories, roles = {}, alliedFor = null) {
  return { name, alliedFor, definition: { categories, roles } };
}

test("catalogue sections use the requested display order", () => {
  assert.deepEqual(SECTION_ORDER, [
    "Epic Hero", "Character", "Battleline", "Infantry", "Mounted", "Beast",
    "Monster", "Vehicle", "Dedicated Transport", "Fortification", "Allied Units"
  ]);
});

test("each unit receives one section using role priority", () => {
  assert.equal(sectionForUnit(unit("Hero", ["Character", "Infantry"], { epicHero: true, character: true })), "Epic Hero");
  assert.equal(sectionForUnit(unit("Troops", ["Battleline", "Infantry"], { battleline: true })), "Battleline");
  assert.equal(sectionForUnit(unit("Rhino", ["Dedicated Transport", "Vehicle"], { dedicatedTransport: true })), "Dedicated Transport");
  assert.equal(sectionForUnit(unit("Guest", ["Character"], { character: true }, { type: "agents" })), "Allied Units");
});

test("units are alphabetical within their single section", () => {
  const groups = groupUnits([
    unit("Zoanthropes", ["Infantry"]),
    unit("Barbgaunts", ["Infantry"]),
    unit("Alpha", ["Character", "Infantry"], { character: true })
  ]);
  assert.deepEqual(groups.find(group => group.section === "Infantry").units.map(item => item.name), ["Barbgaunts", "Zoanthropes"]);
  assert.equal(groups.reduce((sum, group) => sum + group.units.length, 0), 3);
});
