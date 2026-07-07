"use strict";

const path = require("path");
const {
  asArray,
  buildCatalogueLookup,
  directPoints,
  isRosterUnit,
  loadBsdataContext,
  nativeUnitLinksFor
} = require("./unit-definitions");

const DETACHMENT_NAME_EXCLUSIONS_BY_FACTION = {
  "Xenos - Tyranids": new Set([
    "Final Day",
    "Heroes of the Uprising",
    "Purestrain Broodswarm",
    "Xenocult Masses"
  ])
};

function textValue(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "object" && "#text" in value) return String(value["#text"] || "");
  return String(value);
}

function normalizeProfile(profile) {
  return {
    id: profile.id || null,
    name: profile.name || "Unnamed profile",
    typeId: profile.typeId || null,
    typeName: profile.typeName || null,
    characteristics: Object.fromEntries(asArray(profile?.characteristics?.characteristic).map(item => [
      item.name || item.typeId,
      textValue(item)
    ]))
  };
}

function directCostByName(node, pattern) {
  const cost = asArray(node?.costs?.cost).find(item => pattern.test(item.name || ""));
  const number = Number(cost?.value);
  return Number.isFinite(number) ? number : null;
}

function costTypeIdByName(gameSystem, pattern) {
  return asArray(gameSystem?.costTypes?.costType).find(item => pattern.test(item.name || ""))?.id || null;
}

function modifiedCostByTypeId(node, costTypeId, catalogueId) {
  if (!costTypeId) return null;
  const modifier = asArray(node?.modifiers?.modifier).find(item =>
    item.type === "set"
    && item.field === costTypeId
    && modifierAppliesToCatalogue(item, catalogueId)
  );
  const number = Number(modifier?.value);
  return Number.isFinite(number) ? number : null;
}

function detachmentPointsFor(entry, gameSystem, catalogueId) {
  return directCostByName(entry, /detachment points/i)
    ?? modifiedCostByTypeId(entry, costTypeIdByName(gameSystem, /detachment points/i), catalogueId)
    ?? 0;
}

function isDetachmentRootName(name) {
  return /^detachments?$|^detachment choice$/i.test(String(name || "").trim());
}

function rulesFor(node, indexes) {
  const rules = asArray(node?.rules?.rule).map(rule => ({
    id: rule.id || null,
    name: rule.name || "Unnamed rule",
    description: textValue(rule.description)
  })).filter(rule => rule.name && rule.description);
  for (const link of asArray(node?.infoLinks?.infoLink)) {
    if (link.type !== "rule") continue;
    const rule = indexes.rules.get(link.targetId);
    rules.push({
      id: link.targetId || rule?.id || null,
      name: link.name || rule?.name || "Unnamed rule",
      description: textValue(rule?.description)
    });
  }
  return rules;
}

function catalogueArmyRules(catalogue, indexes) {
  return rulesFor(catalogue, indexes).filter(rule => !/^boarding actions$/i.test(rule.name));
}

function visitResolved(node, indexes, visitor, ancestry = new Set()) {
  if (!node || typeof node !== "object") return;
  const key = node.id || null;
  if (key && ancestry.has(key)) return;
  const next = new Set(ancestry);
  if (key) next.add(key);
  visitor(node);

  for (const entry of asArray(node?.selectionEntries?.selectionEntry)) {
    visitResolved(entry, indexes, visitor, next);
  }
  for (const group of asArray(node?.selectionEntryGroups?.selectionEntryGroup)) {
    visitResolved(group, indexes, visitor, next);
  }
  for (const link of asArray(node?.entryLinks?.entryLink)) {
    const target = link.type === "selectionEntryGroup"
      ? indexes.groups.get(link.targetId)
      : indexes.entries.get(link.targetId);
    if (target) visitResolved(target, indexes, visitor, next);
  }
}

function findNamedGroups(catalogue, name) {
  const matches = [];
  const wanted = name.toLowerCase();
  function visit(node) {
    if (!node || typeof node !== "object") return;
    for (const group of [
      ...asArray(node?.selectionEntryGroups?.selectionEntryGroup),
      ...asArray(node?.sharedSelectionEntryGroups?.selectionEntryGroup)
    ]) {
      if (String(group.name || "").trim().toLowerCase() === wanted) matches.push(group);
      visit(group);
    }
    for (const entry of [
      ...asArray(node?.selectionEntries?.selectionEntry),
      ...asArray(node?.sharedSelectionEntries?.selectionEntry)
    ]) visit(entry);
  }
  visit(catalogue);
  return matches;
}

