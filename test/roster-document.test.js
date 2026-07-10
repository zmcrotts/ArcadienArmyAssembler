"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createArmyState,
  getRosterPresentation,
  pruneArmyStateForRoster,
  selectDetachment,
  setEnhancement,
  setLeaderAttachment,
  setWarlord,
  validateRosterLegality
} = require("../src/domain/army");
const {
  createRosterDocument,
  exportRosterText,
  hydrateRosterDocument
} = require("../src/domain/roster-document");

const army = {
  id: "adepta-sororitas",
  rulesetId: "wh40k-10e-bsdata",
  allowedSelectionKeys: ["leader", "bodyguard", "ally"],
  armyRules: [{ name: "Acts of Faith", description: "Use Miracle dice." }],
  coreStratagems: [{ name: "Command Re-roll", cpCost: "1", description: "Re-roll an eligible roll." }],
  stratagemSource: { name: "Test Stratagem Source", nrversion: "1" },
  detachments: [{
    id: "hallowed-martyrs",
    name: "Hallowed Martyrs",
    points: 0,
    rules: [{ name: "Blood of Martyrs", description: "A detachment rule." }],
    stratagems: [{ name: "Spirit of the Martyr", cpCost: "1", description: "Fight on death." }]
  }],
  enhancements: [{
    id: "blade",
    name: "Saintly Example",
    points: 20,
    detachmentIds: ["hallowed-martyrs"],
    eligibleSelectionKeys: ["leader"],
    profiles: [{ characteristics: { Description: "Bearer inspires nearby units." } }]
  }]
};

const unitPackages = [{
  id: "leader",
  name: "Canoness",
  selectionKey: "leader",
  definition: {
    id: "leader",
    name: "Canoness",
    selectionKey: "leader",
    roles: { leader: true, character: true },
    rosterRules: { canBeWarlord: true, leaderTargetSelectionKeys: ["bodyguard"] }
  }
}, {
  id: "bodyguard",
  name: "Battle Sisters Squad",
  selectionKey: "bodyguard",
  definition: {
    id: "bodyguard",
    name: "Battle Sisters Squad",
    selectionKey: "bodyguard",
    roles: { battleline: true },
    rosterRules: {}
  }
}, {
  id: "ally",
  name: "Armiger Warglaive",
  selectionKey: "ally",
  alliedFor: { type: "imperialKnights", label: "Imperial Knights" },
  definition: {
    id: "ally",
    name: "Armiger Warglaive",
    selectionKey: "ally",
    roles: {},
    categories: ["Armiger"],
    rosterRules: { maxCopies: 6 }
  }
}];

function packageFor(selectionKey) {
  const found = unitPackages.find(item => item.selectionKey === selectionKey);
  assert.ok(found, `missing test unit package ${selectionKey}`);
  return found;
}

function rosterEntry(selectionKey, instanceId, points, selections = {}, size = 1) {
  const unitPackage = packageFor(selectionKey);
  return {
    instanceId,
    unitPackage,
    entry: {
      instanceId,
      unitId: unitPackage.id,
      selections,
      context: { points, size }
    }
  };
}

function legalityEntry(item) {
  return {
    instanceId: item.instanceId,
    selectionKey: item.unitPackage.selectionKey,
    name: item.unitPackage.name,
    points: item.entry.context.points,
    roles: item.unitPackage.definition.roles,
    categories: item.unitPackage.definition.categories,
    rosterRules: item.unitPackage.definition.rosterRules,
    alliedFor: item.unitPackage.alliedFor || null
  };
}

const services = {
  entryPoints: item => item.entry.context.points,
  configuredProfiles: (definition, entry) => ({
    weapons: Object.entries(entry.selections || {})
      .filter(([, count]) => count > 0)
      .map(([id, count]) => ({ id, name: id, typeName: "Ranged Weapons", count })),
    units: [],
    abilities: [],
    rules: []
  }),
  unitSizeState: (definition, entry) => ({
    current: entry.context?.size || 1,
    minimum: 1,
    maximum: 20,
    editable: true
  }),
  selectedDetachment: (armyDefinition, armyState) =>
    armyDefinition.detachments.find(item => item.id === armyState.detachmentId) || null
};

