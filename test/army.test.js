"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { extractArmyDefinitions } = require("../src/bsdata/army-definitions");
const { extractUnitDefinitions } = require("../src/bsdata/unit-definitions");
const {
  calculateArmyOptionPoints,
  createArmyState,
  detachBodyguard,
  getEnhancementStates,
  getRosterPresentation,
  getUnitAssignmentState,
  pruneArmyStateForRoster,
  selectDetachment,
  selectedDetachments,
  setEnhancement,
  setLeaderAttachment,
  setSelectedDetachments,
  setWarlord,
  validateArmyState,
  validateRosterLegality
} = require("../src/domain/army");

const BSDATA = path.join(__dirname, "..", "data", "wh40K", "wh40k-10e-main", "wh40k-10e-main");
const armies = extractArmyDefinitions(BSDATA).definitions;
const units = extractUnitDefinitions(BSDATA).definitions;

function worldEaters() {
  const found = armies.find(item => item.faction === "Chaos - World Eaters");
  assert.ok(found, "Missing World Eaters army definition");
  return found;
}

function rosterUnit(name, instanceId) {
  const unit = units.find(item => item.faction === "Chaos - World Eaters" && item.name === name);
  assert.ok(unit, `Missing World Eaters unit ${name}`);
  return { instanceId, selectionKey: unit.selectionKey };
}

test("World Eaters detachments retain rules and detachment-gated enhancements", () => {
  const army = worldEaters();
  const warband = army.detachments.find(item => item.name === "Berzerker Warband");
  assert.equal(army.detachments.length, 6);
  assert.equal(warband.rules[0].name, "Relentless Rage");

  const glaive = army.enhancements.find(item => item.name === "Berzerker Glaive");
  assert.deepEqual(glaive.detachmentIds, [warband.id]);
  assert.equal(glaive.points, 35);
  assert.ok(glaive.eligibleSelectionKeys.length > 0);
});

test("catalogue-level faction rules are exposed as army rules", () => {
  const orks = armies.find(item => item.faction === "Xenos - Orks");
  assert.ok(orks, "Missing Orks army definition");
  const waaagh = orks.armyRules.find(item => item.name === "Waaagh!");
  assert.ok(waaagh, "Missing Waaagh! army rule");
  assert.match(waaagh.description, /once per battle, at the start of your Command phase/i);
  assert.match(waaagh.description, /5\+ invulnerable save/i);
  assert.equal(orks.armyRules.some(item => item.name === "Void Waaagh!"), false);
});

test("chapter catalogues inherit only context-legal Astartes detachments", () => {
  const bloodAngels = armies.find(item => item.faction === "Imperium - Adeptus Astartes - Blood Angels");
  assert.ok(bloodAngels);
  const names = bloodAngels.detachments.map(item => item.name);
  assert.ok(names.includes("Gladius Task Force"));
  assert.ok(names.includes("Liberator Assault Group"));
  assert.ok(!names.includes("Unforgiven Task Force"));
});

test("nested enhancement groups inherit their detachment gate", () => {
  const tyranids = armies.find(item => item.faction === "Xenos - Tyranids");
  const invasionFleet = tyranids.detachments.find(item => item.name === "Invasion Fleet");
  const alienCunning = tyranids.enhancements.find(item => item.name === "Alien Cunning");
  assert.ok(alienCunning);
  assert.deepEqual(alienCunning.detachmentIds, [invasionFleet.id]);
  assert.ok(alienCunning.eligibleSelectionKeys.length > 0);
});

test("enhancements require an eligible bearer and contribute points", () => {
  const army = worldEaters();
  const warband = army.detachments.find(item => item.name === "Berzerker Warband");
  const glaive = army.enhancements.find(item => item.name === "Berzerker Glaive");
  const bearer = rosterUnit("Master of Executions", "master-1");
  let state = selectDetachment(army, createArmyState(army), warband.id);

  const option = getEnhancementStates(army, state, [bearer]).find(item => item.id === glaive.id);
  assert.equal(option.selectable, true);
  state = setEnhancement(army, state, [bearer], glaive.id, bearer.instanceId);
  state = setWarlord(state, bearer.instanceId);
  assert.deepEqual(validateArmyState(army, state, [{ ...bearer, roles: { character: true }, rosterRules: { canBeWarlord: true } }]), []);
  assert.equal(calculateArmyOptionPoints(army, state), 35);

  const ineligible = rosterUnit("Khorne Berzerkers", "berzerkers-1");
  const advisoryState = setEnhancement(army, selectDetachment(army, createArmyState(army), warband.id), [ineligible], glaive.id, ineligible.instanceId);
  assert.equal(validateArmyState(army, advisoryState, [ineligible]).some(item => item.code === "ENHANCEMENT_BEARER_INELIGIBLE"), true);
});

