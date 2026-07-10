"use strict";

const path = require("path");

const { extractUnitDefinitions } = require("../bsdata/unit-definitions");
const { extractArmyDefinitions } = require("../bsdata/army-definitions");
const { extractAllyDefinitions } = require("../bsdata/ally-definitions");
const {
  attachStratagemsToArmies,
  mergeStratagemSources,
  readLocalCoreStratagems,
  readLocalDetachmentStratagems,
  readNewRecruitStratagems
} = require("./newrecruit-stratagems");
const {
  applyMfmAttachments,
  readMfmAttachments
} = require("./mfm-attachments");

const ROOT = path.resolve(__dirname, "..", "..");

const RULESET_SOURCES = {
  "wh40k-10e-bsdata": {
    id: "wh40k-10e-bsdata",
    edition: "10e",
    game: "warhammer-40000",
    format: "bsdata-xml",
    sourcePath: path.join(ROOT, "data", "wh40K", "wh40k-10e-main", "wh40k-10e-main"),
    primary: false,
    description: "Original 10th-edition BSData scaffold."
  },
  "wh40k-11e-vflam": {
    id: "wh40k-11e-vflam",
    edition: "11e",
    game: "warhammer-40000",
    format: "bsdata-json",
    sourcePath: path.join(ROOT, "data", "rulesets", "wh40k-11e-vflam"),
    auxiliarySources: {
      coreStratagems: path.join(ROOT, "data", "manual-rules", "wh40k-11e-core-stratagems.json"),
      detachmentStratagems: [
        path.join(ROOT, "data", "manual-rules", "wh40k-11e-tyranids-detachment-stratagems.json"),
        path.join(ROOT, "data", "manual-rules", "wh40k-11e-wahapedia-detachment-stratagems.json")
      ],
      armyRules: path.join(ROOT, "data", "manual-rules", "wh40k-11e-army-rules.json"),
      mfmAttachments: path.join(ROOT, "data", "manual-rules", "wh40k-11e-mfm-attachments.json"),
      stratagems: path.join(ROOT, "data", "rulesets", "wh40k-11e-newrecruit", "stratagems.json")
    },
    primary: true,
    description: "11th-edition BSData-style JSON catalogues from vflam/wh40k-11e."
  }
};

const DEFAULT_RULESET_SOURCE_ID = "wh40k-11e-vflam";

function getRulesetSource(id = DEFAULT_RULESET_SOURCE_ID) {
  const source = RULESET_SOURCES[id];
  if (!source) throw new Error(`Unknown ruleset source: ${id}`);
  return { ...source };
}

function listRulesetSources() {
  return Object.values(RULESET_SOURCES).map(source => ({ ...source }));
}

function extractNormalizedRuleset(id = DEFAULT_RULESET_SOURCE_ID) {
  const source = getRulesetSource(id);
  if (!["bsdata-xml", "bsdata-json"].includes(source.format)) {
    throw new Error(`No extractor registered for ruleset source format: ${source.format}`);
  }

  const unitsResult = extractUnitDefinitions(source.sourcePath);
  const stratagemSource = mergeStratagemSources(
    readLocalCoreStratagems(source.auxiliarySources?.coreStratagems),
    readNewRecruitStratagems(source.auxiliarySources?.stratagems),
    ...asArray(source.auxiliarySources?.detachmentStratagems).map(readLocalDetachmentStratagems)
  );
  const armyDefinitions = attachStratagemsToArmies(extractArmyDefinitions(source.sourcePath).definitions, stratagemSource).map(army => ({
    ...army,
    rulesetId: source.id
  }));
  const armyRules = readManualArmyRules(source.auxiliarySources?.armyRules);
  const armiesWithRules = applyManualArmyRules(armyDefinitions, armyRules);
  const mfmAttachments = readMfmAttachments(source.auxiliarySources?.mfmAttachments);
  const mfmAttachmentResult = applyMfmAttachments(unitsResult.definitions, mfmAttachments);
  const unitDefinitions = applyManualLoadoutCorrections(mfmAttachmentResult.definitions.map(unit => ({
    ...unit,
    rulesetId: source.id
  })));

  return {
    source,
    units: unitDefinitions,
    armies: armiesWithRules,
    allies: extractAllyDefinitions(source.sourcePath, unitDefinitions),
    stratagemSource: stratagemSource.source,
    mfmAttachmentSource: {
      source: mfmAttachments.source,
      generatedAt: mfmAttachments.generatedAt,
      ...mfmAttachmentResult.summary
    },
    unresolved: unitsResult.unresolved
  };
}