function buildDocument(roster, state, pointsLimit = 1000, options = {}) {
  const legalityRoster = roster.map(legalityEntry);
  const totalPoints = legalityRoster.reduce((sum, item) => sum + item.points, 0)
    + (state.enhancements || []).reduce((sum, assignment) => {
      const enhancement = army.enhancements.find(item => item.id === assignment.enhancementId);
      return sum + Number(enhancement?.points || 0);
    }, 0);
  const validation = validateRosterLegality(army, state, legalityRoster, { totalPoints, pointsLimit }).warnings;
  return createRosterDocument({
    engineData: { rulesetId: "wh40k-10e-bsdata", source: "bsdata-test" },
    faction: "Imperium - Adepta Sororitas",
    subfaction: "Order of Our Martyred Lady",
    pointsLimit,
    totalPoints,
    armyDefinition: army,
    armyState: state,
    rosterEntries: roster,
    groupedPresentation: getRosterPresentation(army, state, legalityRoster, { totalPoints, pointsLimit, warnings: validation }),
    rosterDisplay: options.rosterDisplay,
    validationWarnings: validation,
    services
  });
}

test("saved roster document preserves detachment, enhancement, unit identity, and loadout edits", () => {
  const leader = rosterEntry("leader", "leader-1", 55, { powerSword: 1 }, 1);
  const bodyguard = rosterEntry("bodyguard", "bodyguard-1", 120, { bolter: 10, flamer: 1 }, 10);
  const ally = rosterEntry("ally", "ally-1", 140, { thermalSpear: 1 }, 1);
  const roster = [leader, bodyguard, ally];
  let state = selectDetachment(army, createArmyState(army), "hallowed-martyrs");
  state = setWarlord(state, "leader-1");
  state = setEnhancement(army, state, roster.map(legalityEntry), "blade", "leader-1");
  state = setLeaderAttachment(state, "leader-1", "bodyguard-1");

  const rosterDisplay = {
    mode: "custom",
    customSections: ["custom:vanguard"],
    sectionLabels: { "custom:vanguard": "Vanguard" },
    groupSections: { "attached:bodyguard-1": "custom:vanguard" },
    groupOrder: ["attached:bodyguard-1", "ally-1"],
    unitNicknames: { "bodyguard-1": "The Wall", "ally-1": "Gatecrasher" }
  };

  const document = buildDocument(roster, state, 2000, { rosterDisplay });

  assert.equal(document.schemaVersion, 2);
  assert.equal(document.detachment.name, "Hallowed Martyrs");
  assert.deepEqual(document.armyRules.map(item => item.name), ["Acts of Faith"]);
  assert.deepEqual(document.coreStratagems.map(item => item.name), ["Command Re-roll"]);
  assert.deepEqual(document.detachments[0].stratagems.map(item => item.name), ["Spirit of the Martyr"]);
  assert.equal(document.stratagemSource.name, "Test Stratagem Source");
  assert.deepEqual(document.rosterDisplay.unitNicknames, { "bodyguard-1": "The Wall", "ally-1": "Gatecrasher" });
  assert.deepEqual(document.warlord, { instanceId: "leader-1", name: "Canoness", selectionKey: "leader" });
  assert.deepEqual(document.enhancements.map(item => [item.name, item.bearerInstanceId, item.points]), [["Saintly Example", "leader-1", 20]]);
  assert.equal(document.enhancements[0].description, "Bearer inspires nearby units.");
  assert.equal(document.rosterEntries.find(item => item.instanceId === "bodyguard-1").unitSize.current, 10);
  assert.deepEqual(document.rosterEntries.find(item => item.instanceId === "bodyguard-1").entry.selections, { bolter: 10, flamer: 1 });
  assert.equal(document.alliedUnits[0].name, "Armiger Warglaive");
  assert.equal(document.groupedPresentation[0].kind, "attached");
  assert.deepEqual(document.groupedPresentation[0].memberInstanceIds, ["bodyguard-1", "leader-1"]);

  const loaded = hydrateRosterDocument(document, {
    unitPackages,
    createArmyState: () => createArmyState(army),
    pruneArmyStateForRoster
  });
  assert.deepEqual(loaded.warnings, []);
  assert.deepEqual(loaded.roster.map(item => item.instanceId), ["leader-1", "bodyguard-1", "ally-1"]);
  assert.deepEqual(loaded.roster[1].entry.selections, { bolter: 10, flamer: 1 });
  assert.equal(loaded.armyState.enhancements[0].bearerInstanceId, "leader-1");
  assert.equal(loaded.armyState.attachments[0].targetInstanceId, "bodyguard-1");
});

