"use strict";

const fs = require("fs");
const path = require("path");
const { XMLParser } = require("fast-xml-parser");
const { buildSelectionTree } = require("./selection-tree");
const { nativeImportedCatalogueLinks } = require("./catalogue-aliases");

const POINTS_FIELD_ID = "51b2-306e-1021-d207";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  isArray: name => [
    "selectionEntry", "selectionEntryGroup", "entryLink", "profile",
    "constraint", "cost", "modifier", "condition", "conditionGroup"
  ].includes(name)
});

const JSON_COLLECTION_KEYS = {
  catalogues: "catalogue",
  publications: "publication",
  costTypes: "costType",
  profileTypes: "profileType",
  categoryEntries: "categoryEntry",
  categoryLinks: "categoryLink",
  forceEntries: "forceEntry",
  selectionEntries: "selectionEntry",
  sharedSelectionEntries: "selectionEntry",
  selectionEntryGroups: "selectionEntryGroup",
  sharedSelectionEntryGroups: "selectionEntryGroup",
  entryLinks: "entryLink",
  catalogueLinks: "catalogueLink",
  infoLinks: "infoLink",
  profiles: "profile",
  sharedProfiles: "profile",
  rules: "rule",
  sharedRules: "rule",
  constraints: "constraint",
  costs: "cost",
  modifiers: "modifier",
  modifierGroups: "modifierGroup",
  conditions: "condition",
  conditionGroups: "conditionGroup",
  repeats: "repeat",
  characteristics: "characteristic"
};

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function normalizeBsdataJson(value) {
  if (Array.isArray(value)) return value.map(normalizeBsdataJson);
  if (!value || typeof value !== "object") return value;

  const normalized = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === "$text") {
      normalized["#text"] = child;
      continue;
    }
    const normalizedChild = normalizeBsdataJson(child);
    const itemKey = JSON_COLLECTION_KEYS[key];
    normalized[key] = itemKey && Array.isArray(normalizedChild)
      ? { [itemKey]: normalizedChild }
      : normalizedChild;
  }
  return normalized;
}

