"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

global.window = {};
require("../ui/engine-runtime");
require("../ui/army-runtime");

test("browser pricing uses live occurrence counts over stale generated aliases", () => {
  const definition = {
    id: "unit",
    source: { catalogueId: "catalogue" },
    composition: [{ id: "model-definition", name: "Models", min: 10, max: 20, points: 0 }],
    compositionConstraints: [],
    selectionTree: {
      id: "unit",
      kind: "unit",
      children: [{ id: "model-occurrence", definitionId: "model-definition", kind: "model", children: [] }]
    },
    pricing: {
      base: 65,
      modifiers: [{
        operation: "set",
        value: 130,
        supported: true,
        when: { kind: "selection-count", selectionId: "model", operator: "atLeast", value: 11 }
      }]
    }
  };
  const entry = {
    unitId: "unit",
    selections: { "model-definition": 10, "model-occurrence": 20 }
  };

  assert.equal(window.RosterEngine.calculateEntryPoints(definition, entry).points, 130);
});

test("browser pricing applies roster copy-count modifiers from context", () => {
  const definition = {
    id: "taxed-unit",
    source: { catalogueId: "catalogue" },
    composition: [],
    compositionConstraints: [],
    pricing: {
      base: 100,
      modifiers: [{
        operation: "set",
        value: 120,
        supported: true,
        when: { kind: "roster-copy-count", operator: "atLeast", value: 2 }
      }]
    }
  };

  assert.equal(window.RosterEngine.calculateEntryPoints(definition, { unitId: "taxed-unit", selections: {}, context: { previousCopies: 1 } }).points, 100);
  assert.equal(window.RosterEngine.calculateEntryPoints(definition, { unitId: "taxed-unit", selections: {}, context: { previousCopies: 2 } }).points, 120);
});

test("browser army runtime filters unit assignment controls to relevant units", () => {
  const army = {
    id: "army",
    detachments: [{ id: "detachment", name: "Detachment", points: 0 }],
    enhancements: [{
      id: "enhancement",
      name: "Command Upgrade",
      detachmentIds: ["detachment"],
      eligibleSelectionKeys: ["leader-key"],
      points: 20,
      profiles: [{ characteristics: { Description: "Bearer gains a rule." } }]
    }]
  };
  const state = window.ArmyEngine.selectDetachment(army, window.ArmyEngine.createArmyState(army), "detachment");
  const leader = { instanceId: "leader-1", selectionKey: "leader-key", roles: { character: true, leader: true }, rosterRules: { canBeWarlord: true } };
  const line = { instanceId: "line-1", selectionKey: "line-key", roles: {}, rosterRules: { canBeWarlord: true } };

  const leaderAssignments = window.ArmyEngine.getUnitAssignmentState(army, state, [leader, line], leader);
  assert.equal(leaderAssignments.showWarlord, true);
  assert.deepEqual(leaderAssignments.enhancements.map(item => item.id), ["enhancement"]);

  const lineAssignments = window.ArmyEngine.getUnitAssignmentState(army, state, [leader, line], line);
  assert.equal(lineAssignments.showWarlord, false);
  assert.deepEqual(lineAssignments.enhancements, []);
});

test("browser army runtime offers selected-detachment upgrades without character enhancements on vehicles", () => {
  const army = {
    id: "army",
    detachments: [
      { id: "possessed", name: "Possessed Slaughterband", points: 0 },
      { id: "brazen", name: "Brazen Engines", points: 0 }
    ],
    enhancements: [{
      id: "focus",
      name: "Frenzied Focus",
      kind: "enhancement",
      detachmentIds: ["possessed"],
      eligibleSelectionKeys: ["character-key", "vehicle-key"],
      points: 20
    }, {
      id: "talons",
      name: "Talons of Butchery",
      kind: "upgrade",
      detachmentIds: ["brazen"],
      eligibleSelectionKeys: ["vehicle-key"],
      points: 20
    }]
  };
  const state = window.ArmyEngine.setSelectedDetachments(army, window.ArmyEngine.createArmyState(army), ["possessed", "brazen"]);
  const character = { instanceId: "character-1", selectionKey: "character-key", roles: { character: true }, rosterRules: {} };
  const vehicle = { instanceId: "vehicle-1", selectionKey: "vehicle-key", roles: {}, rosterRules: {} };

  assert.deepEqual(
    window.ArmyEngine.getUnitAssignmentState(army, state, [character, vehicle], vehicle).enhancements.map(item => item.name),
    ["Talons of Butchery"]
  );
});

test("browser army runtime builds grouped attached-unit presentation", () => {
  const army = {
    id: "army",
    allowedSelectionKeys: ["leader", "bodyguard"],
    detachments: [{ id: "detachment", name: "Detachment", points: 0 }],
    enhancements: []
  };
  const state = window.ArmyEngine.setLeaderAttachment(
    window.ArmyEngine.selectDetachment(army, window.ArmyEngine.createArmyState(army), "detachment"),
    "leader-1",
    "bodyguard-1"
  );
  const roster = [
    { instanceId: "leader-1", selectionKey: "leader", name: "Leader", points: 50, roles: { leader: true }, rosterRules: { leaderTargetSelectionKeys: ["bodyguard"] } },
    { instanceId: "bodyguard-1", selectionKey: "bodyguard", name: "Bodyguard", points: 100, roles: {}, rosterRules: {} }
  ];

  const presentation = window.ArmyEngine.getRosterPresentation(army, state, roster);
  assert.equal(presentation.length, 1);
  assert.equal(presentation[0].title, "Bodyguard + Leader");
  assert.equal(presentation[0].totalPoints, 150);
});

test("browser army runtime allows support attachments beside a leader", () => {
  const army = {
    id: "army",
    allowedSelectionKeys: ["leader", "support", "bodyguard"],
    detachments: [{ id: "detachment", name: "Detachment", points: 0 }],
    enhancements: []
  };
  let state = window.ArmyEngine.selectDetachment(army, window.ArmyEngine.createArmyState(army), "detachment");
  state = window.ArmyEngine.setLeaderAttachment(state, "leader-1", "bodyguard-1");
  state = window.ArmyEngine.setLeaderAttachment(state, "support-1", "bodyguard-1");
  const roster = [
    { instanceId: "leader-1", selectionKey: "leader", name: "Leader", points: 50, roles: { leader: true }, rosterRules: { leaderTargetSelectionKeys: ["bodyguard"] } },
    { instanceId: "support-1", selectionKey: "support", name: "Support", points: 40, roles: { leader: true, support: true }, rosterRules: { leaderTargetSelectionKeys: ["bodyguard"] } },
    { instanceId: "bodyguard-1", selectionKey: "bodyguard", name: "Bodyguard", points: 100, roles: {}, rosterRules: {} }
  ];

  const warnings = window.ArmyEngine.validateRosterLegality(army, state, roster).warnings;

  assert.equal(warnings.some(item => item.code === "BODYGUARD_HAS_MULTIPLE_LEADERS"), false);
});
