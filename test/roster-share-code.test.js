"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { decodeRoster, encodeRoster } = require("../src/domain/roster-share-code");

const SUPPORTED_FACTION = "Imperium - Adeptus Custodes";

const root = path.resolve(__dirname, "..");

function loadContext() {
  const window = { ROSTER_ENGINE_FACTIONS: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, "ui", "engine-data-manifest.js"), "utf8"), { window });
  vm.runInNewContext(fs.readFileSync(path.join(root, "ui", "engine-data", "imperium-adeptus-custodes.js"), "utf8"), { window });
  return {
    faction: SUPPORTED_FACTION,
    subfaction: SUPPORTED_FACTION,
    factionIds: [SUPPORTED_FACTION],
    unitPackages: window.ROSTER_ENGINE_FACTIONS[SUPPORTED_FACTION],
    armyDefinition: window.ROSTER_ENGINE_DATA.armies[SUPPORTED_FACTION]
  };
}

function record(unit, index, changes = {}) {
  const instanceId = `test-${index}`;
  return {
    instanceId,
    selectionKey: unit.selectionKey,
    name: unit.name,
    entry: {
      ...structuredClone(unit.defaultEntry),
      instanceId,
      selections: { ...structuredClone(unit.defaultEntry.selections), ...changes }
    }
  };
}

test("Custodes share codes round-trip roster decisions without rules or profiles", () => {
  const context = loadContext();
  const guard = context.unitPackages.find(unit => unit.name === "Custodian Guard");
  const captain = context.unitPackages.find(unit => unit.name === "Shield-Captain");
  const changedOption = Object.keys(guard.defaultEntry.selections)[0];
  const detachment = context.armyDefinition.detachments[0];
  const enhancement = context.armyDefinition.enhancements.find(item => (item.detachmentIds || []).includes(detachment.id));
  const rosterEntries = [
    record(guard, 0, { [changedOption]: Number(guard.defaultEntry.selections[changedOption] || 0) + 1 }),
    record(captain, 1)
  ];
  const document = {
    faction: SUPPORTED_FACTION,
    subfaction: SUPPORTED_FACTION,
    name: "The Golden Test",
    pointsLimit: 2000,
    rosterEntries,
    rosterDisplay: { unitNicknames: { "test-0": "Golden Wall" } },
    armyState: {
      detachmentId: detachment.id,
      detachmentIds: [detachment.id],
      warlordInstanceId: "test-1",
      primaryMissionName: "Test Mission",
      attachments: [{ leaderInstanceId: "test-1", targetInstanceId: "test-0" }],
      enhancements: enhancement ? [{ enhancementId: enhancement.id, bearerInstanceId: "test-1" }] : [],
      keywordAssignments: [{ instanceId: "test-0", keyword: "Character" }]
    }
  };

  const code = encodeRoster(document, context);
  const decoded = decodeRoster(code, context);

  assert.match(code, /^AAA2-[A-Za-z0-9_-]+$/);
  assert.ok(code.length < 220, `expected a compact code, received ${code.length} characters`);
  assert.equal(decoded.name, document.name);
  assert.equal(decoded.pointsLimit, 2000);
  assert.deepEqual(decoded.rosterEntries.map(item => item.selectionKey), rosterEntries.map(item => item.selectionKey));
  assert.equal(decoded.rosterEntries[0].entry.selections[changedOption], rosterEntries[0].entry.selections[changedOption]);
  assert.equal(decoded.armyState.warlordInstanceId, "shared-2");
  assert.deepEqual(decoded.armyState.attachments, [{ leaderInstanceId: "shared-2", targetInstanceId: "shared-1" }]);
  assert.deepEqual(decoded.armyState.keywordAssignments, [{ instanceId: "shared-1", keyword: "Character" }]);
  assert.equal(decoded.armyState.primaryMissionName, "Test Mission");
  assert.equal(decoded.rosterDisplay.unitNicknames["shared-1"], "Golden Wall");
  assert.equal(decoded.armyState.detachmentId, detachment.id);
  if (enhancement) assert.equal(decoded.armyState.enhancements[0].enhancementId, enhancement.id);
});

test("Custodes share codes preserve aggregate selection IDs used by real rosters", () => {
  const context = loadContext();
  const allarus = context.unitPackages.find(unit => unit.name === "Allarus Custodians");
  const aggregateIds = Object.keys(allarus.defaultEntry.selections)
    .filter(id => !id.includes("/"));
  assert.ok(aggregateIds.length, "expected source definition counters in the Allarus defaults");

  const changes = Object.fromEntries(aggregateIds.map(id => [id, Number(allarus.defaultEntry.selections[id] || 0) + 1]));
  const original = record(allarus, 0, changes);
  const document = {
    faction: SUPPORTED_FACTION,
    subfaction: SUPPORTED_FACTION,
    name: "Allarus aggregate IDs",
    pointsLimit: 1000,
    rosterEntries: [original],
    armyState: { detachmentIds: [], attachments: [], enhancements: [], keywordAssignments: [] }
  };

  const decoded = decodeRoster(encodeRoster(document, context), context);
  for (const id of aggregateIds) {
    assert.equal(decoded.rosterEntries[0].entry.selections[id], original.entry.selections[id]);
  }
});

test("Custodes share codes detect damage and incompatible dictionaries", () => {
  const context = loadContext();
  const document = {
    faction: SUPPORTED_FACTION,
    pointsLimit: 1000,
    rosterEntries: [record(context.unitPackages[0], 0)],
    armyState: { detachmentIds: [], attachments: [], enhancements: [], keywordAssignments: [] }
  };
  const code = encodeRoster(document, context);
  const damageAt = code.length - 8;
  const damaged = code.slice(0, damageAt) + (code[damageAt] === "A" ? "B" : "A") + code.slice(damageAt + 1);
  assert.throws(() => decodeRoster(damaged, context), /damaged|incomplete/);
  assert.throws(() => decodeRoster(code, { ...context, unitPackages: context.unitPackages.slice(1) }), /different unit-option dictionary/);
});

test("the encoder rejects a roster that does not match its loaded faction dictionary", () => {
  const context = loadContext();
  assert.throws(() => encodeRoster({ faction: "Xenos - Orks", subfaction: "Xenos - Orks", rosterEntries: [{}] }, context), /not supported|different faction/);
});

test("AAA1 Custodes pilot codes remain importable", () => {
  const context = loadContext();
  const code = "AAA1-MXyyT9APE0kgS25vdyBLdW5nIEZ1LVRFU1QCBgUEAAsCBQADAQMCAwMDBgMZABkACwUEAQUFDQEOARABDQQABQEFAgUFBQ0EAAUBBQIFBQUGAAYAFAAXAAcCAAAMAQAEBwMJBQgABgQBFwgA2qn4lQ";
  const decoded = decodeRoster(code, context);
  assert.equal(decoded.name, "I Know Kung Fu-TEST");
  assert.equal(decoded.faction, SUPPORTED_FACTION);
  assert.equal(decoded.rosterEntries.length, 11);
});