test("exports include independent units, grouped presentation, warnings, points, and configured wargear", () => {
  const leaderA = rosterEntry("leader", "leader-a", 50, { blessedBlade: 1 });
  const leaderB = rosterEntry("leader", "leader-b", 45, { rod: 1 });
  const bodyguard = rosterEntry("bodyguard", "bodyguard-1", 100, { bolter: 10 }, 10);
  const roster = [leaderA, leaderB, bodyguard];
  let state = selectDetachment(army, createArmyState(army), "hallowed-martyrs");
  state = setWarlord(state, "leader-a");
  state = setLeaderAttachment(state, "leader-a", "bodyguard-1");
  state = setLeaderAttachment(state, "leader-b", "bodyguard-1");

  const document = buildDocument(roster, state);
  const text = exportRosterText(document);

  assert.equal(document.rosterEntries.length, 3);
  assert.equal(document.rosterEntries.find(item => item.name === "Canoness").roles.character, true);
  assert.equal(document.groupedPresentation.length, 1);
  assert.ok(document.validationWarnings.some(item => item.code === "BODYGUARD_HAS_MULTIPLE_LEADERS"));
  assert.match(text, /Detachment: Hallowed Martyrs/);
  assert.match(text, /Battle Sisters Squad \+ Canoness \+ Canoness - 195 pts \(attached\)/);
  assert.match(text, /WARNING: Battle Sisters Squad has 2 Leaders attached\./);
  assert.match(text, /10x Battle Sisters Squad - 100 pts/);
  assert.match(text, /10x bolter/);
});

test("exports support NR, WTC, WTC-Compact, and GW text formats", () => {
  const leader = rosterEntry("leader", "leader-1", 55, { blessedBlade: 1 });
  const bodyguard = rosterEntry("bodyguard", "bodyguard-1", 120, { bolter: 10 }, 10);
  const roster = [leader, bodyguard];
  let state = selectDetachment(army, createArmyState(army), "hallowed-martyrs");
  state = setWarlord(state, "leader-1");
  state = setEnhancement(army, state, roster.map(legalityEntry), "blade", "leader-1");

  const document = buildDocument(roster, state);
  const nr = exportRosterText(document, { format: "NR" });
  const wtc = exportRosterText(document, { format: "WTC" });
  const compact = exportRosterText(document, { format: "WTC-Compact" });
  const gw = exportRosterText(document, { format: "GW" });

  assert.match(nr, /Imperium - Adepta Sororitas -/);
  assert.match(nr, /- Enhancement: Saintly Example \(20 pts\)/);
  assert.match(wtc, /\+ FACTION KEYWORD: Imperium - Adepta Sororitas/);
  assert.match(wtc, /\+ WARLORD: Char1: Canoness/);
  assert.match(wtc, /CHARACTER/);
  assert.match(wtc, /Char1: Canoness \(55 pts\)/);
  assert.match(compact, /Canoness \(55 pts\): Enhancement: Saintly Example \(\+20 pts\), blessedBlade/);
  assert.doesNotMatch(compact, /\nCHARACTER\n/);
  assert.match(gw, /Canoness \(55 points\)/);
});