module.exports = {
  DEFAULT_RULESET_SOURCE_ID,
  RULESET_SOURCES,
  extractNormalizedRuleset,
  getRulesetSource,
  listRulesetSources
};

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function readManualArmyRules(filePath) {
  if (!filePath) return { rules: [], source: null };
  try {
    const document = JSON.parse(require("fs").readFileSync(filePath, "utf8"));
    return {
      rules: Array.isArray(document?.rules) ? document.rules : [],
      source: {
        kind: document?.kind || "manual-army-rules",
        name: document?.name || "Manual Army Rules",
        nrversion: document?.nrversion || null,
        lastUpdated: document?.lastUpdated || null,
        filePath
      }
    };
  } catch {
    return { rules: [], source: null };
  }
}

function applyManualArmyRules(armies, manualRules) {
  if (!manualRules?.rules?.length) return armies;
  const byFaction = new Map();
  for (const rule of manualRules.rules) {
    if (!rule?.faction || !rule?.name) continue;
    if (!byFaction.has(rule.faction)) byFaction.set(rule.faction, []);
    byFaction.get(rule.faction).push(rule);
  }

  return armies.map(army => {
    const replacements = byFaction.get(army.faction) || [];
    if (!replacements.length) return army;
    const armyRules = [...(army.armyRules || [])];
    for (const replacement of replacements) {
      const index = armyRules.findIndex(rule => sameRuleName(rule.name, replacement.name));
      const rule = {
        id: index >= 0 ? armyRules[index].id : null,
        name: replacement.name,
        description: replacement.description || "",
        source: manualRules.source
      };
      if (index >= 0) armyRules[index] = { ...armyRules[index], ...rule };
      else armyRules.push(rule);
    }
    return {
      ...army,
      armyRules,
      armyRuleSource: manualRules.source
    };
  });
}

function sameRuleName(left, right) {
  return String(left || "").trim().toLowerCase() === String(right || "").trim().toLowerCase();
}