test("repeatable upgrades can be assigned to more than one eligible unit", () => {
  const army = {
    id: "army",
    rulesetId: "wh40k-11e-vflam",
    allowedSelectionKeys: ["norn"],
    detachments: [{ id: "talons", name: "Talons", points: 0 }],
    enhancements: [{
      id: "synaptoprescience",
      name: "Synaptoprescience",
      kind: "upgrade",
      maxSelections: 3,
      points: 25,
      detachmentIds: ["talons"],
      eligibleSelectionKeys: ["norn"]
    }]
  };
  const roster = [
    { instanceId: "norn-1", selectionKey: "norn", name: "Norn Assimilator" },
    { instanceId: "norn-2", selectionKey: "norn", name: "Norn Assimilator" }
  ];
  let state = selectDetachment(army, createArmyState(army), "talons");

  state = setEnhancement(army, state, roster, "synaptoprescience", "norn-1");
  state = setEnhancement(army, state, roster, "synaptoprescience", "norn-2");

  const option = getEnhancementStates(army, state, roster).find(item => item.id === "synaptoprescience");
  assert.deepEqual(option.bearerInstanceIds, ["norn-1", "norn-2"]);
  assert.equal(calculateArmyOptionPoints(army, state), 50);
  assert.equal(validateArmyState(army, state, roster).some(item => item.code === "ENHANCEMENT_DUPLICATE"), false);

  state = setEnhancement(army, state, roster, "synaptoprescience", "norn-1");
  assert.deepEqual(state.enhancements, [{ enhancementId: "synaptoprescience", bearerInstanceId: "norn-2" }]);
});

test("unit assignments show selected-detachment upgrades without offering character enhancements to vehicles", () => {
  const army = {
    id: "army",
    rulesetId: "wh40k-11e-vflam",
    allowedSelectionKeys: ["character", "vehicle"],
    detachments: [
      { id: "possessed", name: "Possessed Slaughterband", points: 0 },
      { id: "brazen", name: "Brazen Engines", points: 0 }
    ],
    enhancements: [{
      id: "focus",
      name: "Frenzied Focus",
      kind: "enhancement",
      points: 20,
      detachmentIds: ["possessed"],
      eligibleSelectionKeys: ["character", "vehicle"]
    }, {
      id: "talons",
      name: "Talons of Butchery",
      kind: "upgrade",
      points: 20,
      detachmentIds: ["brazen"],
      eligibleSelectionKeys: ["vehicle"]
    }]
  };
  const character = { instanceId: "character-1", selectionKey: "character", name: "Master of Executions", roles: { character: true }, rosterRules: { canBeWarlord: true } };
  const vehicle = { instanceId: "vehicle-1", selectionKey: "vehicle", name: "Maulerfiend", roles: {}, rosterRules: {} };
  const roster = [character, vehicle];
  const state = setSelectedDetachments(army, createArmyState(army), ["possessed", "brazen"]);

  assert.deepEqual(getUnitAssignmentState(army, state, roster, vehicle).enhancements.map(item => item.name), ["Talons of Butchery"]);
  assert.deepEqual(getUnitAssignmentState(army, state, roster, character).enhancements.map(item => item.name), ["Frenzied Focus"]);
});

