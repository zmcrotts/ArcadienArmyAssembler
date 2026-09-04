"use strict";

const fs = require("fs");
const ORKS_FACTION = "Xenos - Orks";
const normalize = value => String(value || "").normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const clone = value => JSON.parse(JSON.stringify(value));

function readOrksCodex(filePath) {
  if (!filePath) return { activeUnits: [], points: [], detachments: [], unitUpdates: [], issues: [] };
  if (!fs.existsSync(filePath)) {
    return { activeUnits: [], points: [], detachments: [], unitUpdates: [], issues: [{
      code: "orks-codex-missing", severity: "error",
      message: `Configured Orks codex source is missing: ${filePath}`, filePath
    }] };
  }
  try {
    return { ...JSON.parse(fs.readFileSync(filePath, "utf8")), issues: [] };
  } catch (error) {
    return { activeUnits: [], points: [], detachments: [], unitUpdates: [], issues: [{
      code: "orks-codex-invalid", severity: "error",
      message: `Configured Orks codex source could not be parsed: ${filePath}`,
      filePath, cause: error.message
    }] };
  }
}

function walk(node, visitor) {
  if (!node) return;
  visitor(node);
  for (const child of node.children || []) walk(child, visitor);
}

function patchUnit(unit, update, source) {
  const next = clone(unit);
  const removeSelections = new Set((update.removeSelectionNames || []).map(normalize));
  (function prune(node) {
    node.children = (node.children || []).filter(child => !removeSelections.has(normalize(child.name)));
    for (const child of node.children) prune(child);
  }(next.selectionTree));
  const remove = new Set((update.removeProfiles || []).map(normalize));
  const replacements = new Map((update.profiles || []).map(profile => [normalize(profile.name), profile]));
  const usedProfiles = new Set();
  let changed = 0;
  walk(next.selectionTree, node => {
    node.profiles = (node.profiles || [])
      .filter(profile => !remove.has(normalize(profile.name)))
      .map(profile => {
        const replacement = replacements.get(normalize(profile.name));
        if (!replacement || (replacement.typeName && normalize(replacement.typeName) !== normalize(profile.typeName))) return profile;
        usedProfiles.add(normalize(profile.name));
        changed += 1;
        return {
          ...profile, name: replacement.name,
          typeName: replacement.typeName || profile.typeName,
          characteristics: { ...(profile.characteristics || {}), ...(replacement.characteristics || {}) },
          source
        };
      });
  });
  for (const [key, replacement] of replacements) {
    if (usedProfiles.has(key)) continue;
    next.selectionTree.profiles = [...(next.selectionTree.profiles || []), {
      id: replacement.id || `orks-codex-${normalize(next.name).replace(/ /g, "-")}-${normalize(replacement.name).replace(/ /g, "-")}`,
      name: replacement.name, typeName: replacement.typeName || "Abilities",
      characteristics: { ...(replacement.characteristics || {}) }, source
    }];
    changed += 1;
  }
  const removeRules = new Set((update.removeRules || []).map(normalize));
  const rules = new Map((update.rules || []).map(rule => [normalize(rule.name), rule]));
  const usedRules = new Set();
  walk(next.selectionTree, node => {
    node.rules = (node.rules || [])
      .filter(rule => !removeRules.has(normalize(rule.name)))
      .map(rule => {
        const replacement = rules.get(normalize(rule.name));
        if (!replacement) return rule;
        usedRules.add(normalize(rule.name));
        changed += 1;
        return { ...rule, name: replacement.name, description: replacement.description, source };
      });
  });
  for (const [key, replacement] of rules) {
    if (usedRules.has(key)) continue;
    next.selectionTree.rules = [...(next.selectionTree.rules || []), {
      id: replacement.id || `orks-codex-rule-${normalize(next.name).replace(/ /g, "-")}-${normalize(replacement.name).replace(/ /g, "-")}`,
      name: replacement.name, description: replacement.description, source
    }];
    changed += 1;
  }
  if (update.keywords) next.keywords = update.keywords.slice();
  if (update.addKeywords) next.keywords = [...new Set([...(next.keywords || []), ...update.addKeywords])];
  if (update.rosterRules) next.rosterRules = { ...(next.rosterRules || {}), ...update.rosterRules };
  if (update.roles) next.roles = { ...(next.roles || {}), ...update.roles };
  if (update.composition && (update.replaceComposition || !(next.composition || []).length)) {
    const existingModels = new Map((next.composition || []).map(model => [normalize(model.name), model]));
    next.composition = update.composition.map(model => {
      const prior = existingModels.get(normalize(model.name));
      const id = prior?.id || `orks-codex-model-${normalize(next.name).replace(/ /g, "-")}-${normalize(model.name).replace(/ /g, "-")}`;
      return { ...(prior || {}), ...clone(model), id, definitionId: prior?.definitionId || id };
    });
  }
  if (update.unitSizePresets?.length) {
    next.unitSizePresets = update.unitSizePresets.map(({ size, label }) => ({ size, label }));
    next.allowedCompositions = update.unitSizePresets.map(preset => (preset.composition || []).map(part => {
      const model = (next.composition || []).find(item => normalize(item.name) === normalize(part.name));
      return { id: model?.id || normalize(part.name).replace(/ /g, "-"), count: Number(part.count) };
    }));
  }
  if (update.unitSizePresetsOnly?.length) {
    next.unitSizePresets = clone(update.unitSizePresetsOnly);
    next.allowedCompositions = [];
  }
  for (const option of update.addOptions || []) {
    if ((next.selectionTree.children || []).some(child => normalize(child.name) === normalize(option.name))) continue;
    next.selectionTree.children = [...(next.selectionTree.children || []), {
      id: `orks-codex-${normalize(next.name).replace(/ /g, "-")}-option-${normalize(option.name).replace(/ /g, "-")}`,
      definitionId: `orks-codex-option-${normalize(option.name).replace(/ /g, "-")}`,
      name: option.name,
      kind: option.kind || "upgrade",
      points: Number(option.points || 0),
      collective: Boolean(option.collective), hidden: false, forceVisible: true,
      constraints: [{ id: `orks-codex-${normalize(next.name).replace(/ /g, "-")}-${normalize(option.name).replace(/ /g, "-")}-max`, type: "max", field: "selections", scope: "parent", value: Number(option.maximum || 1), childId: null, includeChildSelections: false, includeChildForces: false, raw: { source: "orks-codex" } }],
      modifiers: [], profiles: [], categories: [], rules: [], children: [], source
    }];
  }
  return { unit: next, changed };
}