function findDetachmentUpgradeGroups(catalogue, detachmentIds) {
  const matches = [];
  function visit(node) {
    if (!node || typeof node !== "object") return;
    for (const group of [
      ...asArray(node?.selectionEntryGroups?.selectionEntryGroup),
      ...asArray(node?.sharedSelectionEntryGroups?.selectionEntryGroup)
    ]) {
      const name = String(group.name || "").trim();
      if (/upgrades?$/i.test(name) && referencedIds(group, detachmentIds).length) matches.push(group);
      visit(group);
    }
    for (const entry of [
      ...asArray(node?.selectionEntries?.selectionEntry),
      ...asArray(node?.sharedSelectionEntries?.selectionEntry)
    ]) visit(entry);
  }
  visit(catalogue);
  return matches;
}

function referencedIds(node, candidates) {
  const found = new Set();
  function visit(value) {
    if (!value || typeof value !== "object") return;
    if (value.childId && candidates.has(value.childId)) found.add(value.childId);
    for (const child of Object.values(value)) {
      if (Array.isArray(child)) child.forEach(visit);
      else if (child && typeof child === "object") visit(child);
    }
  }
  visit(node?.modifiers);
  visit(node?.modifierGroups);
  return [...found];
}

function rawConditionApplies(condition, catalogueId) {
  if (condition?.type === "instanceOf") return condition.childId === catalogueId;
  if (condition?.type === "notInstanceOf") return condition.childId !== catalogueId;
  return false;
}

function rawConditionGroupApplies(group, catalogueId) {
  const values = [
    ...asArray(group?.conditions?.condition).map(item => rawConditionApplies(item, catalogueId)),
    ...asArray(group?.conditionGroups?.conditionGroup).map(item => rawConditionGroupApplies(item, catalogueId))
  ];
  return String(group?.type || "and").toLowerCase() === "or" ? values.some(Boolean) : values.every(Boolean);
}

function modifierAppliesToCatalogue(modifier, catalogueId) {
  const conditions = asArray(modifier?.conditions?.condition);
  const groups = asArray(modifier?.conditionGroups?.conditionGroup);
  if (![...conditions, ...groups].length) return true;
  return conditions.every(item => rawConditionApplies(item, catalogueId))
    && groups.every(item => rawConditionGroupApplies(item, catalogueId));
}

function hiddenForCatalogue(entry, catalogueId) {
  let hidden = entry.hidden === "true";
  for (const modifier of asArray(entry?.modifiers?.modifier)) {
    if (modifier.type === "set" && modifier.field === "hidden" && modifierAppliesToCatalogue(modifier, catalogueId)) {
      hidden = String(modifier.value).toLowerCase() === "true";
    }
  }
  return hidden;
}

function enhancementGroupIdsIn(unit, indexes) {
  const ids = new Set();
  visitResolved(unit, indexes, node => {
    for (const link of asArray(node?.entryLinks?.entryLink)) {
      if (link.type !== "selectionEntryGroup") continue;
      const group = indexes.groups.get(link.targetId);
      const name = String(link.name || group?.name || "").trim().toLowerCase();
      if (["enhancements", "enhancements - upgrades", "upgrades"].includes(name)) {
        ids.add(link.targetId);
      }
    }
  });
  return ids;
}

function maxSelectionsFor(entry) {
  const constraints = asArray(entry?.constraints?.constraint)
    .filter(item => item.type === "max" && ["force", "roster"].includes(item.scope));
  const values = constraints.map(item => Number(item.value)).filter(Number.isFinite);
  return values.length ? Math.max(...values) : 1;
}

function rootInstanceIdsFor(unit) {
  return new Set([
    unit.id,
    ...asArray(unit?.categoryLinks?.categoryLink).map(link => link.targetId).filter(Boolean)
  ].filter(Boolean));
}