test("exports Discord compact list chunks with hide-subunit and combine options", () => {
  const document = {
    faction: "Xenos - Orks",
    subfaction: "Xenos - Orks",
    totalPoints: 300,
    pointsLimit: 1000,
    warlord: { instanceId: "ghaz-1", name: "Ghazghkull Thraka" },
    enhancements: [{ name: "Supa-Cybork Body", points: 15, bearerInstanceId: "warboss-1", bearerName: "Warboss" }],
    rosterEntries: [{
      instanceId: "ghaz-1",
      name: "Ghazghkull Thraka",
      points: 235,
      roles: { character: true, epicHero: true },
      keywords: ["Character", "Epic Hero"],
      unitSize: { current: 2 },
      models: [
        { name: "Ghazghkull Thraka", count: 1, equipment: ["Gork's Klaw", "Mork's Roar"] },
        { name: "Makari", count: 1, equipment: ["Makari's stabba"] }
      ],
      configured: { weapons: [], abilities: [], units: [], rules: [] }
    }, {
      instanceId: "warboss-1",
      name: "Warboss",
      points: 90,
      roles: { character: true },
      keywords: ["Character"],
      unitSize: { current: 1 },
      models: [{ name: "Warboss", count: 1, equipment: ["Power klaw", "Twin slugga"] }],
      configured: { weapons: [], abilities: [], units: [], rules: [] }
    }, {
      instanceId: "boyz-1",
      name: "Boyz",
      points: 150,
      roles: { battleline: true },
      keywords: ["Battleline"],
      unitSize: { current: 20 },
      models: [
        { name: "Boy", count: 19, equipment: ["17x Choppa", "17x Slugga", "2x Close combat weapon", "2x Rokkit launcha"] },
        { name: "Boss Nob", count: 1, equipment: ["Power klaw", "Slugga"] }
      ],
      configured: { weapons: [], abilities: [], units: [], rules: [] }
    }, {
      instanceId: "boyz-2",
      name: "Boyz",
      points: 150,
      roles: { battleline: true },
      keywords: ["Battleline"],
      unitSize: { current: 20 },
      models: [
        { name: "Boy", count: 19, equipment: ["17x Choppa", "17x Slugga", "2x Close combat weapon", "2x Rokkit launcha"] },
        { name: "Boss Nob", count: 1, equipment: ["Power klaw", "Slugga"] }
      ],
      configured: { weapons: [], abilities: [], units: [], rules: [] }
    }]
  };

  const compact = exportRosterText(document, { format: "DISCORD_COMPACT", ansi: false });
  const flat = exportRosterText(document, { format: "DISCORD_COMPACT_FLAT", ansi: false });
  const combined = exportRosterText(document, { format: "DISCORD_COMPACT_COMBINED", ansi: false });
  const extended = exportRosterText(document, { format: "DISCORD_EXTENDED_COMBINED", ansi: false });

  assert.match(compact, /\* 2 Ghazghkull Thraka \(Warlord\) \[235\]/);
  assert.match(compact, /  \+ 19 Boy \(17x CH, 17x SL, 2x CCW, 2x RL\)/);
  assert.match(flat, /\* 20 Boyz \(18x SL, 17x CH, 2x CCW, 2x RL, PK\) \[150\]/);
  assert.match(combined, /\* 2x20 Boyz \(18x SL, 17x CH, 2x CCW, 2x RL, PK\) \[150\]/);
  assert.match(extended, /\* 2x20 Boyz \(18x Slugga, 17x Choppa, 2x Close combat weapon, 2x Rokkit launcha, Power klaw\) \[150\]/);

  const optionsText = exportRosterText(document, {
    format: "DISCORD",
    compact: false,
    ansi: false,
    multilineHeader: true,
    noBullets: true,
    hidePoints: true,
    hideSubunits: true,
    combineIdentical: true
  });
  assert.match(optionsText, /^Xenos - Orks\nFaction: Xenos - Orks\n300 \/ 1000 pts\n\n2 Ghazghkull Thraka \(Warlord, Gork's Klaw, Makari's stabba, Mork's Roar\)/);
  assert.doesNotMatch(optionsText, /\*/);
  assert.doesNotMatch(optionsText, /\[\d+\]/);
});

test("Discord export groups attached leaders, supports, and bodyguards together", () => {
  const document = {
    faction: "Xenos - Orks",
    totalPoints: 550,
    pointsLimit: 1000,
    warlord: { instanceId: "ghaz-1", name: "Ghazghkull Thraka" },
    enhancements: [{ name: "Follow Me Ladz", points: 25, bearerInstanceId: "painboy-1", bearerName: "Painboy" }],
    rosterEntries: [{
      instanceId: "ghaz-1",
      name: "Ghazghkull Thraka",
      points: 235,
      roles: { character: true, leader: true },
      keywords: ["Character"],
      unitSize: { current: 2 },
      configured: { weapons: [], abilities: [], units: [], rules: [] }
    }, {
      instanceId: "painboy-1",
      name: "Painboy",
      points: 80,
      roles: { character: true, leader: true, support: true },
      keywords: ["Character"],
      unitSize: { current: 1 },
      configured: { weapons: [{ name: "'Urty syringe", count: 1 }], abilities: [], units: [], rules: [] }
    }, {
      instanceId: "nobz-1",
      name: "Nobz",
      points: 210,
      roles: {},
      keywords: ["Infantry"],
      unitSize: { current: 10 },
      configured: {
        weapons: [
          { name: "Power klaw", count: 9 },
          { name: "Slugga", count: 9 },
          { name: "Slugga and power klaw", count: 1 }
        ],
        abilities: [],
        units: [],
        rules: []
      }
    }],
    groupedPresentation: [{
      id: "attached:nobz-1",
      kind: "attached",
      title: "Nobz + Ghazghkull Thraka + Painboy",
      totalPoints: 550,
      bodyguardInstanceId: "nobz-1",
      leaderInstanceIds: ["ghaz-1", "painboy-1"],
      memberInstanceIds: ["nobz-1", "ghaz-1", "painboy-1"],
      warnings: []
    }]
  };

  const text = exportRosterText(document, { format: "DISCORD", compact: true, ansi: false, hideSubunits: true });
  assert.match(text, /^Attached unit 1: \[550\]\n\* 2 Ghazghkull Thraka \(Warlord\) \[235\]\n\* Painboy \(E: FML \(\+25 pts\), 'US\) \[105\]\n\* 10 Nobz \(9x PK, 9x SL, S&PK\) \[210\]/);
});

test("old saves hydrate while stale references are pruned with warnings", () => {
  const oldSave = {
    schemaVersion: 1,
    faction: "Imperium - Adepta Sororitas",
    subfaction: "Order of Our Martyred Lady",
    pointsLimit: "1000",
    armyState: {
      ...createArmyState(army),
      detachmentId: "hallowed-martyrs",
      warlordInstanceId: "missing-leader",
      attachments: [{ leaderInstanceId: "missing-leader", targetInstanceId: "bodyguard-1" }],
      enhancements: [{ enhancementId: "blade", bearerInstanceId: "missing-leader" }]
    },
    roster: [{
      selectionKey: "bodyguard",
      entry: {
        instanceId: "bodyguard-1",
        unitId: "bodyguard",
        selections: { bolter: 10 },
        context: { points: 100, size: 10 }
      }
    }, {
      selectionKey: "missing-unit",
      entry: {
        instanceId: "missing-unit-1",
        selections: {},
        context: { points: 30, size: 1 }
      }
    }]
  };

  const loaded = hydrateRosterDocument(oldSave, {
    unitPackages,
    createArmyState: () => createArmyState(army),
    pruneArmyStateForRoster
  });

  assert.deepEqual(loaded.roster.map(item => item.instanceId), ["bodyguard-1"]);
  assert.equal(loaded.armyState.warlordInstanceId, null);
  assert.deepEqual(loaded.armyState.attachments, []);
  assert.deepEqual(loaded.armyState.enhancements, []);
  assert.ok(loaded.warnings.some(item => item.code === "SAVED_UNIT_NOT_FOUND"));
  assert.equal(loaded.warnings.filter(item => item.code === "STALE_REFERENCE_PRUNED").length, 3);
});