function makeAddedUnit(template, spec, source) {
  const next = clone(template);
  const slug = normalize(spec.name).replace(/ /g, "-");
  next.id = `orks-codex-${slug}`;
  next.selectionKey = `${String(template.selectionKey).split(":")[0]}:orks-codex-${slug}`;
  next.name = spec.name;
  next.rosterSelectable = true;
  next.sourceDisposition = "codex-current";
  next.categories = spec.categories || template.categories;
  next.keywords = spec.keywords || template.keywords;
  next.composition = spec.composition || [{ name: spec.name, minimum: 1, maximum: 1 }];
  next.compositionConstraints = [];
  next.selectionTree = {
    id: `${next.id}-root`, name: spec.name, kind: "unit", points: 0,
    constraints: [], modifiers: [], defaultEquipment: spec.defaultEquipment || [],
    profiles: [], rules: [], children: []
  };
  next.pricing = { basePoints: 0, mfmRows: [] };
  next.source = source;
  const patched = patchUnit(next, { ...spec, replaceComposition: true }, source).unit;
  const modelNodes = (patched.composition || []).map(model => ({
    id: model.id,
    definitionId: model.definitionId || model.id,
    name: model.name,
    kind: "model",
    points: 0,
    collective: true, hidden: false, forceVisible: true,
    constraints: [
      { id: `${model.id}-min`, type: "min", field: "selections", scope: "parent", value: Number(model.min || 0), childId: null, includeChildSelections: false, includeChildForces: false, raw: { source: "orks-codex" } },
      { id: `${model.id}-max`, type: "max", field: "selections", scope: "parent", value: Number(model.max || model.min || 0), childId: null, includeChildSelections: false, includeChildForces: false, raw: { source: "orks-codex" } }
    ],
    modifiers: [], profiles: [], categories: [], rules: [], children: [], source
  }));
  patched.selectionTree.children = [...modelNodes, ...(patched.selectionTree.children || [])];
  return patched;
}