test("roster legality is authoritative but advisory across core army rules", () => {
  const army = {
    id: "army", rulesetId: "wh40k-10e-bsdata", allowedSelectionKeys: ["battleline", "regular", "leader", "bodyguard", "epic", "transport"],
    detachments: [{ id: "detachment", name: "Detachment", points: 0 }], enhancements: []
  };
  const make = (selectionKey, number, roles = {}, rosterRules = {}) => Array.from({ length: number }, (_, index) => ({
    instanceId: `${selectionKey}-${index}`, selectionKey, name: selectionKey, roles, rosterRules
  }));
  const roster = [
    ...make("battleline", 7, { battleline: true }, { maxCopies: 6 }),
    ...make("regular", 4, {}, { maxCopies: 3 }),
    ...make("epic", 2, { epicHero: true, character: true }, { maxCopies: 1, canBeWarlord: true }),
    ...make("transport", 7, { dedicatedTransport: true }, { maxCopies: 6 }),
    ...make("leader", 1, { leader: true, character: true }, { canBeWarlord: true, leaderTargetSelectionKeys: ["bodyguard"] }),
    ...make("bodyguard", 1),
    ...make("foreign", 1)
  ];
  let state = selectDetachment(army, createArmyState(army), "detachment");
  state = setWarlord(state, "regular-0");
  state = setLeaderAttachment(state, "leader-0", "regular-0");
  const result = validateRosterLegality(army, state, roster, { totalPoints: 2100, pointsLimit: 2000 });
  const codes = new Set(result.warnings.map(item => item.code));
  assert.equal(result.legal, false);
  assert.deepEqual([...codes].sort(), [
    "ALLY_NOT_ALLOWED", "BATTLELINE_LIMIT_EXCEEDED", "DEDICATED_TRANSPORT_LIMIT_EXCEEDED",
    "EPIC_HERO_UNIQUE", "LEADER_ATTACHMENT_INVALID", "POINTS_LIMIT_EXCEEDED",
    "UNIT_COPY_LIMIT_EXCEEDED", "WARLORD_INELIGIBLE"
  ]);
  assert.equal(roster.length, 23, "illegal choices remain in roster state");
});

test("changing detachments preserves selections and warns about stale enhancements", () => {
  const army = worldEaters();
  const warband = army.detachments.find(item => item.name === "Berzerker Warband");
  const vessels = army.detachments.find(item => item.name === "Vessels of Wrath");
  const glaive = army.enhancements.find(item => item.name === "Berzerker Glaive");
  const bearer = rosterUnit("Master of Executions", "master-1");
  let state = selectDetachment(army, createArmyState(army), warband.id);
  state = setEnhancement(army, state, [bearer], glaive.id, bearer.instanceId);
  state = selectDetachment(army, state, vessels.id);
  assert.equal(state.enhancements.length, 1);
  assert.equal(validateArmyState(army, state, [bearer]).some(item => item.code === "ENHANCEMENT_NOT_AVAILABLE"), true);
});

test("multiple 11th detachments spend detachment points by battle size", () => {
  const army = {
    id: "army",
    rulesetId: "wh40k-11e-vflam",
    allowedSelectionKeys: [],
    detachments: [
      { id: "one", name: "One DP", points: 0, detachmentPoints: 1 },
      { id: "two", name: "Two DP", points: 0, detachmentPoints: 2 },
      { id: "three", name: "Three DP", points: 0, detachmentPoints: 3 }
    ],
    enhancements: []
  };

  let state = setSelectedDetachments(army, createArmyState(army), ["one", "two"]);
  assert.deepEqual(selectedDetachments(army, state).map(item => item.name), ["One DP", "Two DP"]);
  assert.equal(validateRosterLegality(army, state, [], { pointsLimit: 1000 }).warnings.some(item => item.code === "DETACHMENT_POINTS_EXCEEDED"), true);
  assert.equal(validateRosterLegality(army, state, [], { pointsLimit: 2000 }).warnings.some(item => item.code === "DETACHMENT_POINTS_EXCEEDED"), false);

  state = setSelectedDetachments(army, state, ["three"]);
  assert.equal(validateRosterLegality(army, state, [], { pointsLimit: 1000 }).warnings.some(item => item.code === "DETACHMENT_POINTS_EXCEEDED"), false);

  state = setSelectedDetachments(army, state, ["three", "one"]);
  assert.equal(validateRosterLegality(army, state, [], { pointsLimit: 3000 }).warnings.some(item => item.code === "DETACHMENT_POINTS_EXCEEDED"), false);
  assert.equal(validateRosterLegality(army, state, [], { pointsLimit: 2000 }).warnings.some(item => item.code === "DETACHMENT_POINTS_EXCEEDED"), true);
});