function requiredRootInstanceIds(entry) {
  const ids = new Set();

  function visitCondition(condition) {
    if (condition?.type === "notInstanceOf" && ["root-entry", "ancestor"].includes(condition.scope) && condition.childId) {
      ids.add(condition.childId);
    }
  }

  function visitConditionGroup(group) {
    for (const condition of asArray(group?.conditions?.condition)) visitCondition(condition);
    for (const child of asArray(group?.conditionGroups?.conditionGroup)) visitConditionGroup(child);
  }

  for (const modifier of asArray(entry?.modifiers?.modifier)) {
    if (modifier.type !== "set" || modifier.field !== "hidden" || String(modifier.value).toLowerCase() !== "true") continue;
    for (const condition of asArray(modifier?.conditions?.condition)) visitCondition(condition);
    for (const group of asArray(modifier?.conditionGroups?.conditionGroup)) visitConditionGroup(group);
  }

  return ids;
}

function eligibleKeysForEntry(entry, eligibleUnits, options = {}) {
  const required = requiredRootInstanceIds(entry);
  if (!required.size) return eligibleUnits.map(item => item.selectionKey);
  const match = options.match || "any";
  return eligibleUnits
    .filter(item => match === "all"
      ? [...required].every(id => item.rootInstanceIds.has(id))
      : [...required].some(id => item.rootInstanceIds.has(id)))
    .map(item => item.selectionKey);
}

function enhancementEntriesIn(group, indexes, detachmentIds, inherited = [], ancestry = new Set(), sourceGroup = null) {
  if (!group || ancestry.has(group.id)) return [];
  const nextAncestry = new Set(ancestry);
  if (group.id) nextAncestry.add(group.id);
  const ownIds = [...new Set([...inherited, ...referencedIds(group, detachmentIds)])];
  const source = sourceGroup || group;
  const entries = asArray(group?.selectionEntries?.selectionEntry).map(entry => ({
    entry,
    sourceGroup: source,
    detachmentIds: [...new Set([...ownIds, ...referencedIds(entry, detachmentIds)])]
  }));
  for (const child of asArray(group?.selectionEntryGroups?.selectionEntryGroup)) {
    entries.push(...enhancementEntriesIn(child, indexes, detachmentIds, ownIds, nextAncestry, source));
  }
  for (const link of asArray(group?.entryLinks?.entryLink)) {
    if (link.type !== "selectionEntryGroup") continue;
    entries.push(...enhancementEntriesIn(indexes.groups.get(link.targetId), indexes, detachmentIds, ownIds, nextAncestry, source));
  }
  return entries;
}