function makeBoyzSelectionTree(id, profiles, rules, source) {
  const byName = name => profiles.find(profile => normalize(profile.name) === normalize(name));
  const selectedProfiles = (...names) => names.map(name => clone(byName(name))).filter(Boolean);
  const constraint = (nodeId, type, scope, value) => ({
    id: `${nodeId}-${type}`, type, field: "selections", scope, value,
    childId: null, includeChildSelections: false, includeChildForces: false,
    raw: { source: "orks-codex" }
  });
  const option = (nodeId, name, profileNames, maximum = 20) => ({
    id: nodeId, sourceId: nodeId, definitionId: nodeId, targetId: null,
    name, kind: "upgrade", points: 0, collective: false, hidden: false, forceVisible: true,
    defaultSelectionId: null, constraints: [constraint(nodeId, "max", "parent", maximum)],
    modifiers: [], profiles: selectedProfiles(...profileNames), rules: [], children: [], source
  });
  const fixedGroup = (nodeId, name, choices, defaultId) => ({
    id: nodeId, sourceId: nodeId, definitionId: nodeId, targetId: null,
    name, kind: "group", collective: false, hidden: false, forceVisible: true,
    defaultSelectionId: defaultId,
    constraints: [constraint(nodeId, "min", "parent", 1), constraint(nodeId, "max", "parent", 1)],
    modifiers: [], profiles: [], rules: [], children: choices, source
  });
  const boyId = `${id}-boy`;
  const nobId = `${id}-boss-nob`;
  const boyDefault = `${boyId}-standard`;
  const boyChoices = [
    option(boyDefault, "Choppa, shoota and slugga", ["Choppa", "Shoota", "Slugga"]),
    option(`${boyId}-big-shoota`, "Big Shoota", ["Choppa", "Big Shoota", "Slugga"], 2),
    option(`${boyId}-rokkit`, "Rokkit Launcha", ["Choppa", "➤ Rokkit Launcha - Blasta", "➤ Rokkit Launcha - Busta", "Slugga"], 2),
    option(`${boyId}-burna`, "Burna", ["Choppa", "Burna", "Slugga"], 2)
  ];
  for (const special of boyChoices.slice(1)) {
    const maxConstraint = special.constraints[0];
    maxConstraint.scope = "unit";
    maxConstraint.value = 0;
    special.modifiers = [{
      type: "increment", field: maxConstraint.id, value: 1,
      conditions: [], conditionGroups: [],
      repeats: [{ value: 10, repeats: 1, field: "selections", scope: "self", childId: "model", roundUp: false, includeChildSelections: true }],
      raw: { source: "orks-codex" }
    }];
  }
  const nobDefault = `${nobId}-kustom-kombi-skorcha`;
  const nobChoices = [
    option(nobDefault, "Kustom Choppa and Kombi-skorcha", ["Kustom Choppa", "➤ Kombi-skorcha - Shoota", "➤ Kombi-skorcha - Skorcha"], 2),
    option(`${nobId}-big-choppa`, "Big Choppa", ["Big Choppa"], 2),
    option(`${nobId}-power-klaw-skorcha`, "Power Klaw and Kombi-skorcha", ["Power Klaw", "➤ Kombi-skorcha - Shoota", "➤ Kombi-skorcha - Skorcha"], 2),
    option(`${nobId}-kustom-kombi-rokkit`, "Kustom Choppa and Kombi-rokkit", ["Kustom Choppa", "➤ Kombi-rokkit - Busta", "➤ Kombi-rokkit - Shoota"], 2),
    option(`${nobId}-power-klaw-kombi-rokkit`, "Power Klaw and Kombi-rokkit", ["Power Klaw", "➤ Kombi-rokkit - Busta", "➤ Kombi-rokkit - Shoota"], 2),
    option(`${nobId}-kustom-shoota`, "Kustom Choppa and Kustom Shoota", ["Kustom Choppa", "Kustom Shoota"], 2),
    option(`${nobId}-power-klaw-kustom-shoota`, "Power Klaw and Kustom Shoota", ["Power Klaw", "Kustom Shoota"], 2)
  ];
  const model = (nodeId, definitionId, name, min, max, unitProfile, children) => ({
    id: nodeId, sourceId: nodeId, definitionId, targetId: null, name, kind: "model", points: 0,
    collective: true, hidden: false, forceVisible: true, defaultSelectionId: null,
    constraints: [constraint(nodeId, "min", "parent", min), constraint(nodeId, "max", "parent", max)],
    modifiers: [], profiles: selectedProfiles(unitProfile), rules: [], children, source
  });
  return {
    id: `${id}-root`, name: "Boyz", kind: "unit", points: 0,
    constraints: [], modifiers: [], defaultEquipment: [],
    profiles: profiles.filter(profile => !["Unit", "Ranged Weapons", "Melee Weapons"].includes(profile.typeName)).map(clone),
    rules: rules.map(clone),
    children: [
      model(nobId, "orks-codex-boyz-model-boss-nob", "Boss Nob", 1, 2, "Boss Nob", [fixedGroup(`${nobId}-equipment`, "Boss Nob equipment", nobChoices, nobDefault)]),
      model(boyId, "orks-codex-boyz-model-boy", "Boy", 9, 18, "Boy", [fixedGroup(`${boyId}-equipment`, "Boy equipment", boyChoices, boyDefault)])
    ],
    source
  };
}