function applyManualLoadoutCorrections(definitions) {
  return definitions.map(definition => {
    if (
      definition.rulesetId === "wh40k-11e-vflam"
      && definition.faction === "Xenos - Leagues of Votann"
      && definition.name === "Einhyr Hearthguard"
    ) {
      return fixEinhyrHearthguardLoadout(definition);
    }

    if (
      definition.rulesetId !== "wh40k-11e-vflam"
      || definition.faction !== "Imperium - Adeptus Astartes - Blood Angels"
      || definition.name !== "Death Company Marines with Jump Packs"
    ) {
      return definition;
    }

    const unit = clone(definition);
    const profiles = profilesByOptionName(unit.selectionTree);
    const alternate = findNodeByName(unit.selectionTree, "Death Company Marine w/ alternate weapons");
    if (!alternate) return unit;

    alternate.defaultEquipment = ["Astartes Chainsword", "Heavy Bolt Pistol"];
    alternate.profiles = [
      ...profilesFor(profiles, "astartes chainsword"),
      ...profilesFor(profiles, "heavy bolt pistol")
    ];
    alternate.children = [
      manualGroup("dcjp-plasma-pistol", "Plasma pistol", [
        manualOption("dcjp-plasma-pistol-option", "Plasma pistol", {
          profiles: profilesFor(profiles, "plasma pistol"),
          replaceProfiles: profilesFor(profiles, "heavy bolt pistol"),
          replacesEquipment: ["Heavy Bolt Pistol"]
        })
      ]),
      manualGroup("dcjp-eviscerator", "Eviscerator", [
        manualOption("dcjp-eviscerator-option", "Eviscerator", {
          profiles: profilesFor(profiles, "eviscerator"),
          replaceProfiles: profilesFor(profiles, "astartes chainsword"),
          replacesEquipment: ["Astartes Chainsword"]
        })
      ]),
      manualGroup("dcjp-power-fist-power-weapon", "Power fist or power weapon", [
        manualOption("dcjp-power-fist", "Power fist", {
          profiles: profilesFor(profiles, "power fist"),
          replaceProfiles: profilesFor(profiles, "astartes chainsword"),
          replacesEquipment: ["Astartes Chainsword"]
        }),
        manualOption("dcjp-power-weapon", "Power weapon", {
          profiles: profilesFor(profiles, "power weapon"),
          replaceProfiles: profilesFor(profiles, "astartes chainsword"),
          replacesEquipment: ["Astartes Chainsword"]
        })
      ], { maximum: 1, dynamicEvery: 0 }),
      manualGroup("dcjp-paired-alternate-weapons", "Paired pistol and melee weapon", [
        pairedManualOption("dcjp-hand-flamer-chainsword", "1 hand flamer and 1 Astartes chainsword", profiles, "hand flamer", "astartes chainsword"),
        pairedManualOption("dcjp-hand-flamer-power-fist", "1 hand flamer and 1 power fist", profiles, "hand flamer", "power fist"),
        pairedManualOption("dcjp-hand-flamer-power-weapon", "1 hand flamer and 1 power weapon", profiles, "hand flamer", "power weapon"),
        pairedManualOption("dcjp-heavy-bolt-pistol-power-fist", "1 heavy bolt pistol and 1 power fist", profiles, "heavy bolt pistol", "power fist"),
        pairedManualOption("dcjp-heavy-bolt-pistol-power-weapon", "1 heavy bolt pistol and 1 power weapon", profiles, "heavy bolt pistol", "power weapon"),
        pairedManualOption("dcjp-inferno-pistol-chainsword", "1 inferno pistol and 1 Astartes chainsword", profiles, "inferno pistol", "astartes chainsword"),
        pairedManualOption("dcjp-inferno-pistol-power-fist", "1 inferno pistol and 1 power fist", profiles, "inferno pistol", "power fist"),
        pairedManualOption("dcjp-inferno-pistol-power-weapon", "1 inferno pistol and 1 power weapon", profiles, "inferno pistol", "power weapon"),
        pairedManualOption("dcjp-plasma-pistol-chainsword", "1 plasma pistol and 1 Astartes chainsword", profiles, "plasma pistol", "astartes chainsword"),
        pairedManualOption("dcjp-plasma-pistol-power-fist", "1 plasma pistol and 1 power fist", profiles, "plasma pistol", "power fist"),
        pairedManualOption("dcjp-plasma-pistol-power-weapon", "1 plasma pistol and 1 power weapon", profiles, "plasma pistol", "power weapon")
      ])
    ];

    return unit;
  });
}

