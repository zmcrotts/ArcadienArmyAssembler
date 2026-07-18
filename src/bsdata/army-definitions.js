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
const { bsdataFlagIsTrue } = require("./flags");
const PRIMARY_MISSION_CARD_IMAGES = require("../../ui/assets/11th/primary-missions/manifest.json");
const { supplementalCategoryNamesFor } = require("../rulesets/detachment-keywords");

function normalizeName(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

const DETACHMENT_NAME_EXCLUSIONS_BY_FACTION = {
  "Xenos - Tyranids": new Set([
    "Final Day",
    "Heroes of the Uprising",
    "Purestrain Broodswarm",
    "Xenocult Masses"
  ])
};

const FORCE_DISPOSITION_MISSION_MAP = {
  "Take and Hold": [
    { name: "Battlefield Dominance", opponentDisposition: "Take and Hold" },
    { name: "Determined Acquisition", opponentDisposition: "Disruption" },
    { name: "Immovable Object", opponentDisposition: "Purge the Foe" },
    { name: "Inescapable Dominion", opponentDisposition: "Priority Assets" },
    { name: "Purge and Secure", opponentDisposition: "Reconnaissance" }
  ],
  "Purge the Foe": [
    { name: "Consecrate", opponentDisposition: "Reconnaissance" },
    { name: "Destroyer's Wrath", opponentDisposition: "Priority Assets" },
    { name: "Meatgrinder", opponentDisposition: "Purge the Foe" },
    { name: "Punishment", opponentDisposition: "Disruption" },
    { name: "Unstoppable Force", opponentDisposition: "Take and Hold" }
  ],
  "Reconnaissance": [
    { name: "Gather Intel", opponentDisposition: "Reconnaissance" },
    { name: "Reconnaissance Sweep", opponentDisposition: "Take and Hold" },
    { name: "Search and Scour", opponentDisposition: "Priority Assets" },
    { name: "Surveil the Foe", opponentDisposition: "Disruption" },
    { name: "Triangulation", opponentDisposition: "Purge the Foe" }
  ],
  "Priority Assets": [
    { name: "Extract Relic", opponentDisposition: "Disruption" },
    { name: "Sabotage", opponentDisposition: "Priority Assets" },
    { name: "Secure Asset", opponentDisposition: "Take and Hold" },
    { name: "Vanguard Operation", opponentDisposition: "Reconnaissance" },
    { name: "Vital Link", opponentDisposition: "Purge the Foe" }
  ],
  "Disruption": [
    { name: "Death Trap", opponentDisposition: "Take and Hold" },
    { name: "Delaying Action", opponentDisposition: "Purge the Foe" },
    { name: "Locate and Deny", opponentDisposition: "Priority Assets" },
    { name: "Outmanoeuvre", opponentDisposition: "Disruption" },
    { name: "Smoke and Mirrors", opponentDisposition: "Reconnaissance" }
  ]
};

function missionSlug(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function missionAssets(dispositionName, missionName) {
  const dispositionSlug = missionSlug(dispositionName);
  const cardSlug = missionSlug(missionName);
  const cardImages = PRIMARY_MISSION_CARD_IMAGES[dispositionSlug]?.[cardSlug] || null;
  return {
    cardImages: {
      front: cardImages?.front || `assets/11th/primary-missions/${dispositionSlug}/${cardSlug}.png`,
      back: cardImages?.back || null
    }
  };
}

function dispositionMissionMap(dispositionName) {
  return (FORCE_DISPOSITION_MISSION_MAP[dispositionName] || []).map(mission => ({
    ...mission,
    ...missionAssets(dispositionName, mission.name)
  }));
}

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

function catalogueArmyRules(catalogue, indexes, faction = "") {
  const rules = rulesFor(catalogue, indexes).filter(rule => !/^boarding actions$/i.test(rule.name));
  if (/black templars/i.test(faction)) return rules;
  return rules.filter(rule => String(rule.name || "").trim().toLowerCase() !== "templar vows");
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

function findNamedGroupsInNode(node, name) {
  const matches = [];
  const wanted = name.toLowerCase();
  function visit(current) {
    if (!current || typeof current !== "object") return;
    for (const group of [
      ...asArray(current?.selectionEntryGroups?.selectionEntryGroup),
      ...asArray(current?.sharedSelectionEntryGroups?.selectionEntryGroup)
    ]) {
      if (String(group.name || "").trim().toLowerCase() === wanted) matches.push(group);
      visit(group);
    }
    for (const entry of [
      ...asArray(current?.selectionEntries?.selectionEntry),
      ...asArray(current?.sharedSelectionEntries?.selectionEntry)
    ]) visit(entry);
  }
  visit(node);
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
  let hidden = bsdataFlagIsTrue(entry.hidden);
  for (const modifier of asArray(entry?.modifiers?.modifier)) {
    if (modifier.type === "set" && modifier.field === "hidden" && modifierAppliesToCatalogue(modifier, catalogueId)) {
      hidden = bsdataFlagIsTrue(modifier.value);
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

function rootInstanceIdsFor(unit, indexes, faction) {
  const ids = new Set([
    unit.id,
    ...asArray(unit?.categoryLinks?.categoryLink).map(link => link.targetId).filter(Boolean)
  ].filter(Boolean));
  visitResolved(unit, indexes, node => {
    function collectCategoryGrants(value) {
      if (!value || typeof value !== "object") return;
      if (value.field === "category" && ["add", "set-primary"].includes(value.type) && value.value) ids.add(value.value);
      for (const child of Object.values(value)) {
        if (Array.isArray(child)) child.forEach(collectCategoryGrants);
        else collectCategoryGrants(child);
      }
    }
    collectCategoryGrants(node?.modifiers);
    collectCategoryGrants(node?.modifierGroups);
  });
  const supplementalNames = new Set(supplementalCategoryNamesFor(faction, unit.name).map(normalizeName));
  for (const [id, category] of indexes.categories || []) {
    if (supplementalNames.has(normalizeName(category.name))) ids.add(id);
  }
  return ids;
}

function forceDispositionForDetachment(entry, dispositionsByName) {
  for (const link of asArray(entry?.categoryLinks?.categoryLink)) {
    const disposition = dispositionsByName.get(link.name);
    if (disposition) return disposition;
  }
  return null;
}

function isRootInstanceCondition(condition) {
  return ["instanceOf", "notInstanceOf"].includes(condition?.type)
    && ["root-entry", "ancestor"].includes(condition?.scope)
    && Boolean(condition?.childId);
}

function hasRootInstanceCondition(value) {
  if (!value || typeof value !== "object") return false;
  if (isRootInstanceCondition(value)) return true;
  return Object.values(value).some(child => Array.isArray(child)
    ? child.some(hasRootInstanceCondition)
    : hasRootInstanceCondition(child));
}

function rootConditionProjection(condition, rootInstanceIds) {
  if (!isRootInstanceCondition(condition)) return null;
  const present = rootInstanceIds.has(condition.childId);
  return condition.type === "instanceOf" ? present : !present;
}

function rootConditionGroupProjection(group, rootInstanceIds) {
  const results = [
    ...asArray(group?.conditions?.condition).map(condition => rootConditionProjection(condition, rootInstanceIds)),
    ...asArray(group?.conditionGroups?.conditionGroup).map(child => rootConditionGroupProjection(child, rootInstanceIds))
  ].filter(result => result !== null);
  if (!results.length) return null;
  return String(group?.type || "and").toLowerCase() === "or"
    ? results.some(Boolean)
    : results.every(Boolean);
}

function modifierRootResult(modifier, rootInstanceIds) {
  const results = [
    ...asArray(modifier?.conditions?.condition).map(condition => rootConditionProjection(condition, rootInstanceIds)),
    ...asArray(modifier?.conditionGroups?.conditionGroup).map(group => rootConditionGroupProjection(group, rootInstanceIds))
  ].filter(result => result !== null);
  if (!results.length) return null;
  return results.every(Boolean);
}

function enhancementVisibleForRoot(entry, rootInstanceIds) {
  let hidden = bsdataFlagIsTrue(entry?.hidden);
  for (const modifier of asArray(entry?.modifiers?.modifier)) {
    if (modifier.type !== "set" || modifier.field !== "hidden" || !hasRootInstanceCondition(modifier)) continue;
    if (modifierRootResult(modifier, rootInstanceIds) !== true) continue;
    hidden = bsdataFlagIsTrue(modifier.value);
  }
  return !hidden;
}

function eligibleKeysForEntry(entry, eligibleUnits) {
  const hasRootGate = hasRootInstanceCondition(entry?.modifiers);
  return eligibleUnits
    .filter(item => !hasRootGate || enhancementVisibleForRoot(entry, item.rootInstanceIds))
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
  const forceDispositions = extractForceDispositions(gameSystem);
  const forceDispositionsByName = new Map(forceDispositions.map(disposition => [disposition.name, disposition]));
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
      const forceDisposition = forceDispositionForDetachment(entry, forceDispositionsByName);
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
        forceDisposition: forceDisposition ? {
          id: forceDisposition.id,
          name: forceDisposition.name
        } : null,
        rules: rulesFor(entry, indexes),
        stratagems
      };
    });

    const eligibleByGroup = new Map();
    const allEligibleUnits = [];

    const nativeUnitLinks = nativeUnitLinksFor({ file, catalogue }, catalogueLookup);

    for (const { link, selectionCatalogueId } of nativeUnitLinks) {
      if (link.type !== "selectionEntry" || bsdataFlagIsTrue(link.hidden)) continue;
      const unit = indexes.entries.get(link.targetId);
      if (!unit || !isRosterUnit(unit)) continue;
      const selectionKey = `${selectionCatalogueId || faction}:${link.id}`;
      allEligibleUnits.push({ selectionKey, rootInstanceIds: rootInstanceIdsFor(unit, indexes, faction) });
      for (const groupId of enhancementGroupIdsIn(unit, indexes)) {
        if (!eligibleByGroup.has(groupId)) eligibleByGroup.set(groupId, new Set());
        eligibleByGroup.get(groupId).add({ selectionKey, rootInstanceIds: rootInstanceIdsFor(unit, indexes, faction) });
      }
    }

    const enhancementGroups = [...new Map([
      ...findNamedGroups(catalogue, "Enhancements"),
      ...findDetachmentUpgradeGroups(catalogue, detachmentIds),
      ...[...eligibleByGroup.keys()].map(id => indexes.groups.get(id)).filter(Boolean)
    ].map(group => [group.id, group])).values()];

    const extractedEnhancements = [...new Map(enhancementGroups.flatMap(group =>
      enhancementEntriesIn(group, indexes, detachmentIds).map(({ entry, detachmentIds: availableIn, sourceGroup }) => {
        const kind = /upgrade/i.test(sourceGroup?.name || "") ? "upgrade" : "enhancement";
        const directlyEligibleUnits = [
          ...(eligibleByGroup.get(sourceGroup?.id) || eligibleByGroup.get(group.id) || (kind === "upgrade" ? allEligibleUnits : []))
        ];
        // Root/ancestor visibility conditions are the authoritative bearer
        // predicate. Evaluate them against every unit, preserving the source's
        // boolean groups (e.g. Cronos OR Talos) instead of requiring every
        // referenced ID. Without a root predicate, prefer the linked group and
        // fall back to the faction's units for global enhancement groups.
        const eligibleUnits = hasRootInstanceCondition(entry?.modifiers)
          ? allEligibleUnits
          : directlyEligibleUnits.length ? directlyEligibleUnits : allEligibleUnits;
        return {
          id: entry.id,
          name: entry.name || "Unnamed enhancement",
          kind,
          maxSelections: maxSelectionsFor(entry),
          points: Number(directPoints(entry) || 0),
          detachmentIds: availableIn,
          eligibleSelectionKeys: eligibleKeysForEntry(entry, eligibleUnits),
          profiles: asArray(entry?.profiles?.profile).map(normalizeProfile),
          rules: rulesFor(entry, indexes)
        };
      })
    ).filter(item => item.detachmentIds.some(id => visibleDetachmentIds.has(id)))
      .map(item => [item.id, item])).values()];
    const enhancements = mergeDuplicateEnhancements(extractedEnhancements);

    definitions.push({
      schemaVersion: 1,
      rulesetId: "wh40k-10e-bsdata",
      id: catalogue.id || faction,
      faction,
      source: { catalogueId: catalogue.id || null, sourceFile: file },
      armyRules: catalogueArmyRules(catalogue, indexes, faction),
      forceDispositions,
      allowedSelectionKeys: nativeUnitLinks
        .filter(({ link }) => link.type === "selectionEntry" && !bsdataFlagIsTrue(link.hidden) && isRosterUnit(indexes.entries.get(link.targetId)))
        .map(({ link, selectionCatalogueId }) => `${selectionCatalogueId || faction}:${link.id}`),
      detachments,
      enhancements
    });
  }

  return { definitions };
}

function mergeDuplicateEnhancements(enhancements) {
  const byIdentity = new Map();
  for (const enhancement of enhancements) {
    const key = [
      String(enhancement.kind || "").toLowerCase(),
      String(enhancement.name || "").trim().toLowerCase(),
      ...(enhancement.detachmentIds || []).slice().sort()
    ].join("|");
    const current = byIdentity.get(key);
    if (!current) {
      byIdentity.set(key, enhancement);
      continue;
    }

    // Some catalogues expose the same detachment upgrade through both a
    // presentation group and its live selection group. Keep one card and the
    // force-wide limit, while retaining any richer profile/rule text.
    const preferred = Number(enhancement.maxSelections || 1) > Number(current.maxSelections || 1)
      ? enhancement
      : current;
    const alternate = preferred === enhancement ? current : enhancement;
    byIdentity.set(key, {
      ...preferred,
      profiles: richerRecords(preferred.profiles, alternate.profiles),
      rules: richerRecords(preferred.rules, alternate.rules),
      eligibleSelectionKeys: [...new Set([
        ...(preferred.eligibleSelectionKeys || []),
        ...(alternate.eligibleSelectionKeys || [])
      ])]
    });
  }
  return [...byIdentity.values()];
}

function richerRecords(primary = [], alternate = []) {
  const records = new Map();
  for (const record of [...primary, ...alternate]) {
    const key = String(record?.name || record?.id || "").trim().toLowerCase();
    const existing = records.get(key);
    const richness = item => JSON.stringify(item || {}).length;
    if (!existing || richness(record) > richness(existing)) records.set(key, record);
  }
  return [...records.values()];
}

function extractForceDispositions(gameSystem) {
  const group = findNamedGroupsInNode(gameSystem, "Force Disposition")[0];
  const entries = asArray(group?.selectionEntries?.selectionEntry);
  return entries.map(entry => ({
    id: entry.id,
    name: entry.name || "Unnamed disposition",
    hidden: bsdataFlagIsTrue(entry.hidden),
    missionMap: dispositionMissionMap(entry.name)
  }));
}

module.exports = { extractArmyDefinitions };