function makeNobzSelectionTree(id, profiles, rules, source) {
  const byName = name => profiles.find(profile => normalize(profile.name) === normalize(name));
  const selectedProfiles = (...names) => names.map(name => clone(byName(name))).filter(Boolean);
  const constraint = (nodeId, type, scope, value) => ({
    id: `${nodeId}-${type}`, type, field: "selections", scope, value,
    childId: null, includeChildSelections: false, includeChildForces: false,
    raw: { source: "orks-codex" }
  });
  const option = (nodeId, name, profileNames, limitedPerFive = false) => {
    const maxConstraint = constraint(nodeId, "max", limitedPerFive ? "unit" : "parent", limitedPerFive ? 0 : 1);
    return {
      id: nodeId, sourceId: nodeId, definitionId: nodeId, targetId: null,
      name, kind: "upgrade", points: 0, collective: false, hidden: false, forceVisible: true,
      preserveName: true,
      defaultSelectionId: null, constraints: [maxConstraint],
      modifiers: limitedPerFive ? [{
        type: "increment", field: maxConstraint.id, value: 1,
        conditions: [], conditionGroups: [],
        repeats: [{ value: 5, repeats: 1, field: "selections", scope: "self", childId: "model", roundUp: false, includeChildSelections: true }],
        raw: { source: "orks-codex" }
      }] : [],
      profiles: selectedProfiles(...profileNames), rules: [], children: [], source
    };
  };

  const modelId = `${id}-nob`;
  const defaultId = `${modelId}-kustom-krumpa-shoota`;
  const equipment = {
    id: `${modelId}-equipment`, sourceId: `${modelId}-equipment`, definitionId: `${modelId}-equipment`,
    targetId: null, name: "Nob equipment", kind: "group", collective: false,
    hidden: false, forceVisible: true, defaultSelectionId: defaultId,
    constraints: [
      constraint(`${modelId}-equipment`, "min", "parent", 1),
      constraint(`${modelId}-equipment`, "max", "parent", 1)
    ],
    modifiers: [], profiles: [], rules: [], source,
    children: [
      option(defaultId, "Kustom Krumpa and Kustom Shoota", ["Kustom Krumpa", "Kustom Shoota"]),
      option(`${modelId}-kombi-rokkit`, "Kustom Krumpa and Kombi-rokkit", ["Kustom Krumpa", "➤ Kombi-rokkit - Busta", "➤ Kombi-rokkit - Shoota"]),
      option(`${modelId}-big-skorcha`, "Big Skorcha and Kustom Choppa", ["Big Skorcha", "Kustom Choppa"], true),
      option(`${modelId}-kustom-big-shoota`, "Kustom Big Shoota and Kustom Choppa", ["Kustom Big Shoota", "Kustom Choppa"], true),
      option(`${modelId}-big-choppa`, "Big Choppa", ["Big Choppa"], true),
      option(`${modelId}-paired-krumpas`, "Paired krumpas", ["Paired Krumpas"], true)
    ]
  };

  return {
    id: `${id}-root`, name: "Nobz", kind: "unit", points: 0,
    constraints: [], modifiers: [], defaultEquipment: [],
    profiles: profiles.filter(profile => profile.typeName === "Abilities").map(clone),
    rules: rules.map(clone),
    children: [{
      id: modelId, sourceId: modelId, definitionId: "orks-codex-nobz-model-nob", targetId: null,
      name: "Nob", kind: "model", points: 0, collective: true, hidden: false, forceVisible: true,
      defaultSelectionId: null,
      constraints: [constraint(modelId, "min", "parent", 5), constraint(modelId, "max", "parent", 10)],
      modifiers: [], profiles: selectedProfiles("Nob"), categories: [], rules: [], children: [equipment], source
    }],
    source
  };
}

function makeWarbossSelectionTree(id, profiles, rules, source) {
  const constraint = (nodeId, type) => ({
    id: `${nodeId}-${type}`, type, field: "selections", scope: "parent", value: 1,
    childId: null, includeChildSelections: false, includeChildForces: false,
    raw: { source: "orks-codex" }
  });
  const selected = names => profiles.filter(profile => names.includes(profile.name)).map(clone);
  const group = (suffix, name, options) => {
    const groupId = `${id}-${suffix}`;
    const children = options.map(([slug, label, names]) => ({
      id: `${groupId}-${slug}`, sourceId: `${groupId}-${slug}`, definitionId: `${groupId}-${slug}`,
      name: label, kind: "upgrade", points: 0, collective: false, hidden: false, forceVisible: true,
      preserveName: true, defaultSelectionId: null,
      constraints: [constraint(`${groupId}-${slug}`, "max")],
      modifiers: [], profiles: selected(names), rules: [], children: [], source
    }));
    return {
      id: groupId, sourceId: groupId, definitionId: groupId, name, kind: "group",
      collective: false, hidden: false, forceVisible: true,
      defaultSelectionId: children[0].id,
      constraints: [constraint(groupId, "min"), constraint(groupId, "max")],
      modifiers: [], profiles: [], rules: [], children, source
    };
  };
  const modelId = "orks-codex-warboss-model-warboss";
  return {
    id: `${id}-root`, name: "Warboss", kind: "unit", points: 0,
    constraints: [], modifiers: [], defaultEquipment: [],
    profiles: profiles.filter(profile => profile.typeName === "Abilities").map(clone),
    rules: rules.map(clone), source,
    children: [{
      id: modelId, sourceId: modelId, definitionId: modelId, name: "Warboss", kind: "model",
      points: 0, collective: true, hidden: false, forceVisible: true, defaultSelectionId: null,
      constraints: [constraint(modelId, "min"), constraint(modelId, "max")],
      modifiers: [], profiles: selected(["Warboss"]), categories: [], rules: [], source,
      children: [
        group("melee", "Melee weapon", [
          ["choppa", "Kustom Choppa", ["Kustom Choppa"]],
          ["klaw", "Power Klaw", ["Power Klaw"]]
        ]),
        group("ranged", "Ranged weapon", [
          ["shoota", "Kustom Shoota", ["Kustom Shoota"]],
          ["rokkit", "Kombi-rokkit", ["➤ Kombi-rokkit - Busta Rokkit", "➤ Kombi-rokkit - Shoota"]],
          ["skorcha", "Kombi-skorcha", ["➤ Kombi-skorcha - Shoota", "➤ Kombi-skorcha - Skorcha"]]
        ])
      ]
    }]
  };
}