function numberOrNull(value) {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function directPoints(node) {
  const cost = asArray(node?.costs?.cost).find(item =>
    item.typeId === POINTS_FIELD_ID || String(item.name).toLowerCase() === "pts"
  );
  return numberOrNull(cost?.value);
}

function selectionLimits(node) {
  const constraints = asArray(node?.constraints?.constraint);
  const min = constraints.find(c => c.field === "selections" && c.type === "min");
  const max = constraints.find(c => c.field === "selections" && c.type === "max");
  const minimum = numberOrNull(min?.value);
  const maximum = numberOrNull(max?.value);
  return {
    min: minimum !== null && minimum < 0 ? null : minimum,
    max: maximum !== null && maximum < 0 ? null : maximum
  };
}

function conditionFromBsdata(condition) {
  const raw = { ...condition };
  const operator = condition?.type;
  const selectionId = condition?.childId || null;
  if (["instanceOf", "notInstanceOf"].includes(operator) && selectionId) {
    return {
      kind: "context-instance",
      targetId: selectionId,
      operator,
      scope: condition.scope || null,
      raw
    };
  }
  const supported = condition?.field === "selections"
    && Boolean(selectionId)
    && ["atLeast", "atMost", "equalTo", "notEqualTo", "greaterThan", "lessThan"].includes(operator)
    && numberOrNull(condition?.value) !== null;

  if (!supported) return { kind: "unsupported", raw };

  return {
    kind: "selection-count",
    selectionId,
    operator,
    value: Number(condition.value),
    scope: condition.scope || null,
    includeChildSelections: condition.includeChildSelections === "true",
    raw
  };
}

function conditionGroupFromBsdata(group) {
  const conditions = [
    ...asArray(group?.conditions?.condition).map(conditionFromBsdata),
    ...asArray(group?.conditionGroups?.conditionGroup).map(conditionGroupFromBsdata),
    ...asArray(group?.localConditionGroups).map(localConditionGroupFromBsdata)
  ];
  return {
    kind: String(group?.type || "and").toLowerCase() === "or" ? "any" : "all",
    conditions,
    rawType: group?.type || "and"
  };
}

function localConditionGroupFromBsdata(group) {
  const conditions = asArray(group?.conditions?.condition);
  const beforeSelf = conditions.some(condition => condition?.type === "before" && condition?.childId === "self");
  const instanceOf = conditions.find(condition => condition?.type === "instanceOf" && condition?.childId);
  const supported = beforeSelf
    && instanceOf
    && group?.field === "selections"
    && ["atLeast", "atMost", "equalTo", "notEqualTo", "greaterThan", "lessThan"].includes(group?.type)
    && numberOrNull(group?.value) !== null;

  if (!supported) {
    return {
      kind: "unsupported",
      reason: "localConditionGroups",
      raw: group
    };
  }

  return {
    kind: "roster-copy-count",
    targetId: instanceOf.childId,
    operator: group.type,
    value: Number(group.value),
    count: "previous",
    raw: group
  };
}

function modifierConditionTree(modifier) {
  const conditions = [
    ...asArray(modifier?.conditions?.condition).map(conditionFromBsdata),
    ...asArray(modifier?.conditionGroups?.conditionGroup).map(conditionGroupFromBsdata)
  ];
  return { kind: "all", conditions };
}

function treeIsSupported(tree) {
  if (!tree) return true;
  if (tree.kind === "unsupported") return false;
  if (tree.kind === "selection-count" || tree.kind === "context-instance" || tree.kind === "roster-copy-count") return true;
  return asArray(tree.conditions).every(treeIsSupported);
}

function directPointModifiers(node, source) {
  return asArray(node?.modifiers?.modifier)
    .filter(modifier => modifier.field === POINTS_FIELD_ID)
    .map((modifier, index) => {
      const when = modifierConditionTree(modifier);
      const operationSupported = ["set", "increment", "decrement", "multiply"].includes(modifier.type);
      return {
        id: modifier.id || `${source}-${index}`,
        operation: modifier.type || null,
        value: numberOrNull(modifier.value),
        when,
        supported: operationSupported && numberOrNull(modifier.value) !== null && treeIsSupported(when),
        source,
        raw: modifier
      };
    });
}

function directModels(unit, indexes) {
  const modelsById = new Map();
  const visitedGroups = new Set();

  function addModel(entry, source, link = null) {
    const entryLimits = selectionLimits(entry);
    const linkLimits = selectionLimits(link);
    const id = entry.id || link?.targetId || link?.id;
    if (!id) return;
    const candidate = {
      id,
      name: link?.name || entry.name || "Unnamed model",
      min: linkLimits.min ?? entryLimits.min,
      max: linkLimits.max ?? entryLimits.max,
      defaultCount: linkLimits.min ?? entryLimits.min,
      points: Number(directPoints(link) || 0) + Number(directPoints(entry) || 0),
      source
    };
    const existing = modelsById.get(id);
    if (!existing) modelsById.set(id, candidate);
    else {
      existing.min = existing.min ?? candidate.min;
      existing.max = Math.max(Number(existing.max || 0), Number(candidate.max || 0)) || null;
      existing.defaultCount = existing.defaultCount ?? candidate.defaultCount;
      existing.points = Math.max(existing.points, candidate.points);
    }
  }

  function visit(node, source = "nested-model") {
    if (!node || typeof node !== "object") return;

    for (const entry of [
      ...asArray(node?.selectionEntries?.selectionEntry),
      ...asArray(node?.sharedSelectionEntries?.selectionEntry)
    ]) {
      if (entry.type === "model") addModel(entry, source);
      visit(entry, "nested-model");
    }

    for (const group of [
      ...asArray(node?.selectionEntryGroups?.selectionEntryGroup),
      ...asArray(node?.sharedSelectionEntryGroups?.selectionEntryGroup)
    ]) {
      visit(group, "model-group");
    }

    for (const link of asArray(node?.entryLinks?.entryLink)) {
      if (link.type === "selectionEntry") {
        const target = indexes.entries.get(link.targetId);
        if (!target) continue;
        if (target.type === "model") addModel(target, "linked-model", link);
        visit(target, "linked-model");
      } else if (link.type === "selectionEntryGroup") {
        const group = indexes.groups.get(link.targetId);
        if (!group || visitedGroups.has(group.id)) continue;
        visitedGroups.add(group.id);
        visit(group, "linked-model-group");
      }
    }
  }

  visit(unit, "direct-model");
  const models = [...modelsById.values()];

  if (models.length === 0 && isRosterUnit(unit)) {
    const limits = selectionLimits(unit);
    models.push({
      id: unit.id,
      name: unit.name || "Unnamed model",
      min: limits.min ?? 1,
      max: limits.max ?? 1,
      defaultCount: limits.min ?? 1,
      points: 0,
      source: "self-model"
    });
  }

  return models;
}

function compositionConstraints(unit, indexes) {
  const constraints = [];
  const seenConstraints = new Set();

  function hasImmediateModelMember(node) {
    if (!node || typeof node !== "object") return false;
    if (asArray(node?.selectionEntries?.selectionEntry).some(entry => entry.type === "model")) return true;
    return asArray(node?.entryLinks?.entryLink).some(link =>
      link.type === "selectionEntry" && indexes.entries.get(link.targetId)?.type === "model"
    );
  }

  function modelIdsIn(node, visitedGroups = new Set()) {
    const ids = new Set();
    if (!node || typeof node !== "object") return ids;

    for (const entry of [
      ...asArray(node?.selectionEntries?.selectionEntry),
      ...asArray(node?.sharedSelectionEntries?.selectionEntry)
    ]) {
      if (entry.type === "model" && entry.id) ids.add(entry.id);
      for (const id of modelIdsIn(entry, visitedGroups)) ids.add(id);
    }
    for (const group of [
      ...asArray(node?.selectionEntryGroups?.selectionEntryGroup),
      ...asArray(node?.sharedSelectionEntryGroups?.selectionEntryGroup)
    ]) {
      for (const id of modelIdsIn(group, visitedGroups)) ids.add(id);
    }
    for (const link of asArray(node?.entryLinks?.entryLink)) {
      if (link.type === "selectionEntry") {
        const target = indexes.entries.get(link.targetId);
        if (target?.type === "model" && target.id) ids.add(target.id);
        for (const id of modelIdsIn(target, visitedGroups)) ids.add(id);
      } else if (link.type === "selectionEntryGroup") {
        const group = indexes.groups.get(link.targetId);
        if (!group || visitedGroups.has(group.id)) continue;
        visitedGroups.add(group.id);
        for (const id of modelIdsIn(group, visitedGroups)) ids.add(id);
      }
    }
    return ids;
  }

  function visitGroups(container) {
    for (const group of asArray(container?.selectionEntryGroup)) {
      const memberIds = [...modelIdsIn(group)];
      const limits = selectionLimits(group);
      if (group.id && !seenConstraints.has(group.id) && hasImmediateModelMember(group) && memberIds.length && (limits.min !== null || limits.max !== null)) {
        seenConstraints.add(group.id);
        constraints.push({
          id: group.id,
          name: group.name || "Model group",
          selectionIds: memberIds,
          min: limits.min,
          max: limits.max
        });
      }
      visitGroups(group?.selectionEntryGroups);
      for (const link of asArray(group?.entryLinks?.entryLink)) {
        if (link.type !== "selectionEntryGroup") continue;
        const linked = indexes.groups.get(link.targetId);
        if (linked) visitGroups({ selectionEntryGroup: [linked] });
      }
    }
  }

  visitGroups(unit?.selectionEntryGroups);
  for (const entry of asArray(unit?.selectionEntries?.selectionEntry)) {
    visitGroups(entry?.selectionEntryGroups);
  }
  return constraints;
}

function collectIndexes(node, entries, groups, profiles, rules) {
  if (!node || typeof node !== "object") return;

  for (const entry of asArray(node?.selectionEntries?.selectionEntry)) {
    if (entry.id) entries.set(entry.id, entry);
    collectIndexes(entry, entries, groups, profiles, rules);
  }
  for (const entry of asArray(node?.sharedSelectionEntries?.selectionEntry)) {
    if (entry.id) entries.set(entry.id, entry);
    collectIndexes(entry, entries, groups, profiles, rules);
  }
  for (const group of asArray(node?.selectionEntryGroups?.selectionEntryGroup)) {
    if (group.id) groups.set(group.id, group);
    collectIndexes(group, entries, groups, profiles, rules);
  }
  for (const group of asArray(node?.sharedSelectionEntryGroups?.selectionEntryGroup)) {
    if (group.id) groups.set(group.id, group);
    collectIndexes(group, entries, groups, profiles, rules);
  }
  for (const profile of [
    ...asArray(node?.profiles?.profile),
    ...asArray(node?.sharedProfiles?.profile)
  ]) {
    if (profile.id) profiles.set(profile.id, profile);
  }
  for (const rule of [
    ...asArray(node?.rules?.rule),
    ...asArray(node?.sharedRules?.rule)
  ]) {
    if (rule.id) rules.set(rule.id, rule);
  }
}

function hasUnitProfile(entry) {
  return asArray(entry?.profiles?.profile).some(profile =>
    profile.typeName === "Unit" || profile.typeId === "c547-1836-d8a-ff4f"
  );
}

function isCrucibleSelection(...nodes) {
  return nodes.some(node => /\[crucible\]/i.test(String(node?.name || "")));
}

function isRosterUnit(entry) {
  return !isCrucibleSelection(entry) && (entry?.type === "unit" || entry?.type === "model" || hasUnitProfile(entry));
}

function categoryNames(...nodes) {
  return [...new Set(nodes.flatMap(node => asArray(node?.categoryLinks?.categoryLink))
    .filter(link => link.hidden !== "true")
    .map(link => link.name)
    .filter(Boolean))];
}

function hasEntryLinkNamed(name, ...nodes) {
  const wanted = String(name).trim().toLowerCase();
  return nodes.some(node => asArray(node?.entryLinks?.entryLink).some(link =>
    link.hidden !== "true" && String(link.name || "").trim().toLowerCase() === wanted
  ));
}

function descriptionText(characteristics) {
  const description = asArray(characteristics?.characteristic)
    .find(item => String(item.name || "").toLowerCase() === "description");
  return String(description?.["#text"] ?? description ?? "")
    .replace(/\^\^|\*\*/g, "")
    .replace(/\r/g, "");
}

function profileDescriptions(unit, indexes, profileName = null) {
  const descriptions = [];
  const visited = new Set();
  function visit(node) {
    if (!node || visited.has(node.id)) return;
    if (node.id) visited.add(node.id);
    for (const profile of asArray(node?.profiles?.profile)) {
      if (profileName && String(profile.name || "").toLowerCase() !== profileName.toLowerCase()) continue;
      const text = descriptionText(profile.characteristics);
      if (text) descriptions.push(text);
    }
    for (const entry of asArray(node?.selectionEntries?.selectionEntry)) visit(entry);
    for (const group of asArray(node?.selectionEntryGroups?.selectionEntryGroup)) visit(group);
    for (const link of asArray(node?.entryLinks?.entryLink)) {
      visit(link.type === "selectionEntryGroup" ? indexes.groups.get(link.targetId) : indexes.entries.get(link.targetId));
    }
  }
  visit(unit);
  return descriptions;
}

function leaderTargetNames(unit, indexes) {
  const names = [];
  for (const text of profileDescriptions(unit, indexes, "Leader")) {
    const leadingText = text.replace(/\u00a0/g, " ");
    const listOnly = leadingText.replace(/\n+\s*You can attach[\s\S]*/i, "");
    const body = listOnly.includes(":") ? listOnly.slice(listOnly.indexOf(":") + 1) : listOnly;
    for (const part of body.split(/\n|,|;/)) {
      const value = part.replace(/^[-■•*_]\s*/, "").replace(/[.;*_]\s*$/, "").trim();
      if (!value || /^(you can|you must|at the start|if it does|until the end|this model)/i.test(value)) continue;
      if (/cannot be attached|bodyguard unit|leader units attached/i.test(value)) continue;
      if (/already\s*(?:been\s*)?attached|original starting strengths?|^if you do$/i.test(value)) continue;
      names.push(value);
    }
  }
  return [...new Set(names)];
}

function allowsAdditionalLeader(unit, indexes) {
  return profileDescriptions(unit, indexes, "Leader").some(text =>
    /even\s+if[\s\S]{0,120}already\s*(?:been\s*)?attached/i.test(text)
    || /one\s+or\s+more[\s\S]{0,80}already\s*(?:been\s*)?attached/i.test(text)
    || /up\s+to\s+two\s+leader\s+units/i.test(text)
  );
}

function allowsMultipleLeadersAsBodyguard(unit, indexes) {
  return profileDescriptions(unit, indexes).some(text =>
    /up\s+to\s+two\s+leader\s+units/i.test(text)
    || /one\s+or\s+more[\s\S]{0,80}(?:leader|character)[\s\S]{0,80}already\s*(?:been\s*)?attached/i.test(text)
  );
}

function loadCatalogues(dataDirectory) {
  const files = fs.readdirSync(dataDirectory);
  const xmlCatalogues = files.filter(file => file.endsWith(".cat"));
  const jsonCatalogues = files.filter(file => file.endsWith(".json"));
  const catalogueFiles = xmlCatalogues.length ? xmlCatalogues : jsonCatalogues;
  return catalogueFiles
    .sort()
    .map(file => {
      const fullPath = path.join(dataDirectory, file);
      if (file.endsWith(".json")) {
        const json = normalizeBsdataJson(JSON.parse(fs.readFileSync(fullPath, "utf8")));
        return json.catalogue ? { file, catalogue: json.catalogue } : null;
      }
      const xml = parser.parse(fs.readFileSync(fullPath, "utf8"));
      return { file, catalogue: xml.catalogue };
    })
    .filter(Boolean);
}

function loadGameSystem(dataDirectory) {
  const files = fs.readdirSync(dataDirectory);
  const file = files.find(item => item.endsWith(".gst"))
    || files.find(item => item.endsWith(".json") && /warhammer 40,?000/i.test(item));
  if (!file) return null;
  if (file.endsWith(".json")) {
    const json = normalizeBsdataJson(JSON.parse(fs.readFileSync(path.join(dataDirectory, file), "utf8")));
    return json.gameSystem || null;
  }
  const xml = parser.parse(fs.readFileSync(path.join(dataDirectory, file), "utf8"));
  return xml.gameSystem || null;
}

function loadBsdataContext(dataDirectory) {
  const catalogues = loadCatalogues(dataDirectory);
  const indexes = {
    entries: new Map(),
    groups: new Map(),
    profiles: new Map(),
    rules: new Map()
  };
  const gameSystem = loadGameSystem(dataDirectory);
  if (gameSystem) collectIndexes(gameSystem, indexes.entries, indexes.groups, indexes.profiles, indexes.rules);
  for (const { catalogue } of catalogues) {
    collectIndexes(catalogue, indexes.entries, indexes.groups, indexes.profiles, indexes.rules);
  }
  return { catalogues, gameSystem, indexes };
}

function buildCatalogueLookup(catalogues) {
  const byId = new Map();
  const byName = new Map();
  for (const item of catalogues) {
    if (item.catalogue.id) byId.set(item.catalogue.id, item);
    if (item.catalogue.name) byName.set(item.catalogue.name, item);
  }
  return { byId, byName };
}

function nativeUnitLinksFor(catalogueItem, lookup) {
  const owner = catalogueItem.catalogue;
  const ownerId = owner.id || owner.name;
  const links = asArray(owner?.entryLinks?.entryLink).map(link => ({
    file: catalogueItem.file,
    faction: owner.name || path.basename(catalogueItem.file, ".cat"),
    selectionCatalogueId: ownerId,
    sourceCatalogueId: owner.id || null,
    sourceFaction: owner.name || null,
    link
  }));

  for (const catalogueLink of nativeImportedCatalogueLinks(owner)) {
    const imported = lookup.byId.get(catalogueLink.targetId) || lookup.byName.get(catalogueLink.name);
    if (!imported) continue;
    for (const link of asArray(imported.catalogue?.entryLinks?.entryLink)) {
      links.push({
        file: imported.file,
        faction: owner.name || path.basename(catalogueItem.file, ".cat"),
        selectionCatalogueId: ownerId,
        sourceCatalogueId: imported.catalogue.id || null,
        sourceFaction: imported.catalogue.name || null,
        link
      });
    }
  }

  return links;
}

function extractUnitDefinitions(dataDirectory) {
  const { catalogues, indexes } = loadBsdataContext(dataDirectory);
  const catalogueLookup = buildCatalogueLookup(catalogues);

  const definitions = [];
  const unresolved = [];

  for (const catalogueItem of catalogues) {
    for (const linkContext of nativeUnitLinksFor(catalogueItem, catalogueLookup)) {
      const { file, faction, link, selectionCatalogueId, sourceCatalogueId, sourceFaction } = linkContext;
      if (link.type !== "selectionEntry" || link.hidden === "true") continue;
      const unit = indexes.entries.get(link.targetId);
      if (isCrucibleSelection(link, unit)) continue;
      if (!unit) {
        unresolved.push({ faction, sourceFile: file, linkId: link.id, targetId: link.targetId, name: link.name });
        continue;
      }
      if (!isRosterUnit(unit)) continue;

      const linkPoints = directPoints(link);
      const unitPoints = directPoints(unit);
      const base = Number(linkPoints || 0) + Number(unitPoints || 0);
      const composition = directModels(unit, indexes);
      const modifiers = [
        ...directPointModifiers(unit, "bsdata-unit"),
        ...directPointModifiers(link, "bsdata-faction-link")
      ];
      if (unit.type === "model" && !hasUsableRosterPoints(base, composition, modifiers)) continue;
      const categories = categoryNames(unit, link);
      const hasCategory = name => categories.some(item => item.toLowerCase() === name.toLowerCase());
      const epicHero = hasCategory("Epic Hero");
      const battleline = hasCategory("Battleline");
      const dedicatedTransport = hasCategory("Dedicated Transport");
      const support = hasCategory("Support");

      const leaderTargets = leaderTargetNames(unit, indexes);
      const selectionTree = buildSelectionTree(unit, indexes, link);
      if (!/black templars/i.test(faction)) removeRulesNamed(selectionTree, "Templar Vows");

      definitions.push({
        schemaVersion: 1,
        id: unit.id,
        selectionKey: `${selectionCatalogueId || faction}:${link.id}`,
        name: link.name || unit.name,
        faction,
        source: {
          catalogueId: sourceCatalogueId,
          sourceFile: file,
          importedAsFaction: sourceFaction && sourceFaction !== faction ? faction : null,
          importedFromFaction: sourceFaction && sourceFaction !== faction ? sourceFaction : null,
          linkId: link.id || null,
          targetId: link.targetId || null
        },
        categories,
        keywords: categories,
        roles: {
          battleline,
          dedicatedTransport,
          epicHero,
          character: hasCategory("Character"),
          leader: leaderTargets.length > 0,
          support
        },
        rosterRules: {
          canBeWarlord: hasEntryLinkNamed("Warlord", unit, link),
          maxCopies: epicHero ? 1 : (battleline || dedicatedTransport) ? 6 : 3,
          leaderTargetNames: leaderTargets,
          leaderTargetSelectionKeys: [],
          allowsAdditionalLeader: allowsAdditionalLeader(unit, indexes),
          allowsMultipleLeadersAsBodyguard: allowsMultipleLeadersAsBodyguard(unit, indexes)
        },
        composition,
        compositionConstraints: compositionConstraints(unit, indexes),
        selectionTree,
        pricing: {
          base,
          baseSource: linkPoints !== null && unitPoints !== null
            ? "bsdata-unit+faction-link"
            : linkPoints !== null ? "bsdata-faction-link" : "bsdata-unit",
          unitBase: unitPoints,
          linkBase: linkPoints,
          modifiers
        }
      });
    }
  }


  const normalizeName = value => String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  for (const definition of definitions) {
    const targets = new Set((definition.rosterRules.leaderTargetNames || []).map(normalizeName));
    definition.rosterRules.leaderTargetSelectionKeys = definitions
      .filter(candidate => candidate.faction === definition.faction && targets.has(normalizeName(candidate.name)))
      .map(candidate => candidate.selectionKey);
  }

  return { definitions, unresolved };
}

function removeRulesNamed(node, name) {
  if (!node || typeof node !== "object") return;
  const normalized = String(name || "").trim().toLowerCase();
  node.rules = asArray(node.rules).filter(rule => String(rule?.name || "").trim().toLowerCase() !== normalized);
  for (const child of asArray(node.children)) removeRulesNamed(child, name);
}

function hasUsableRosterPoints(base, composition, modifiers) {
  if (Number(base || 0) > 0) return true;
  if (asArray(composition).some(item => Number(item?.points || 0) > 0)) return true;
  return asArray(modifiers).some(item =>
    item.supported !== false
    && ["set", "increment"].includes(item.operation)
    && Number(item.value || 0) > 0
  );
}

module.exports = {
  POINTS_FIELD_ID,
  asArray,
  buildCatalogueLookup,
  directPoints,
  isRosterUnit,
  loadBsdataContext,
  nativeUnitLinksFor,
  normalizeBsdataJson,
  extractUnitDefinitions
};