function extractArmyDefinitions(dataDirectory) {
  const { catalogues, gameSystem, indexes } = loadBsdataContext(dataDirectory);
  const catalogueLookup = buildCatalogueLookup(catalogues);
  const definitions = [];

  for (const { file, catalogue } of catalogues) {
    const faction = catalogue.name || path.basename(file, ".cat");
    let detachmentLink = asArray(catalogue?.entryLinks?.entryLink).find(link =>
      link.type === "selectionEntry"
      && isDetachmentRootName(link.name || indexes.entries.get(link.targetId)?.name)
    );
    if (!detachmentLink && faction.startsWith("Imperium - Adeptus Astartes - ")) {
      const sharedAstartes = catalogues.find(item => item.catalogue.name === "Imperium - Adeptus Astartes - Space Marines");
      detachmentLink = asArray(sharedAstartes?.catalogue?.entryLinks?.entryLink).find(link =>
        link.type === "selectionEntry" && isDetachmentRootName(link.name || indexes.entries.get(link.targetId)?.name)
      );
    }
    if (!detachmentLink) continue;
    const detachmentRoot = indexes.entries.get(detachmentLink.targetId);
    if (!detachmentRoot) continue;

    let detachmentGroup = null;
    visitResolved(detachmentRoot, indexes, node => {
      if (!detachmentGroup
        && node !== detachmentRoot
        && /^detachments?$/.test(String(node.name || "").trim().toLowerCase())
        && node.selectionEntries !== undefined) detachmentGroup = node;
    });
    if (!detachmentGroup) continue;

    const allDetachmentEntries = asArray(detachmentGroup?.selectionEntries?.selectionEntry);
    const excludedDetachmentNames = DETACHMENT_NAME_EXCLUSIONS_BY_FACTION[faction] || new Set();
    const detachmentEntries = allDetachmentEntries.filter(entry =>
      !hiddenForCatalogue(entry, catalogue.id) && !excludedDetachmentNames.has(entry.name)
    );
    const detachmentIds = new Set(allDetachmentEntries.map(item => item.id).filter(Boolean));
    const visibleDetachmentIds = new Set(detachmentEntries.map(item => item.id).filter(Boolean));
    const detachments = detachmentEntries.map(entry => {
      const stratagems = [];
      visitResolved(entry, indexes, node => {
        for (const profile of asArray(node?.profiles?.profile)) {
          if (/stratagem/i.test(profile.typeName || "")) stratagems.push(normalizeProfile(profile));
        }
      });
      return {
        id: entry.id,
        name: entry.name || "Unnamed detachment",
        points: Number(directPoints(entry) || 0),
        detachmentPoints: detachmentPointsFor(entry, gameSystem, catalogue.id),
        rules: rulesFor(entry, indexes),
        stratagems
      };
    });

    const eligibleByGroup = new Map();
    const allEligibleUnits = [];

    const nativeUnitLinks = nativeUnitLinksFor({ file, catalogue }, catalogueLookup);

    for (const { link, selectionCatalogueId } of nativeUnitLinks) {
      if (link.type !== "selectionEntry" || link.hidden === "true") continue;
      const unit = indexes.entries.get(link.targetId);
      if (!unit || !isRosterUnit(unit)) continue;
      const selectionKey = `${selectionCatalogueId || faction}:${link.id}`;
      allEligibleUnits.push({ selectionKey, rootInstanceIds: rootInstanceIdsFor(unit) });
      for (const groupId of enhancementGroupIdsIn(unit, indexes)) {
        if (!eligibleByGroup.has(groupId)) eligibleByGroup.set(groupId, new Set());
        eligibleByGroup.get(groupId).add({ selectionKey, rootInstanceIds: rootInstanceIdsFor(unit) });
      }
    }

    const enhancementGroups = [...new Map([
      ...findNamedGroups(catalogue, "Enhancements"),
      ...findDetachmentUpgradeGroups(catalogue, detachmentIds),
      ...[...eligibleByGroup.keys()].map(id => indexes.groups.get(id)).filter(Boolean)
    ].map(group => [group.id, group])).values()];

    const enhancements = [...new Map(enhancementGroups.flatMap(group =>
      enhancementEntriesIn(group, indexes, detachmentIds).map(({ entry, detachmentIds: availableIn, sourceGroup }) => {
        const kind = /upgrade/i.test(sourceGroup?.name || "") ? "upgrade" : "enhancement";
        const eligibleUnits = [
          ...(eligibleByGroup.get(sourceGroup?.id) || eligibleByGroup.get(group.id) || (kind === "upgrade" ? allEligibleUnits : []))
        ];
        return {
          id: entry.id,
          name: entry.name || "Unnamed enhancement",
          kind,
          maxSelections: maxSelectionsFor(entry),
          points: Number(directPoints(entry) || 0),
          detachmentIds: availableIn,
          eligibleSelectionKeys: eligibleKeysForEntry(entry, eligibleUnits, { match: kind === "upgrade" ? "all" : "any" }),
          profiles: asArray(entry?.profiles?.profile).map(normalizeProfile),
          rules: rulesFor(entry, indexes)
        };
      })
    ).filter(item => item.detachmentIds.some(id => visibleDetachmentIds.has(id)))
      .map(item => [item.id, item])).values()];

    definitions.push({
      schemaVersion: 1,
      rulesetId: "wh40k-10e-bsdata",
      id: catalogue.id || faction,
      faction,
      source: { catalogueId: catalogue.id || null, sourceFile: file },
      armyRules: catalogueArmyRules(catalogue, indexes),
      allowedSelectionKeys: nativeUnitLinks
        .filter(({ link }) => link.type === "selectionEntry" && link.hidden !== "true" && isRosterUnit(indexes.entries.get(link.targetId)))
        .map(({ link, selectionCatalogueId }) => `${selectionCatalogueId || faction}:${link.id}`),
      detachments,
      enhancements
    });
  }

  return { definitions };
}

module.exports = { extractArmyDefinitions };
