"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

global.window = {};
require("../ui/engine-runtime");
require("../ui/army-runtime");

test("live roster panels feed selected unit profiles back through static effect rendering", () => {
  for (const file of ["../ui/engine-app.js", "../mobile/ui/engine-app.js"]) {
    const source = fs.readFileSync(require.resolve(file), "utf8");
    assert.match(source, /const effects = \[\s*\.\.\.selectedArmyAndDetachmentEffects\(\),\s*\.\.\.configuredEffectSources\(configured\),/);
    assert.match(source, /function configuredEffectSources[\s\S]*configured\.profiles/);
    assert.match(source, /class="modifiedCharacteristic" title="Modified from base profile"/);
  }
});

test("army rule reference cards render nested D6 tables", () => {
  for (const file of ["../ui/engine-app.js", "../mobile/ui/engine-app.js"]) {
    const source = fs.readFileSync(require.resolve(file), "utf8");
    assert.match(source, /function renderArmyRuleTables\(rule\)/);
    assert.match(source, /<th>\$\{escapeHtml\(table\.dice \|\| "Roll"\)\}<\/th>/);
    assert.match(source, /\$\{renderArmyRuleTables\(rule\)\}/);
    assert.match(source, /\$\{renderArmyRuleTables\(item\)\}/);
  }
});

test("browser runtime adds the selected God Blessing to CSM Daemon Prince names", () => {
  const definition = {
    name: "Heretic Astartes Daemon Prince",
    selectionTree: {
      id: "daemon-prince",
      kind: "unit",
      children: [{
        id: "god-blessing",
        kind: "group",
        name: "God Blessing",
        children: [
          { id: "khorne", kind: "upgrade", name: "Khorne" },
          { id: "nurgle", kind: "upgrade", name: "Nurgle" },
          { id: "slaanesh", kind: "upgrade", name: "Slaanesh" },
          { id: "tzeentch", kind: "upgrade", name: "Tzeentch" }
        ]
      }]
    }
  };

  assert.equal(
    window.RosterEngine.getConfiguredUnitName(definition, { selections: { nurgle: 1 } }),
    "Heretic Astartes Daemon Prince of Nurgle"
  );
  assert.equal(
    window.RosterEngine.getConfiguredUnitName({ name: "Chaos Lord", selectionTree: {} }, { selections: { nurgle: 1 } }),
    "Chaos Lord"
  );
});

test("browser loadout states expose mandatory descendant wargear costs", () => {
  const definition = {
    id: "vehicle",
    selectionTree: {
      id: "vehicle",
      kind: "unit",
      children: [{
        id: "weapon-choice",
        kind: "upgrade",
        name: "2 ectoplasma cannons",
        points: 0,
        constraints: [],
        children: [{
          id: "ectoplasma-cannon",
          kind: "upgrade",
          name: "Ectoplasma cannon",
          points: 5,
          constraints: [
            { id: "weapon-min", type: "min", field: "selections", scope: "parent", value: 2 },
            { id: "weapon-max", type: "max", field: "selections", scope: "parent", value: 2 }
          ],
          children: []
        }]
      }]
    }
  };
  const state = window.RosterEngine.getOptionStates(definition, {
    unitId: "vehicle",
    selections: { "weapon-choice": 1, "ectoplasma-cannon": 2 }
  }).find(option => option.id === "weapon-choice");

  assert.equal(state.points, 0);
  assert.equal(state.effectivePoints, 10);
});

test("browser configured profiles suppress fallback melee weapons after replacement", () => {
  const closeCombatProfile = id => ({
    id,
    name: "Close combat weapon",
    typeName: "Melee Weapons",
    characteristics: {}
  });
  const definition = {
    id: "squad",
    selectionTree: {
      id: "squad",
      kind: "unit",
      children: [
        {
          id: "replacement-model",
          kind: "model",
          name: "Model with chainsword",
          children: [
            { id: "replacement-close-combat", kind: "upgrade", name: "Close combat weapon", profiles: [closeCombatProfile("ccw-a")], children: [] },
            {
              id: "chainsword",
              kind: "upgrade",
              name: "Astartes chainsword",
              profiles: [{ id: "chainsword-profile", name: "Astartes chainsword", typeName: "Melee Weapons", characteristics: {} }],
              children: []
            }
          ]
        },
        {
          id: "fallback-model",
          kind: "model",
          name: "Model with fallback weapon",
          children: [
            { id: "fallback-close-combat", kind: "upgrade", name: "Close combat weapon", profiles: [closeCombatProfile("ccw-b")], children: [] }
          ]
        }
      ]
    }
  };
  const entry = {
    unitId: "squad",
    selections: {
      "replacement-model": 1,
      "replacement-close-combat": 1,
      chainsword: 1,
      "fallback-model": 1,
      "fallback-close-combat": 1
    }
  };

  const configured = window.RosterEngine.getConfiguredProfiles(definition, entry);
  const models = window.RosterEngine.getConfiguredModels(definition, entry);
  assert.equal(configured.weapons.find(weapon => weapon.name === "Close combat weapon")?.count, 1);
  assert.equal(configured.weapons.find(weapon => weapon.name === "Astartes chainsword")?.count, 1);
  assert.deepEqual(models.find(model => model.id === "replacement-model").equipment, ["Astartes chainsword"]);
  assert.deepEqual(models.find(model => model.id === "fallback-model").equipment, ["Close combat weapon"]);
});

test("browser army runtime gates Knight AdMech units behind Questor Forgepact", () => {
  const army = {
    faction: "Imperium - Imperial Knights",
    detachments: [
      { id: "forgepact", name: "Questor Forgepact" },
      { id: "other", name: "Valourstrike Lance" }
    ]
  };
  const skitarii = {
    name: "Skitarii Vanguard",
    categories: ["Faction: Adeptus Mechanicus", "Skitarii"]
  };

  assert.equal(window.ArmyEngine.canAddUnitForSelectedDetachment(army, { detachmentIds: ["other"] }, skitarii), false);
  assert.equal(window.ArmyEngine.canAddUnitForSelectedDetachment(army, { detachmentIds: ["forgepact"] }, skitarii), true);
});

test("saved roster hydration restores detachment state before matching gated units", () => {
  for (const file of ["../ui/engine-app.js", "../mobile/ui/engine-app.js"]) {
    const source = fs.readFileSync(require.resolve(file), "utf8");
    assert.match(source, /function factionUnits\(state = armyState\)/);
    assert.match(source, /const hydrationArmyState = \{[\s\S]*?\.\.\.\(save\.armyState \|\| \{\}\)[\s\S]*?unitPackages: factionUnits\(hydrationArmyState\)/);
    assert.match(source, /canAddUnitForSelectedDetachment\(army, state, unit\)/);
  }
});

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

test("browser loadout runtime ignores force constraints and normalizes negative sentinels", () => {
  const definition = {
    id: "constraint-unit",
    selectionKey: "constraint-unit",
    composition: [],
    compositionConstraints: [],
    pricing: { base: 10, modifiers: [] },
    selectionTree: {
      id: "constraint-unit",
      kind: "unit",
      constraints: [],
      children: [{
        id: "force-option",
        kind: "upgrade",
        name: "Force option",
        constraints: [
          { id: "force-min", field: "selections", type: "min", scope: "force", value: 3 },
          { id: "local-max", field: "selections", type: "max", scope: "parent", value: 1 }
        ],
        children: []
      }, {
        id: "sentinel-option",
        kind: "upgrade",
        name: "Sentinel option",
        constraints: [
          { id: "sentinel-min", field: "selections", type: "min", scope: "parent", value: -1 },
          { id: "sentinel-max", field: "selections", type: "max", scope: "parent", value: 1 }
        ],
        children: []
      }]
    }
  };

  const entry = window.RosterEngine.createDefaultRosterEntry(definition);
  assert.equal(entry.selections["force-option"] || 0, 0);
  assert.equal(entry.selections["sentinel-option"] || 0, 0);
  assert.equal(Object.values(entry.selections).every(Number.isFinite), true);
  assert.deepEqual(window.RosterEngine.validateLoadout(definition, entry), []);
});

test("browser loadout runtime accepts boolean round-up repeat flags", () => {
  const definition = {
    id: "repeat-unit",
    selectionKey: "repeat-unit",
    composition: [],
    compositionConstraints: [],
    pricing: { base: 10, modifiers: [] },
    selectionTree: {
      id: "repeat-unit",
      kind: "unit",
      constraints: [],
      modifiers: [],
      children: [{
        id: "models",
        kind: "model",
        name: "Models",
        constraints: [],
        modifiers: [],
        children: []
      }, {
        id: "special-weapon",
        kind: "upgrade",
        name: "Special weapon",
        constraints: [{ id: "special-max", field: "selections", type: "max", scope: "parent", value: 0 }],
        modifiers: [],
        children: []
      }, {
        id: "repeat-rule",
        kind: "upgrade",
        name: "Repeat rule",
        constraints: [],
        modifiers: [{
          field: "special-max",
          type: "increment",
          value: 1,
          conditions: [],
          conditionGroups: [],
          repeats: [{ childId: "models", value: 2, repeats: 1, roundUp: true }]
        }],
        children: []
      }]
    }
  };

  const state = window.RosterEngine.getOptionStates(definition, {
    unitId: definition.id,
    selections: { models: 3 }
  }).find(option => option.id === "special-weapon");

  assert.equal(state.maximum, 2);
});

test("browser loadout runtime preserves mixed per-model weapon allocations", () => {
  const choice = (id, name) => ({
    id,
    kind: "upgrade",
    name,
    constraints: [{ id: `${id}-max`, field: "selections", type: "max", scope: "parent", value: 1 }],
    modifiers: [],
    children: []
  });
  const definition = {
    id: "retributors",
    selectionKey: "retributors",
    composition: [],
    compositionConstraints: [],
    pricing: { base: 0, modifiers: [] },
    selectionTree: {
      id: "retributors",
      kind: "unit",
      constraints: [],
      modifiers: [],
      children: [{
        id: "models",
        kind: "model",
        name: "Retributors",
        constraints: [],
        modifiers: [],
        children: [{
          id: "weapons",
          kind: "group",
          name: "Weapons",
          defaultSelectionId: "bolter",
          constraints: [
            { id: "weapons-min", field: "selections", type: "min", scope: "parent", value: 1 },
            { id: "weapons-max", field: "selections", type: "max", scope: "parent", value: 1 }
          ],
          modifiers: [],
          children: [choice("flamer", "Heavy flamer"), choice("melta", "Multi-melta"), choice("bolter", "Heavy bolter")]
        }]
      }]
    }
  };
  let entry = { unitId: definition.id, selections: { models: 4, flamer: 2, melta: 0, bolter: 2 } };

  entry = window.RosterEngine.setSelection(definition, entry, "melta", 1);
  entry = window.RosterEngine.setSelection(definition, entry, "melta", 2);

  assert.deepEqual(
    { flamer: entry.selections.flamer, melta: entry.selections.melta, bolter: entry.selections.bolter },
    { flamer: 2, melta: 2, bolter: 0 }
  );
  assert.deepEqual(window.RosterEngine.validateLoadout(definition, entry), []);
});

test("browser loadout runtime uses unit category IDs for faction-specific options", () => {
  const definition = {
    id: "breachers",
    selectionKey: "tau:breachers",
    categoryIds: ["breacher-team-category"],
    composition: [],
    compositionConstraints: [],
    pricing: { base: 10, modifiers: [] },
    selectionTree: {
      id: "breachers",
      kind: "unit",
      constraints: [],
      modifiers: [],
      children: [{
        id: "guardian-drone",
        kind: "upgrade",
        name: "Guardian Drone",
        constraints: [{ id: "guardian-max", field: "selections", type: "max", scope: "parent", value: 1 }],
        modifiers: [{
          field: "hidden",
          type: "set",
          value: "true",
          conditions: [{ type: "notInstanceOf", childId: "breacher-team-category" }],
          conditionGroups: [],
          repeats: []
        }],
        children: []
      }]
    }
  };

  const state = window.RosterEngine.getOptionStates(definition, {
    unitId: definition.id,
    selections: {}
  }).find(option => option.id === "guardian-drone");

  assert.equal(state.active, true);
  assert.equal(state.editable, true);
});

test("browser configured profiles count selected descendants of profile groups", () => {
  const definition = {
    id: "profile-unit",
    selectionKey: "profile-unit",
    selectionTree: {
      id: "profile-unit",
      kind: "unit",
      constraints: [],
      profiles: [],
      children: [{
        id: "profile-group",
        kind: "group",
        name: "Profile group",
        constraints: [],
        profiles: [{ id: "profile", name: "Grouped models", typeName: "Unit", characteristics: {} }],
        children: [{ id: "models", kind: "model", name: "Models", constraints: [], profiles: [], children: [] }]
      }]
    }
  };
  const configured = window.RosterEngine.getConfiguredProfiles(definition, {
    unitId: definition.id,
    selections: { models: 5 }
  });

  assert.equal(configured.units[0].name, "Grouped models");
  assert.equal(configured.units[0].count, 5);
});

test("browser army runtime evaluates generic all-keyword Leader targets", () => {
  const leader = {
    rosterRules: {
      leaderTargetSelectionKeys: [],
      leaderTargetNames: [],
      leaderTargetPredicates: [{ kind: "keywords-all", keywords: ["battleline", "imperium", "infantry"] }]
    }
  };
  const target = {
    selectionKey: "cadians",
    name: "Cadian Shock Troops",
    categories: ["Battleline", "Imperium", "Infantry"]
  };

  assert.equal(window.ArmyEngine.leaderCanTarget(leader, target), true);
  assert.equal(window.ArmyEngine.leaderCanTarget(leader, { ...target, categories: ["Imperium", "Infantry"] }), false);
});

test("browser army runtime only returns stratagems whose structured target matches the unit", () => {
  const army = {
    coreStratagems: [
      { id: "reroll", name: "Command Re-roll", scope: "core", target: { type: "any" } },
      { id: "smoke", name: "Smokescreen", scope: "core", target: { type: "keyword", value: "SMOKE" } }
    ],
    detachments: [{
      id: "detachment",
      name: "Armoured Spearhead",
      stratagems: [
        {
          id: "vehicle",
          name: "Armoured Wrath",
          scope: "detachment",
          target: { op: "AND", operands: [{ type: "keyword", value: "VEHICLE" }, { op: "NOT", operands: [{ type: "keyword", value: "TITANIC" }] }] }
        },
        { id: "named", name: "Russ Doctrine", scope: "detachment", target: { type: "unit", value: "Leman Russ" } },
        { id: "unverified", name: "Unverified", scope: "detachment", target: null }
      ]
    }, {
      id: "other",
      name: "Other Detachment",
      stratagems: [{ id: "other-strat", name: "Other Stratagem", scope: "detachment", target: { type: "any" } }]
    }]
  };
  const state = window.ArmyEngine.selectDetachment(army, window.ArmyEngine.createArmyState(army), "detachment");
  const lemanRuss = { name: "Leman Russ", keywords: ["VEHICLE", "SMOKE"] };

  assert.deepEqual(
    window.ArmyEngine.eligibleStratagemsForEntry(army, state, lemanRuss).map(item => item.id),
    ["reroll", "smoke", "vehicle", "named"]
  );
  assert.equal(
    window.ArmyEngine.eligibleStratagemsForEntry(army, state, { name: "Baneblade", keywords: ["VEHICLE", "TITANIC"] })
      .some(item => item.id === "vehicle"),
    false
  );
  assert.equal(
    window.ArmyEngine.stratagemTargetMatches({ type: "keyword", value: "TYRANIDS" }, { keywords: ["Faction: Tyranids"] }, state),
    true
  );
});

test("browser army runtime derives conservative eligibility from legacy TARGET wording", () => {
  const infantryMutant = {
    name: "Tzaangors",
    keywords: ["Faction: Thousand Sons", "INFANTRY", "MUTANT"],
    knownKeywords: ["THOUSAND SONS", "INFANTRY", "MOUNTED", "MUTANT", "MONSTER"]
  };
  const targetText = "<b>WHEN:</b> Your Movement phase.<br><br><b>TARGET:</b> One friendly INFANTRY/MOUNTED MUTANT unit.<br><br><b>EFFECT:</b> Do a thing.";

  assert.equal(window.ArmyEngine.stratagemDescriptionTargetMatches(targetText, infantryMutant, {}), true);
  assert.equal(window.ArmyEngine.stratagemDescriptionTargetMatches(
    targetText,
    { ...infantryMutant, keywords: ["Faction: Thousand Sons", "MONSTER", "MUTANT"] },
    {}
  ), false);
  assert.equal(window.ArmyEngine.stratagemDescriptionTargetMatches(
    "<b>TARGET:</b> One enemy unit within 6\" of your unit.<br><br><b>EFFECT:</b> Do a thing.",
    infantryMutant,
    {}
  ), false);
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

test("browser army runtime applies selectable detachment keyword upgrades before enhancement eligibility", () => {
  const army = {
    id: "guard",
    detachments: [{ id: "steel-hammer", name: "Steel Hammer", points: 0 }],
    enhancements: [{
      id: "titan-killer",
      name: "Titan Killer",
      kind: "enhancement",
      detachmentIds: ["steel-hammer"],
      eligibleSelectionKeys: ["baneblade-key"],
      points: 20
    }]
  };
  const baneblade = {
    instanceId: "baneblade-1",
    selectionKey: "baneblade-key",
    keywords: ["Titanic"],
    roles: {},
    rosterRules: { canBeWarlord: true },
    definition: {
      conditionalKeywords: [{ keyword: "Character", detachmentIds: ["steel-hammer"], selectable: true }]
    }
  };
  let state = window.ArmyEngine.selectDetachment(army, window.ArmyEngine.createArmyState(army), "steel-hammer");

  let assignment = window.ArmyEngine.getUnitAssignmentState(army, state, [baneblade], baneblade);
  assert.deepEqual(assignment.keywordUpgrades, [{ keyword: "Character", selected: false }]);
  assert.deepEqual(assignment.enhancements, []);

  state = window.ArmyEngine.setKeywordAssignment(state, baneblade.instanceId, "Character", true);
  assignment = window.ArmyEngine.getUnitAssignmentState(army, state, [baneblade], baneblade);
  assert.equal(assignment.showWarlord, true);
  assert.deepEqual(assignment.enhancements.map(item => item.name), ["Titan Killer"]);
});

test("browser army runtime recognizes equivalent unit entries across catalogues", () => {
  const army = {
    id: "raven-guard",
    detachments: [{ id: "shadowmark", name: "Shadowmark Talon", points: 0 }],
    enhancements: [{
      id: "blackwing-shroud",
      name: "Blackwing Shroud",
      kind: "enhancement",
      detachmentIds: ["shadowmark"],
      eligibleSelectionKeys: ["raven-guard-catalogue:captain-entry"]
    }]
  };
  const captain = {
    instanceId: "captain-1",
    selectionKey: "space-marines-catalogue:captain-entry",
    roles: { character: true },
    rosterRules: {}
  };
  const state = window.ArmyEngine.selectDetachment(army, window.ArmyEngine.createArmyState(army), "shadowmark");

  assert.deepEqual(
    window.ArmyEngine.getUnitAssignmentState(army, state, [captain], captain).enhancements.map(item => item.name),
    ["Blackwing Shroud"]
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

test("browser army runtime warns when god-specific summoned daemons lack the daemon detachment", () => {
  const army = {
    id: "thousand-sons",
    faction: "Chaos - Thousand Sons",
    allowedSelectionKeys: ["blue-horrors"],
    detachments: [
      { id: "grand-coven", name: "Grand Coven", points: 0 },
      { id: "changehost", name: "Changehost of Deceit", points: 0 }
    ],
    enhancements: []
  };
  const roster = [{
    instanceId: "blue-horrors-1",
    selectionKey: "blue-horrors",
    name: "Blue Horrors",
    faction: "Chaos - Thousand Sons",
    categories: ["Daemon", "Summoned", "Tzeentch"],
    roles: { battleline: true },
    rosterRules: {}
  }];

  let state = window.ArmyEngine.selectDetachment(army, window.ArmyEngine.createArmyState(army), "grand-coven");
  assert.equal(window.ArmyEngine.canAddUnitForSelectedDetachment(army, state, roster[0]), false);
  assert.equal(window.ArmyEngine.canAddUnitForSelectedDetachment(army, state, {
    alliedFor: { type: "chaosDaemons" },
    faction: "Chaos - Daemons Library",
    categories: ["Daemon", "Tzeentch"]
  }), false);
  assert.equal(window.ArmyEngine.canAddUnitForSelectedDetachment({
    ...army,
    faction: "Chaos - World Eaters",
    detachments: [
      { id: "berzerker", name: "Berzerker Warband", points: 0 },
      { id: "daemonkin", name: "Khorne Daemonkin", points: 0 }
    ]
  }, { ...state, detachmentId: "berzerker", detachmentIds: ["berzerker"] }, {
    name: "Skarbrand",
    faction: "Chaos - World Eaters",
    categories: ["Daemon", "Khorne", "Faction: Blood Legions"]
  }), false);
  assert.equal(
    window.ArmyEngine.validateRosterLegality(army, state, roster).warnings.some(item => item.code === "DAEMON_DETACHMENT_REQUIRED"),
    true
  );

  state = window.ArmyEngine.selectDetachment(army, state, "changehost");
  assert.equal(window.ArmyEngine.canAddUnitForSelectedDetachment(army, state, roster[0]), true);
  assert.equal(window.ArmyEngine.canAddUnitForSelectedDetachment(army, state, {
    alliedFor: { type: "chaosDaemons" },
    faction: "Chaos - Daemons Library",
    categories: ["Daemon", "Nurgle"]
  }), false);
  assert.equal(
    window.ArmyEngine.validateRosterLegality(army, state, roster).warnings.some(item => item.code === "DAEMON_DETACHMENT_REQUIRED"),
    false
  );
});