test("assigning and removing unit relationships never mutates unit identity or configuration", () => {
  const army = worldEaters();
  const warband = army.detachments.find(item => item.name === "Berzerker Warband");
  const glaive = army.enhancements.find(item => item.name === "Berzerker Glaive");
  const leader = {
    ...rosterUnit("Master of Executions", "master-1"),
    entry: { instanceId: "master-1", selections: { weapon: 1 }, context: { size: 1 } }
  };
  const bodyguard = {
    ...rosterUnit("Khorne Berzerkers", "berzerkers-1"),
    entry: { instanceId: "berzerkers-1", selections: { models: 10 }, context: { size: 10 } }
  };
  const roster = [leader, bodyguard];
  const before = structuredClone(roster);
  let state = selectDetachment(army, createArmyState(army), warband.id);

  state = setWarlord(state, leader.instanceId);
  state = setEnhancement(army, state, roster, glaive.id, leader.instanceId);
  state = setLeaderAttachment(state, leader.instanceId, bodyguard.instanceId);
  state = setLeaderAttachment(state, leader.instanceId, null);
  state = setEnhancement(army, state, roster, glaive.id, null);
  state = setWarlord(state, null);

  assert.deepEqual(roster, before);
  assert.deepEqual(state.attachments, []);
  assert.deepEqual(state.enhancements, []);
  assert.equal(state.warlordInstanceId, null);
});

test("roster presentation groups attached leaders while preserving independent entries", () => {
  const army = {
    id: "army",
    rulesetId: "wh40k-10e-bsdata",
    allowedSelectionKeys: ["leader-a", "leader-b", "bodyguard"],
    detachments: [{ id: "detachment", name: "Detachment", points: 0 }],
    enhancements: []
  };
  const roster = [
    {
      instanceId: "leader-a-1",
      selectionKey: "leader-a",
      name: "Canoness",
      points: 50,
      roles: { leader: true, character: true },
      rosterRules: { leaderTargetSelectionKeys: ["bodyguard"], allowsAdditionalLeader: true }
    },
    {
      instanceId: "leader-b-1",
      selectionKey: "leader-b",
      name: "Dialogus",
      points: 30,
      roles: { leader: true, character: true },
      rosterRules: { leaderTargetSelectionKeys: ["bodyguard"] }
    },
    {
      instanceId: "bodyguard-1",
      selectionKey: "bodyguard",
      name: "Battle Sisters Squad",
      points: 100,
      roles: { battleline: true },
      rosterRules: {}
    }
  ];
  const before = structuredClone(roster);
  let state = selectDetachment(army, createArmyState(army), "detachment");
  state = setLeaderAttachment(state, "leader-a-1", "bodyguard-1");
  state = setLeaderAttachment(state, "leader-b-1", "bodyguard-1");

  const presentation = getRosterPresentation(army, state, roster);
  assert.equal(presentation.length, 1);
  assert.equal(presentation[0].kind, "attached");
  assert.equal(presentation[0].title, "Battle Sisters Squad + Canoness + Dialogus");
  assert.equal(presentation[0].totalPoints, 180);
  assert.deepEqual(presentation[0].memberInstanceIds, ["bodyguard-1", "leader-a-1", "leader-b-1"]);
  assert.deepEqual(presentation[0].warnings.map(item => item.code), []);
  assert.deepEqual(roster, before, "presentation does not collapse or mutate source roster entries");
});

test("support leaders can share a bodyguard with another leader", () => {
  const army = {
    id: "army",
    rulesetId: "wh40k-11e-vflam",
    allowedSelectionKeys: ["leader", "support", "bodyguard"],
    detachments: [{ id: "detachment", name: "Detachment", points: 0 }],
    enhancements: []
  };
  const roster = [
    { instanceId: "leader-1", selectionKey: "leader", name: "Warboss", points: 75, roles: { leader: true, character: true }, rosterRules: { leaderTargetSelectionKeys: ["bodyguard"] } },
    { instanceId: "support-1", selectionKey: "support", name: "Painboy", points: 70, roles: { leader: true, character: true, support: true }, rosterRules: { leaderTargetSelectionKeys: ["bodyguard"] } },
    { instanceId: "bodyguard-1", selectionKey: "bodyguard", name: "Nobz", points: 150, roles: {}, rosterRules: {} }
  ];
  let state = selectDetachment(army, createArmyState(army), "detachment");
  state = setLeaderAttachment(state, "leader-1", "bodyguard-1");
  state = setLeaderAttachment(state, "support-1", "bodyguard-1");

  const validation = validateRosterLegality(army, state, roster);
  const presentation = getRosterPresentation(army, state, roster);
  assert.equal(validation.warnings.some(item => item.code === "BODYGUARD_HAS_MULTIPLE_LEADERS"), false);
  assert.deepEqual(presentation[0].memberInstanceIds, ["bodyguard-1", "leader-1", "support-1"]);
  assert.deepEqual(presentation[0].warnings.map(item => item.code), []);
});