function makeReplacementUnit(base, spec, source, added = false) {
  const slug = normalize(spec.name).replace(/ /g, "-");
  const id = added ? `orks-codex-${slug}` : base.id;
  const selectionKey = added
    ? `${String(base.selectionKey).split(":")[0]}:orks-codex-${slug}`
    : base.selectionKey;
  const declaredComposition = (spec.composition || [{ name: spec.name, min: 1, max: 1, defaultCount: 1 }]).map(model => {
    const modelSlug = normalize(model.name).replace(/ /g, "-");
    const modelId = `orks-codex-${slug}-model-${modelSlug}`;
    return { ...clone(model), id: modelId, definitionId: modelId };
  });
  const profiles = (spec.profiles || []).map(profile => ({
    id: profile.id || `orks-codex-${slug}-${normalize(profile.name).replace(/ /g, "-")}`,
    name: profile.name,
    typeName: profile.typeName || "Abilities",
    characteristics: clone(profile.characteristics || {}),
    source
  }));
  const rules = (spec.rules || []).map(rule => ({
    id: rule.id || `orks-codex-rule-${slug}-${normalize(rule.name).replace(/ /g, "-")}`,
    name: rule.name,
    description: rule.description || "",
    source
  }));
  const modelNodes = declaredComposition.map(model => ({
    id: model.id,
    definitionId: model.definitionId,
    name: model.name,
    kind: "model",
    points: 0,
    collective: true,
    hidden: false,
    forceVisible: true,
    constraints: [
      { id: `${model.id}-min`, type: "min", field: "selections", scope: "parent", value: Number(model.min || 0), childId: null, includeChildSelections: false, includeChildForces: false, raw: { source: "orks-codex" } },
      { id: `${model.id}-max`, type: "max", field: "selections", scope: "parent", value: Number(model.max || model.min || 0), childId: null, includeChildSelections: false, includeChildForces: false, raw: { source: "orks-codex" } }
    ],
    modifiers: [], profiles: [], categories: [], rules: [], children: [], source
  }));
  const optionNodes = (spec.addOptions || []).map(option => ({
    id: `orks-codex-${slug}-option-${normalize(option.name).replace(/ /g, "-")}`,
    definitionId: `orks-codex-option-${normalize(option.name).replace(/ /g, "-")}`,
    name: option.name,
    kind: option.kind || "upgrade",
    points: Number(option.points || 0),
    collective: Boolean(option.collective), hidden: false, forceVisible: true,
    constraints: [{ id: `orks-codex-${slug}-${normalize(option.name).replace(/ /g, "-")}-max`, type: "max", field: "selections", scope: "parent", value: Number(option.maximum || 1), childId: null, includeChildSelections: false, includeChildForces: false, raw: { source: "orks-codex" } }],
    modifiers: [], profiles: [], categories: [], rules: [], children: [], source
  }));
  const keywords = [...new Set([...clone(spec.keywords || spec.categories || []), "Orks"])];
  const roles = {
    battleline: keywords.some(item => normalize(item) === "battleline"),
    dedicatedTransport: keywords.some(item => normalize(item) === "dedicated transport"),
    epicHero: keywords.some(item => normalize(item) === "epic hero"),
    character: keywords.some(item => normalize(item) === "character"),
    leader: false,
    support: false,
    ...(spec.roles || {})
  };
  const rosterRules = {
    canBeWarlord: roles.character,
    maxCopies: roles.epicHero ? 1 : (roles.battleline || roles.dedicatedTransport) ? 6 : 3,
    leaderTargetNames: [], leaderTargetSelectionKeys: [], leaderTargetPredicates: [],
    allowsAdditionalLeader: false, allowsMultipleLeadersAsBodyguard: false,
    ...(spec.rosterRules || {})
  };
  const presets = spec.unitSizePresetsOnly?.length
    ? clone(spec.unitSizePresetsOnly)
    : (spec.unitSizePresets || []).map(({ size, label }) => ({ size, label }));
  const allowedCompositions = spec.unitSizePresetsOnly?.length ? [] : (spec.unitSizePresets || []).map(preset =>
    (preset.composition || []).map(part => {
      const model = declaredComposition.find(item => normalize(item.name) === normalize(part.name));
      return { id: model?.id || normalize(part.name).replace(/ /g, "-"), count: Number(part.count) };
    })
  );
  const freshTree = {
    id: `${id}-root`, name: spec.name, kind: "unit", points: 0,
    constraints: [], modifiers: [], defaultEquipment: clone(spec.defaultEquipment || []),
    profiles: [], rules, children: [...modelNodes, ...optionNodes], source
  };

  // Existing catalogue trees are used only as a proven selection-tree scaffold.
  // Every gameplay profile and rule on that scaffold is discarded and replaced
  // by the current codex card below.
  let selectionTree = added || spec.replaceComposition ? freshTree : clone(base.selectionTree);
  const existingModels = [];
  walk(selectionTree, node => {
    if (node.kind === "model") existingModels.push(node);
  });
  if (!existingModels.length && declaredComposition.length === 1) {
    const model = modelNodes[0];
    model.children = selectionTree.children || [];
    selectionTree.children = [model];
  }
  const codexProfiles = profiles.map(profile => ({ ...profile, source }));
  const used = new Set();
  const profileBase = name => normalize(name)
    .replace(/^profile /, "")
    .split(/ (?:standard|hunter|aimed|point blank|dakka|kill shot|shoota|skorcha|blasta|busta|sweep|strike|shell|frag|ranged|melee)$/)[0];
  const compatible = (nodeName, profileName) => {
    const nodeKey = normalize(nodeName).replace(/^profile /, "");
    const profileKey = normalize(profileName).replace(/^profile /, "");
    const family = profileBase(profileName);
    return nodeKey === profileKey || nodeKey === family
      || nodeKey.includes(family) || family.includes(nodeKey);
  };
  walk(selectionTree, node => {
    const replacements = [];
    for (const oldProfile of node.profiles || []) {
      const replacement = codexProfiles.find(profile =>
        normalize(profile.typeName) === normalize(oldProfile.typeName)
        && (normalize(profile.name) === normalize(oldProfile.name)
          || compatible(node.name, profile.name))
      );
      if (!replacement) continue;
      replacements.push(replacement);
      used.add(replacement.id);
    }
    node.profiles = replacements;
    node.rules = [];
    node.source = source;
  });

  const selectedModels = [];
  walk(selectionTree, node => {
    if (node.kind === "model") selectedModels.push(node);
  });
  const firstModel = selectedModels[0];
  for (const profile of codexProfiles) {
    if (used.has(profile.id)) continue;
    if (profile.typeName === "Unit") {
      const targets = selectedModels.filter(node => compatible(node.name, profile.name));
      for (const target of targets.length ? targets : (firstModel ? [firstModel] : [])) target.profiles.push(profile);
      if (!firstModel) selectionTree.profiles.push(profile);
    } else if (/Weapons$/i.test(profile.typeName || "")) {
      const targets = [];
      walk(selectionTree, node => {
        if (!["unit", "group", "model"].includes(node.kind) && compatible(node.name, profile.name)) targets.push(node);
      });
      if (targets.length) for (const target of targets) target.profiles.push(profile);
      else if (added || spec.replaceComposition) {
        if (firstModel) firstModel.profiles.push(profile);
        else selectionTree.profiles.push(profile);
      } else {
        const optionId = `orks-codex-${slug}-card-option-${normalize(profile.name).replace(/ /g, "-")}`;
        selectionTree.children.push({
          id: optionId, sourceId: optionId, definitionId: optionId, targetId: null,
          name: profile.name.replace(/^\s*➤\s*/, "").split(/\s+-\s+/)[0], kind: "upgrade",
          points: 0, collective: false, hidden: false, forceVisible: true,
          defaultSelectionId: null,
          constraints: [{ id: `${optionId}-max`, type: "max", field: "selections", scope: "parent", value: 1, childId: null, includeChildSelections: false, includeChildForces: false, raw: { source: "orks-codex" } }],
          modifiers: [], profiles: [profile], categories: [], rules: [], children: [], source
        });
      }
    } else selectionTree.profiles.push(profile);
    used.add(profile.id);
  }
  selectionTree.rules = rules;

  // Fresh card-owned units have their fixed kit on the selected model. Explicit
  // priced/additional options stay selectable and do not leak into defaults.
  if (added || spec.replaceComposition) {
    const explicitOptions = new Set((spec.addOptions || []).map(option => normalize(option.name)));
    for (const model of modelNodes) {
      model.profiles = (model.profiles || []).filter(profile => {
        if (!/Weapons$/i.test(profile.typeName || "")) return true;
        const option = optionNodes.find(node => explicitOptions.has(normalize(node.name)) && compatible(node.name, profile.name));
        if (!option) return true;
        option.profiles.push(profile);
        return false;
      });
    }
  }
  if (spec.name === "Boyz") selectionTree = makeBoyzSelectionTree(id, profiles, rules, source);
  if (spec.name === "Nobz") selectionTree = makeNobzSelectionTree(id, profiles, rules, source);
  if (spec.name === "Warboss") selectionTree = makeWarbossSelectionTree(id, profiles, rules, source);
  (function cleanCodexTree(node) {
    for (const child of node.children || []) cleanCodexTree(child);
    node.children = (node.children || []).filter(child =>
      child.kind === "group"
        ? (child.children || []).length > 0
        : child.kind === "model"
          ? (child.profiles || []).length > 0 || (child.children || []).length > 0
          : (child.profiles || []).length > 0 || (child.rules || []).length > 0
            || (child.children || []).length > 0 || (child.replacesEquipment || []).length > 0
    );
    if (!node.preserveName && !["unit", "group", "model"].includes(node.kind) && (node.profiles || []).length) {
      const families = [...new Set(node.profiles.filter(profile => /Weapons$/i.test(profile.typeName || "")).map(profile =>
        profile.name.replace(/^\s*➤\s*/, "").split(/\s+-\s+/)[0]
      ))];
      if (families.length === 1) node.name = families[0];
    }
  }(selectionTree));
  const cardOwnedComposition = added || spec.replaceComposition || ["Boyz", "Nobz"].includes(spec.name);
  const composition = cardOwnedComposition ? declaredComposition : clone(base.composition || declaredComposition);
  const compositionConstraints = cardOwnedComposition ? [] : clone(base.compositionConstraints || []);
  return {
    schemaVersion: base.schemaVersion || 1,
    id,
    selectionKey,
    name: spec.name,
    faction: ORKS_FACTION,
    rosterSelectable: true,
    sourceDisposition: "codex-current",
    source: added ? { kind: "orks-codex", label: source } : { ...(base.source || {}), codex: source },
    categories: keywords.slice(),
    categoryIds: [],
    keywords,
    conditionalKeywords: [],
    roles,
    rosterRules,
    composition,
    compositionConstraints,
    unitSizePresets: presets,
    allowedCompositions,
    selectionTree,
    pricing: { base: 0, basePoints: 0, mfmRows: [] }
  };
}