function fixEinhyrHearthguardLoadout(definition) {
  const unit = clone(definition);
  for (const group of findNodesByName(unit.selectionTree, "Ranged weapon")) {
    const etaCarn = (group.children || []).find(child => normalizeName(child.name) === "etacarn plasma gun");
    const volkanite = (group.children || []).find(child => normalizeName(child.name) === "volkanite disintegrator");
    if (!etaCarn || !volkanite) continue;

    group.defaultSelectionId = etaCarn.id;
    group.constraints = [
      manualSelectionConstraint("einhyr-hesyr-ranged-min", "min", "parent", 1),
      manualSelectionConstraint("einhyr-hesyr-ranged-max", "max", "parent", 1)
    ];
    for (const option of [etaCarn, volkanite]) {
      option.hidden = false;
      option.modifiers = [];
      option.constraints = [manualSelectionConstraint(`${option.sourceId || option.id}-max`, "max", "parent", 1)];
    }
  }
  return unit;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeName(value) {
  return String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function findNodeByName(node, name) {
  if (!node) return null;
  if (normalizeName(node.name) === normalizeName(name)) return node;
  for (const child of node.children || []) {
    const found = findNodeByName(child, name);
    if (found) return found;
  }
  return null;
}

function findNodesByName(node, name, matches = []) {
  if (!node) return matches;
  if (normalizeName(node.name) === normalizeName(name)) matches.push(node);
  for (const child of node.children || []) findNodesByName(child, name, matches);
  return matches;
}

function profilesByOptionName(node, map = new Map()) {
  if (!node) return map;
  if (!["unit", "group", "model"].includes(node.kind) && node.profiles?.length) {
    const key = normalizeName(node.name);
    if (!map.has(key)) map.set(key, node.profiles.map(clone));
  }
  for (const child of node.children || []) profilesByOptionName(child, map);
  return map;
}

function profilesFor(map, name) {
  return (map.get(normalizeName(name)) || []).map(clone);
}

function pairedManualOption(id, name, profileMap, pistol, melee) {
  const replacesEquipment = [];
  const replaceProfiles = [];
  const profiles = [];
  if (normalizeName(pistol) !== "heavy bolt pistol") {
    profiles.push(...profilesFor(profileMap, pistol));
    replaceProfiles.push(...profilesFor(profileMap, "heavy bolt pistol"));
    replacesEquipment.push("Heavy Bolt Pistol");
  }
  if (normalizeName(melee) !== "astartes chainsword") {
    profiles.push(...profilesFor(profileMap, melee));
    replaceProfiles.push(...profilesFor(profileMap, "astartes chainsword"));
    replacesEquipment.push("Astartes Chainsword");
  }
  return manualOption(id, name, { profiles, replaceProfiles, replacesEquipment });
}

function manualGroup(id, name, children, options = {}) {
  const constraintId = `${id}-max`;
  const dynamicEvery = options.dynamicEvery ?? 5;
  const maximum = options.maximum ?? 0;
  return {
    id,
    sourceId: id,
    definitionId: id,
    targetId: null,
    name,
    kind: "group",
    collective: false,
    hidden: false,
    forceVisible: false,
    defaultSelectionId: null,
    constraints: [{
      ...manualSelectionConstraint(constraintId, "max", "unit", maximum)
    }],
    modifiers: dynamicEvery ? [{
      type: "increment",
      field: constraintId,
      value: 1,
      conditions: [],
      conditionGroups: [],
      repeats: [{
        value: 5,
        repeats: 1,
        field: "selections",
        scope: "self",
        childId: "model",
        roundUp: false,
        includeChildSelections: true
      }],
      raw: { source: "manual-11e-wargear-options" }
    }] : [],
    profiles: [],
    rules: [],
    children
  };
}

function manualSelectionConstraint(id, type, scope, value) {
  return {
    id,
    type,
    field: "selections",
    scope,
    value,
    childId: null,
    includeChildSelections: false,
    includeChildForces: false,
    raw: { source: "manual-11e-wargear-options" }
  };
}

function manualOption(id, name, options = {}) {
  const profiles = Array.isArray(options)
    ? options.map(clone)
    : [
      ...(options.profiles || []).map(clone),
      ...(options.replaceProfiles || []).map(profile => ({ ...clone(profile), countMultiplier: -1 }))
    ];
  return {
    id,
    sourceId: id,
    definitionId: id,
    targetId: null,
    name,
    kind: "upgrade",
    collective: false,
    hidden: false,
    forceVisible: false,
    defaultSelectionId: null,
    constraints: [],
    modifiers: [],
    profiles,
    rules: [],
    children: [],
    replacesEquipment: Array.isArray(options) ? [] : [...(options.replacesEquipment || [])]
  };
}