test("roster presentation allocates enhancement points to the bearer and attached group", () => {
  const army = {
    id: "army",
    rulesetId: "wh40k-11e-vflam",
    allowedSelectionKeys: ["leader", "bodyguard"],
    detachments: [{ id: "detachment", name: "Detachment", points: 0 }],
    enhancements: [{ id: "relic", name: "Relic", points: 15, detachmentIds: ["detachment"], eligibleSelectionKeys: ["leader"] }]
  };
  const leader = { instanceId: "leader-1", selectionKey: "leader", name: "Warboss", points: 75, roles: { leader: true, character: true }, rosterRules: { leaderTargetSelectionKeys: ["bodyguard"] } };
  const bodyguard = { instanceId: "bodyguard-1", selectionKey: "bodyguard", name: "Boyz", points: 80, roles: {}, rosterRules: {} };
  let state = selectDetachment(army, createArmyState(army), "detachment");
  state = setEnhancement(army, state, [leader, bodyguard], "relic", "leader-1");

  let presentation = getRosterPresentation(army, state, [leader, bodyguard]);
  const leaderGroup = presentation.find(item => item.id === "leader-1");
  assert.equal(leaderGroup.totalPoints, 90);
  assert.equal(leaderGroup.basePoints, 75);
  assert.equal(leaderGroup.enhancementPoints, 15);

  state = setLeaderAttachment(state, "leader-1", "bodyguard-1");
  presentation = getRosterPresentation(army, state, [leader, bodyguard]);
  assert.equal(presentation[0].totalPoints, 170);
  assert.equal(presentation[0].basePoints, 155);
  assert.equal(presentation[0].enhancementPoints, 15);
});

test("roster presentation keeps invalid attachments visible as warnings", () => {
  const army = {
    id: "army",
    rulesetId: "wh40k-10e-bsdata",
    allowedSelectionKeys: ["leader-a", "leader-b", "bodyguard"],
    detachments: [{ id: "detachment", name: "Detachment", points: 0 }],
    enhancements: []
  };
  const roster = [
    { instanceId: "leader-a-1", selectionKey: "leader-a", name: "Leader A", points: 50, roles: { leader: true }, rosterRules: { leaderTargetSelectionKeys: ["bodyguard"] } },
    { instanceId: "leader-b-1", selectionKey: "leader-b", name: "Leader B", points: 45, roles: { leader: true }, rosterRules: { leaderTargetSelectionKeys: ["bodyguard"] } },
    { instanceId: "bodyguard-1", selectionKey: "bodyguard", name: "Line Unit", points: 100, roles: {}, rosterRules: {} }
  ];
  let state = selectDetachment(army, createArmyState(army), "detachment");
  state = setLeaderAttachment(state, "leader-a-1", "bodyguard-1");
  state = setLeaderAttachment(state, "leader-b-1", "bodyguard-1");

  const presentation = getRosterPresentation(army, state, roster);
  assert.equal(presentation.length, 1);
  assert.deepEqual(presentation[0].warnings.map(item => item.code), ["BODYGUARD_HAS_MULTIPLE_LEADERS"]);
});

test("detaching and removing attached units splits groups without losing remaining configuration", () => {
  const army = {
    id: "army",
    rulesetId: "wh40k-10e-bsdata",
    allowedSelectionKeys: ["leader", "bodyguard"],
    detachments: [{ id: "detachment", name: "Detachment", points: 0 }],
    enhancements: [{ id: "relic", name: "Relic", points: 10, detachmentIds: ["detachment"], eligibleSelectionKeys: ["leader"] }]
  };
  const leader = {
    instanceId: "leader-1",
    selectionKey: "leader",
    name: "Leader",
    points: 50,
    roles: { leader: true, character: true },
    rosterRules: { canBeWarlord: true, leaderTargetSelectionKeys: ["bodyguard"] },
    entry: { instanceId: "leader-1", selections: { sword: 1 } }
  };
  const bodyguard = {
    instanceId: "bodyguard-1",
    selectionKey: "bodyguard",
    name: "Bodyguard",
    points: 100,
    roles: {},
    rosterRules: {},
    entry: { instanceId: "bodyguard-1", selections: { models: 10 } }
  };
  let roster = [leader, bodyguard];
  const before = structuredClone(roster);
  let state = selectDetachment(army, createArmyState(army), "detachment");
  state = setWarlord(state, leader.instanceId);
  state = setEnhancement(army, state, roster, "relic", leader.instanceId);
  state = setLeaderAttachment(state, leader.instanceId, bodyguard.instanceId);

  state = detachBodyguard(state, bodyguard.instanceId);
  assert.deepEqual(state.attachments, []);
  assert.deepEqual(roster, before);
  assert.equal(getRosterPresentation(army, state, roster).length, 2);

  state = setLeaderAttachment(state, leader.instanceId, bodyguard.instanceId);
  roster = roster.filter(item => item.instanceId !== leader.instanceId);
  state = pruneArmyStateForRoster(state, roster);
  assert.deepEqual(state.attachments, []);
  assert.deepEqual(state.enhancements, []);
  assert.equal(state.warlordInstanceId, null);
  assert.deepEqual(roster[0], before[1], "bodyguard configuration survives leader removal");
});