function pointRow(value, source) {
  const match = String(value.label).match(/^(\d+)(?:\s+models?|\s+)/i);
  const compositionCount = (value.composition || []).reduce((sum, item) => sum + Number(item.count || 0), 0);
  const band = normalize(value.costBand);
  const copies = band === "your 1st unit costs" ? { min: 0, max: 0 }
    : band === "your 2nd unit costs" ? { min: 1, max: null }
    : band === "your 1st to 2nd units cost" ? { min: 0, max: 1 }
      : band === "your 3rd unit costs" ? { min: 2, max: null }
        : band === "your 1st to 3rd units cost" ? { min: 0, max: 2 }
          : band === "your 4th unit costs" ? { min: 3, max: null }
            : { min: 0, max: null };
  return {
    source,
    context: value.context || null,
    costBand: value.costBand || "YOUR UNIT COSTS",
    label: value.label,
    points: Number(value.points),
    copies: value.copies || copies,
    modelCount: value.modelCount ?? (compositionCount || (match ? Number(match[1]) : null)),
    composition: value.composition || null
  };
}

function matchesEligible(unit, eligible) {
  if (!eligible) {
    return Boolean(unit.roles?.character || (unit.keywords || []).some(item => normalize(item) === "character"));
  }
  const names = new Set((eligible.names || []).map(normalize));
  const keywords = new Set((unit.keywords || []).map(normalize));
  return names.has(normalize(unit.name))
    || Boolean(eligible.keywords?.length && eligible.keywords.every(keyword => keywords.has(normalize(keyword))));
}