test("unit assignment state only offers controls relevant to the selected unit", () => {
  const army = worldEaters();
  const warband = army.detachments.find(item => item.name === "Berzerker Warband");
  const glaive = army.enhancements.find(item => item.name === "Berzerker Glaive");
  const leader = {
    ...rosterUnit("Master of Executions", "master-1"),
    name: "Master of Executions",
    roles: { leader: true, character: true },
    rosterRules: { canBeWarlord: true, leaderTargetSelectionKeys: [] }
  };
  const bodyguard = {
    ...rosterUnit("Khorne Berzerkers", "berzerkers-1"),
    name: "Khorne Berzerkers",
    roles: { battleline: true },
    rosterRules: { canBeWarlord: true }
  };
  const roster = [leader, bodyguard];
  let state = selectDetachment(army, createArmyState(army), warband.id);

  const leaderAssignments = getUnitAssignmentState(army, state, roster, leader);
  assert.equal(leaderAssignments.showWarlord, true);
  assert.equal(leaderAssignments.enhancements.length > 0, true);
  assert.equal(leaderAssignments.enhancements.every(item =>
    item.bearerOptions.find(option => option.instanceId === leader.instanceId)?.eligible
  ), true);

  const bodyguardAssignments = getUnitAssignmentState(army, state, roster, bodyguard);
  assert.equal(bodyguardAssignments.showWarlord, false);
  assert.deepEqual(bodyguardAssignments.enhancements, []);

  state = setWarlord(state, bodyguard.instanceId);
  state = setEnhancement(army, state, roster, glaive.id, bodyguard.instanceId);
  const staleAssignments = getUnitAssignmentState(army, state, roster, bodyguard);
  assert.equal(staleAssignments.showWarlord, true, "stale invalid warlord selection can still be cleared");
  assert.deepEqual(staleAssignments.enhancements.map(item => item.id), [glaive.id], "stale invalid enhancement can still be cleared");
});

test("leader assignment accepts equivalent datasheet names across shared source copies", () => {
  const army = {
    id: "army",
    rulesetId: "wh40k-11e-vflam",
    allowedSelectionKeys: ["blood-angels-priest", "space-marines-bladeguard"],
    detachments: [{ id: "detachment", name: "Detachment", points: 0 }],
    enhancements: []
  };
  const priest = {
    instanceId: "priest-1",
    selectionKey: "blood-angels-priest",
    name: "Sanguinary Priest",
    roles: { leader: true, character: true },
    rosterRules: {
      leaderTargetNames: ["Bladeguard Veteran Squad"],
      leaderTargetSelectionKeys: ["blood-angels-bladeguard"]
    }
  };
  const bladeguard = {
    instanceId: "bladeguard-1",
    selectionKey: "space-marines-bladeguard",
    name: "Bladeguard Veteran Squad",
    roles: {},
    rosterRules: {}
  };
  const roster = [priest, bladeguard];
  let state = selectDetachment(army, createArmyState(army), "detachment");

  const assignments = getUnitAssignmentState(army, state, roster, bladeguard);
  assert.deepEqual(assignments.eligibleLeaders.map(item => item.instanceId), ["priest-1"]);

  state = setLeaderAttachment(state, priest.instanceId, bladeguard.instanceId);
  assert.equal(validateRosterLegality(army, state, roster).warnings.some(item => item.code === "LEADER_ATTACHMENT_INVALID"), false);
});