function makeDetachment(item, dispositions, source, pointsSource, existingDetachments = []) {
  const slug = normalize(item.name).replace(/ /g, "-");
  const disposition = dispositions.find(entry => normalize(entry.name) === normalize(item.forceDisposition));
  const existing = existingDetachments.find(entry => normalize(entry.name) === normalize(item.name));
  return {
    id: existing?.id || `orks-codex-detachment-${slug}`,
    name: item.name,
    points: 0,
    detachmentPoints: Number(item.detachmentPoints),
    forceDisposition: disposition ? { id: disposition.id, name: disposition.name } : null,
    uniqueTags: [],
    rules: (item.rules || []).map((rule, index) => ({
      id: `orks-codex-${slug}-rule-${index + 1}`, ...rule, source
    })),
    stratagems: (item.stratagems || []).map((stratagem, index) => ({
      id: `orks-codex-${slug}-strat-${index + 1}`,
      type: `${item.name} Stratagem`,
      cpCost: String(stratagem.cpCost || 1),
      turn: "",
      phase: "",
      legend: "",
      detachment: item.name,
      factionId: "",
      scope: "detachment",
      sourceUrl: source,
      target: null,
      ...stratagem
    })),
    detachmentPointsSource: pointsSource,
    forceDispositionSource: pointsSource
  };
}

function applyOrksCodex(units, armies, document) {
  if (!document?.activeUnits?.length) {
    return { units, armies, issues: [...(document?.issues || [])], summary: { applied: false } };
  }
  const source = document.source || "Codex: Orks (2026 leak) + MFM v1.4";
  const updates = new Map((document.unitUpdates || []).map(item => [normalize(item.name), item]));
  const additions = new Map((document.addedUnits || []).map(item => [normalize(item.name), item]));
  const current = new Set([...updates.keys(), ...additions.keys()]);
  let changedProfiles = 0;
  let definitions = units.map(unit => {
    if (unit.faction !== ORKS_FACTION) return unit;
    const name = normalize(unit.name.replace(/\s*\[(?:legends|crucible)\]\s*$/i, ""));
    const crucible = /\[crucible\]/i.test(unit.name);
    const baseName = unit.name.replace(/\s*\[(?:legends|crucible)\]\s*$/i, "");
    let next = crucible ? {
      ...unit, rosterSelectable: false
    } : current.has(name) ? makeReplacementUnit(unit, updates.get(name) || additions.get(name), source) : {
      ...unit, name: `${baseName} [Legends]`, rosterSelectable: true, sourceDisposition: "legends"
    };
    if (current.has(name) && !crucible) changedProfiles += (updates.get(name)?.profiles || additions.get(name)?.profiles || []).length;
    return next;
  });

  const template = definitions.find(unit => unit.faction === ORKS_FACTION && unit.name === "Warboss");
  for (const spec of document.addedUnits || []) {
    if (definitions.some(unit => unit.faction === ORKS_FACTION && normalize(unit.name) === normalize(spec.name))) continue;
    definitions.push(makeReplacementUnit(template, spec, source, true));
  }

  definitions = definitions.map(unit => {
    if (unit.faction !== ORKS_FACTION || !unit.rosterRules?.leaderTargetNames?.length) return unit;
    const targetNames = new Set(unit.rosterRules.leaderTargetNames.map(normalize));
    const leaderTargetSelectionKeys = definitions
      .filter(candidate => candidate.faction === ORKS_FACTION && candidate.rosterSelectable && targetNames.has(normalize(candidate.name)))
      .map(candidate => candidate.selectionKey);
    return { ...unit, rosterRules: { ...unit.rosterRules, leaderTargetSelectionKeys } };
  });

  const points = new Map((document.points || []).map(item => [normalize(item.name), item]));
  definitions = definitions.map(unit => {
    if (unit.faction !== ORKS_FACTION || !unit.rosterSelectable) return unit;
    const schedule = points.get(normalize(unit.name.replace(/\s*\[legends\]\s*$/i, "")));
    if (!schedule) return unit;
    const rows = schedule.rows.map(value => pointRow(value, document.pointsSource || "mfm-1.4"));
    const sizes = [...new Map(rows.filter(row => row.modelCount).map(row => [row.modelCount, row])).values()];
    let next = { ...unit, pricing: { ...(unit.pricing || {}), mfmRows: rows } };
    if (sizes.length && ((next.composition || []).length === 1 || sizes.every(row => row.composition?.length))) {
      next = {
        ...next,
        unitSizePresets: sizes.map(row => ({ size: row.modelCount, label: row.label })),
        allowedCompositions: sizes.map(row => {
          if (row.composition?.length) return row.composition.map(part => {
            const model = (next.composition || []).find(item => normalize(item.name) === normalize(part.name));
            return { id: model?.id || normalize(part.name).replace(/ /g, "-"), count: Number(part.count) };
          });
          return [{ id: next.composition[0].id, count: row.modelCount }];
        })
      };
    }
    return next;
  });

  for (const charge of document.wargearPoints || []) {
    const unit = definitions.find(item => item.faction === ORKS_FACTION
      && item.rosterSelectable && normalize(item.name) === normalize(charge.unit));
    if (!unit) continue;
    walk(unit.selectionTree, node => {
      const candidate = normalize(node.name).replace(/s$/, "");
      const sought = normalize(charge.option).replace(/s$/, "");
      if (candidate === sought) {
        node.points = Number(charge.points);
        node.pointsSource = document.pointsSource || "mfm-1.4";
      }
    });
  }

  const activeOrks = definitions.filter(unit => unit.faction === ORKS_FACTION && unit.sourceDisposition === "codex-current");
  const selectableOrkKeys = definitions
    .filter(unit => unit.faction === ORKS_FACTION && unit.rosterSelectable)
    .map(unit => unit.selectionKey);
  const armyDefinitions = armies.map(army => {
    if (army.faction !== ORKS_FACTION) return army;
    const detachments = (document.detachments || []).map(item => makeDetachment(item, army.forceDispositions || [], source, document.pointsSource || source, army.detachments || []));
    const ids = new Map(detachments.map(item => [normalize(item.name), item.id]));
    const enhancements = [];
    for (const detachment of document.detachments || []) {
      for (const enhancement of detachment.enhancements || []) {
        const slug = `${normalize(detachment.name)}-${normalize(enhancement.name)}`.replace(/ /g, "-");
        const existingEnhancement = (army.enhancements || []).find(item => normalize(item.name.replace(/\s+\(Upgrade\)$/i, "")) === normalize(enhancement.name)
          && (item.detachmentIds || []).includes(ids.get(normalize(detachment.name))));
        enhancements.push({
          id: existingEnhancement?.id || `orks-codex-enhancement-${slug}`,
          name: enhancement.name,
          kind: enhancement.kind || "enhancement",
          maxSelections: Number(enhancement.maxSelections || (enhancement.kind === "upgrade" ? 3 : 1)),
          points: Number(enhancement.points),
          detachmentIds: [ids.get(normalize(detachment.name))],
          eligibleSelectionKeys: activeOrks.filter(unit => matchesEligible(unit, enhancement.eligible)).map(unit => unit.selectionKey),
          profiles: [{
            id: `orks-codex-enhancement-${slug}-ability`,
            name: enhancement.name,
            typeName: "Abilities",
            characteristics: { Description: enhancement.description || "" },
            source
          }],
          rules: [],
          source,
          pointsSource: document.pointsSource || "mfm-1.4"
        });
      }
    }
    return { ...army, allowedSelectionKeys: [...new Set([...(army.allowedSelectionKeys || []), ...selectableOrkKeys])], detachments, enhancements };
  });

  return {
    units: definitions,
    armies: armyDefinitions,
    issues: [...(document.issues || [])],
    summary: {
      applied: true,
      activeUnits: activeOrks.length,
      detachments: document.detachments.length,
      enhancements: document.detachments.reduce((count, item) => count + (item.enhancements || []).length, 0),
      changedProfiles
    }
  };
}

module.exports = { applyOrksCodex, readOrksCodex };
