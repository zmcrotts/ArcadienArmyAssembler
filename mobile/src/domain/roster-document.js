"use strict";

const ROSTER_DOCUMENT_KIND = "roster-engine.savedRoster";
const ROSTER_DOCUMENT_SCHEMA_VERSION = 2;

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function asNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeWarning(item) {
  if (!item) return null;
  if (item.ok === false) {
    return {
      severity: item.severity || "warning",
      code: item.code || "VALIDATION_WARNING",
      message: item.text || item.message || "Roster warning.",
      affectedInstanceIds: item.affectedInstanceIds || []
    };
  }
  if (item.severity || item.code || item.message) {
    return {
      severity: item.severity || "warning",
      code: item.code || "VALIDATION_WARNING",
      message: item.message || item.text || "Roster warning.",
      affectedInstanceIds: item.affectedInstanceIds || [],
      details: item.details || {}
    };
  }
  return null;
}

function unitName(item) {
  return item?.unitPackage?.name || item?.name || item?.definition?.name || "Unknown unit";
}

function unitSelectionKey(item) {
  return item?.unitPackage?.selectionKey || item?.selectionKey || item?.definition?.selectionKey || null;
}

function unitDefinition(item) {
  return item?.unitPackage?.definition || item?.definition || {};
}

function unitAlliedFor(item) {
  return item?.unitPackage?.alliedFor || item?.alliedFor || null;
}

function summarizeUnit(item, services) {
  const definition = unitDefinition(item);
  const entry = item.entry || {};
  const instanceId = item.instanceId || entry.instanceId;
  const points = asNumber(services.entryPoints?.(item), asNumber(item.points));
  return {
    instanceId,
    selectionKey: unitSelectionKey(item),
    name: unitName(item),
    points,
    roles: clone(item?.unitPackage?.definition?.roles || definition.roles || item.roles || {}),
    keywords: clone(item?.unitPackage?.keywords || definition.keywords || definition.categories || []),
    alliedFor: unitAlliedFor(item),
    source: item?.unitPackage?.source || definition.source || null,
    unitSize: services.unitSizeState ? clone(services.unitSizeState(definition, entry)) : null,
    entry: clone(entry),
    models: services.configuredModels ? clone(services.configuredModels(definition, entry)) : [],
    configured: services.configuredProfiles ? clone(services.configuredProfiles(definition, entry)) : null
  };
}

function summarizeDetachment(armyDefinition, armyState, services) {
  const detachment = services.selectedDetachment?.(armyDefinition, armyState)
    || (armyDefinition?.detachments || []).find(item => item.id === armyState?.detachmentId)
    || null;
  if (!detachment) return null;
  return {
    id: detachment.id,
    name: detachment.name,
    points: asNumber(detachment.points),
    detachmentPoints: asNumber(detachment.detachmentPoints),
    forceDisposition: clone(detachment.forceDisposition || null),
    rules: clone(detachment.rules || []),
    stratagems: clone(detachment.stratagems || [])
  };
}

function summarizeDetachments(armyDefinition, armyState, services) {
  const detachments = services.selectedDetachments?.(armyDefinition, armyState)
    || (armyDefinition?.detachments || []).filter(item =>
      (armyState?.detachmentIds || [armyState?.detachmentId]).filter(Boolean).includes(item.id)
    );
  return detachments.map(detachment => ({
    id: detachment.id,
    name: detachment.name,
    points: asNumber(detachment.points),
    detachmentPoints: asNumber(detachment.detachmentPoints),
    forceDisposition: clone(detachment.forceDisposition || null),
    rules: clone(detachment.rules || []),
    stratagems: clone(detachment.stratagems || [])
  }));
}

function summarizeMissionSetup(armyDefinition, armyState) {
  const forceDisposition = (armyDefinition?.forceDispositions || []).find(item => item.id === armyState?.forceDispositionId) || null;
  const opponentDisposition = (armyDefinition?.forceDispositions || []).find(item => item.id === armyState?.opponentForceDispositionId) || null;
  const primaryMission = forceDisposition && opponentDisposition
    ? (forceDisposition.missionMap || []).find(mission => mission.opponentDisposition === opponentDisposition.name) || null
    : null;
  return {
    forceDisposition: forceDisposition ? { id: forceDisposition.id, name: forceDisposition.name } : null,
    opponentForceDisposition: opponentDisposition ? { id: opponentDisposition.id, name: opponentDisposition.name } : null,
    primaryMission: primaryMission ? clone(primaryMission) : null
  };
}

function summarizeEnhancements(armyDefinition, armyState, rosterEntries) {
  const byId = new Map((rosterEntries || []).map(item => [item.instanceId || item.entry?.instanceId, item]));
  return (armyState?.enhancements || []).map(assignment => {
    const enhancement = (armyDefinition?.enhancements || []).find(item => item.id === assignment.enhancementId) || null;
    const bearer = byId.get(assignment.bearerInstanceId) || null;
    return {
      enhancementId: assignment.enhancementId,
      name: enhancement?.name || assignment.enhancementId,
      points: asNumber(enhancement?.points),
      bearerInstanceId: assignment.bearerInstanceId,
      bearerName: bearer ? unitName(bearer) : null,
      profiles: clone(enhancement?.profiles || []),
      rules: clone(enhancement?.rules || []),
      description: enhancementDescription(enhancement),
      available: Boolean(enhancement)
    };
  });
}

function enhancementDescription(enhancement) {
  const descriptions = [
    ...(enhancement?.profiles || []).map(profile => profile.characteristics?.Description).filter(Boolean),
    ...(enhancement?.rules || []).map(rule => rule.description).filter(Boolean)
  ];
  return descriptions.join(" ").trim();
}

function summarizeWarlord(armyState, rosterEntries) {
  const warlord = (rosterEntries || []).find(item =>
    (item.instanceId || item.entry?.instanceId) === armyState?.warlordInstanceId
  );
  return armyState?.warlordInstanceId ? {
    instanceId: armyState.warlordInstanceId,
    name: warlord ? unitName(warlord) : null,
    selectionKey: warlord ? unitSelectionKey(warlord) : null
  } : null;
}

function summarizeArmyRules(armyDefinition) {
  return clone([
    ...(armyDefinition?.armyRules || []),
    ...(armyDefinition?.factionRules || []),
    ...(armyDefinition?.rules || [])
  ]);
}

function summarizeGroup(group, unitRecordsById) {
  const memberInstanceIds = group.memberInstanceIds || [];
  const members = memberInstanceIds.map(instanceId => unitRecordsById.get(instanceId)).filter(Boolean);
  return {
    id: group.id,
    kind: group.kind,
    title: group.title,
    totalPoints: asNumber(group.totalPoints),
    memberInstanceIds: clone(memberInstanceIds),
    bodyguardInstanceId: group.bodyguard?.instanceId || null,
    leaderInstanceIds: (group.leaders || []).map(item => item.instanceId),
    warnings: clone(group.warnings || []),
    members: members.map(item => ({
      instanceId: item.instanceId,
      selectionKey: item.selectionKey,
      name: item.name,
      points: item.points,
      roles: item.roles,
      keywords: item.keywords,
      alliedFor: item.alliedFor,
      unitSize: item.unitSize,
      models: item.models || [],
      configured: item.configured
    }))
  };
}

function createRosterDocument(options) {
  const services = options.services || {};
  const rosterEntries = options.rosterEntries || [];
  const armyDefinition = options.armyDefinition || null;
  const armyState = clone(options.armyState || {});
  const unitRecords = rosterEntries.map(item => summarizeUnit(item, services));
  const unitRecordsById = new Map(unitRecords.map(item => [item.instanceId, item]));
  const validationWarnings = (options.validationWarnings || []).map(normalizeWarning).filter(Boolean);
  const groupedPresentation = (options.groupedPresentation || []).map(group => summarizeGroup(group, unitRecordsById));
  const pointsLimit = asNumber(options.pointsLimit);
  const totalPoints = asNumber(options.totalPoints, unitRecords.reduce((sum, item) => sum + item.points, 0));

  return {
    kind: ROSTER_DOCUMENT_KIND,
    schemaVersion: ROSTER_DOCUMENT_SCHEMA_VERSION,
    name: options.name || null,
    ruleset: {
      id: options.rulesetId || options.engineData?.rulesetId || armyDefinition?.rulesetId || armyState?.rulesetId || "wh40k-10e-bsdata",
      source: options.source || options.engineData?.source || "bsdata",
      generatedAt: options.engineData?.generatedAt || null
    },
    faction: options.faction || null,
    subfaction: options.subfaction || options.faction || null,
    pointsLimit,
    totalPoints,
    armyState,
    detachment: summarizeDetachment(armyDefinition, armyState, services),
    detachments: summarizeDetachments(armyDefinition, armyState, services),
    armyRules: summarizeArmyRules(armyDefinition),
    forceDispositions: clone(armyDefinition?.forceDispositions || []),
    missionSetup: summarizeMissionSetup(armyDefinition, armyState),
    coreStratagems: clone(armyDefinition?.coreStratagems || []),
    stratagemSource: clone(armyDefinition?.stratagemSource || null),
    warlord: summarizeWarlord(armyState, unitRecords),
    enhancements: summarizeEnhancements(armyDefinition, armyState, unitRecords),
    alliedUnits: unitRecords.filter(item => item.alliedFor).map(item => ({
      instanceId: item.instanceId,
      selectionKey: item.selectionKey,
      name: item.name,
      points: item.points,
      keywords: item.keywords,
      alliedFor: item.alliedFor
    })),
    rosterEntries: unitRecords,
    groupedPresentation,
    validationWarnings,
    rosterDisplay: clone(options.rosterDisplay || null),
    exportData: {
      machineReadable: "json",
      includesIndependentUnitRecords: true,
      includesDerivedGroupedPresentation: true
    }
  };
}

function findUnitPackage(unitPackages, selectionKey, saved) {
  return (unitPackages || []).find(unit =>
    unit.selectionKey === selectionKey
    || unit.id === saved?.unitId
    || unit.name === saved?.name
  ) || null;
}

function savedRosterEntries(document) {
  if (Array.isArray(document?.rosterEntries)) return document.rosterEntries;
  if (Array.isArray(document?.units)) return document.units;
  if (Array.isArray(document?.roster)) return document.roster;
  return [];
}

function normalizeSavedEntry(saved) {
  const entry = clone(saved.entry || {});
  const instanceId = saved.instanceId || entry.instanceId;
  if (instanceId && !entry.instanceId) entry.instanceId = instanceId;
  return {
    instanceId,
    selectionKey: saved.selectionKey || entry.selectionKey,
    entry
  };
}

function diffArmyStateReferences(before, after) {
  const removed = [];
  const beforeAttachments = before?.attachments || [];
  const afterAttachments = new Set((after?.attachments || []).map(item => `${item.leaderInstanceId}->${item.targetInstanceId}`));
  for (const item of beforeAttachments) {
    const key = `${item.leaderInstanceId}->${item.targetInstanceId}`;
    if (!afterAttachments.has(key)) removed.push({ type: "attachment", ...item });
  }

  const afterEnhancements = new Set((after?.enhancements || []).map(item => `${item.enhancementId}->${item.bearerInstanceId}`));
  for (const item of before?.enhancements || []) {
    const key = `${item.enhancementId}->${item.bearerInstanceId}`;
    if (!afterEnhancements.has(key)) removed.push({ type: "enhancement", ...item });
  }

  if (before?.warlordInstanceId && before.warlordInstanceId !== after?.warlordInstanceId) {
    removed.push({ type: "warlord", instanceId: before.warlordInstanceId });
  }
  return removed;
}

function hydrateRosterDocument(document, options = {}) {
  const warnings = [];
  const unitPackages = options.unitPackages || [];
  const roster = [];

  for (const saved of savedRosterEntries(document)) {
    const normalized = normalizeSavedEntry(saved);
    const unitPackage = findUnitPackage(unitPackages, normalized.selectionKey, saved);
    if (!unitPackage) {
      warnings.push({
        severity: "warning",
        code: "SAVED_UNIT_NOT_FOUND",
        message: `${saved.name || normalized.selectionKey || "A saved unit"} is no longer available and was not loaded.`,
        affectedInstanceIds: [normalized.instanceId].filter(Boolean)
      });
      continue;
    }
    roster.push({
      instanceId: normalized.instanceId || normalized.entry.instanceId,
      unitPackage,
      entry: normalized.entry
    });
  }

  const baseArmyState = options.createArmyState ? options.createArmyState() : {};
  const savedArmyState = clone(document?.armyState || {});
  if (!Array.isArray(savedArmyState.detachmentIds)) {
    savedArmyState.detachmentIds = savedArmyState.detachmentId ? [savedArmyState.detachmentId] : [];
  }
  const mergedArmyState = { ...baseArmyState, ...savedArmyState };
  const armyState = options.pruneArmyStateForRoster
    ? options.pruneArmyStateForRoster(mergedArmyState, roster)
    : mergedArmyState;
  const prunedReferences = diffArmyStateReferences(mergedArmyState, armyState);
  for (const reference of prunedReferences) {
    warnings.push({
      severity: "warning",
      code: "STALE_REFERENCE_PRUNED",
      message: `Removed a stale ${reference.type} reference to a unit that is no longer in the roster.`,
      affectedInstanceIds: [reference.instanceId, reference.leaderInstanceId, reference.targetInstanceId, reference.bearerInstanceId].filter(Boolean),
      details: reference
    });
  }

  return {
    faction: document?.faction || null,
    subfaction: document?.subfaction || document?.faction || null,
    pointsLimit: asNumber(document?.pointsLimit, 1000),
    armyState,
    roster,
    warnings,
    prunedReferences
  };
}

function weaponLines(configured, prefix = "") {
  return (configured?.weapons || []).map(weapon => `${prefix}${weapon.count || 1}x ${weapon.name}`);
}

function stripMarkup(value) {
  return String(value || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&bull;/g, "•")
    .replace(/&amp;/g, "&")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function forceName(document) {
  return document.subfaction || document.faction || "Roster";
}

function detachmentText(document) {
  const detachments = document.detachments?.length ? document.detachments : [document.detachment].filter(Boolean);
  return detachments.map(item => item.name).filter(Boolean).join(", ");
}

function enhancementBearerMap(document) {
  const byBearer = new Map();
  for (const enhancement of document.enhancements || []) {
    const key = enhancement.bearerInstanceId;
    if (!key) continue;
    if (!byBearer.has(key)) byBearer.set(key, []);
    byBearer.get(key).push(enhancement);
  }
  return byBearer;
}

function enhancementPointsForBearer(document, instanceId) {
  return (enhancementBearerMap(document).get(instanceId) || [])
    .reduce((sum, enhancement) => sum + Number(enhancement.points || 0), 0);
}

function wargearNames(record) {
  const names = [];
  for (const weapon of record.configured?.weapons || []) {
    const count = Number(weapon.count || 1);
    names.push(`${count > 1 ? `${count}x ` : ""}${weapon.name}`);
  }
  for (const ability of record.configured?.abilities || []) {
    if (ability.name && !names.includes(ability.name)) names.push(ability.name);
  }
  return names;
}

function normalizeLookup(value) {
  const text = String(value || "");
  return typeof text.normalize === "function"
    ? text.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    : text;
}

function normalizeKey(value) {
  return normalizeLookup(value)
    .replace(/[\u2018\u2019\u201B\u2032]/g, "'")
    .replace(/[^a-zA-Z0-9'\s-]+/g, " ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function findSkippableEntry(skippable, document, unitName) {
  if (!skippable || !unitName) return null;
  const factionCandidates = [
    document.faction,
    document.subfaction,
    String(document.faction || "").replace(/^(Imperium|Chaos|Xenos|Aeldari|Library) - /, ""),
    String(document.subfaction || "").replace(/^(Imperium|Chaos|Xenos|Aeldari|Library) - /, "").replace(/^Adeptus Astartes - /, ""),
    String(document.faction || "").replace(/^.* - /, "")
  ].filter(Boolean);
  for (const faction of factionCandidates) {
    const factionKey = normalizeKey(faction);
    const factionBlock = Object.entries(skippable).find(([key]) => normalizeKey(key) === factionKey)?.[1];
    if (!factionBlock || typeof factionBlock !== "object") continue;
    const found = Object.entries(factionBlock).find(([key]) => normalizeKey(key) === normalizeKey(unitName));
    if (found) return found[1];
  }
  return null;
}

function isSkippableWargear(skippableEntry, name) {
  if (skippableEntry === true) return true;
  if (!Array.isArray(skippableEntry)) return false;
  return skippableEntry.some(item => normalizeKey(item) === normalizeKey(name));
}

function abbreviateName(name) {
  const cleaned = String(name || "")
    .replace(/\(.*?\)/g, "")
    .replace(/[\u2018\u2019\u201B\u2032]/g, "'")
    .replace(/[.,;:!?"]/g, "")
    .replace(/-/g, " ")
    .trim();
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (!words.length) return "";
  if (words.length === 1) {
    const word = words[0];
    if (word.startsWith("'") && word.length > 1) return `'${word[1].toUpperCase()}`;
    return word.slice(0, 2).toUpperCase();
  }
  return words.map(word => {
    const lower = word.toLowerCase();
    if (lower === "and") return "&";
    if (lower === "of") return "o";
    if (word.startsWith("'") && word.length > 1) return `'${word[1].toUpperCase()}`;
    return word[0].toUpperCase();
  }).join("");
}

function compactItemName(name, compact) {
  return compact ? abbreviateName(name) : name;
}

function quantityPrefix(count) {
  const number = Number(count || 1);
  return number > 1 ? `${number}x ` : "";
}

function addItemCount(map, name, count = 1) {
  const key = normalizeKey(name);
  if (!key) return;
  const existing = map.get(key) || { name, count: 0 };
  existing.count += Number(count || 1);
  map.set(key, existing);
}

function equipmentItems(equipment) {
  const items = [];
  for (const raw of equipment || []) {
    const text = String(raw || "").trim();
    if (!text) continue;
    const match = text.match(/^(\d+)x\s+(.+)$/i);
    items.push({ name: match ? match[2].trim() : text, count: match ? Number(match[1]) : 1, explicitCount: Boolean(match) });
  }
  return items;
}

function modelExportItems(record, document, skippableEntry, compact) {
  const models = Array.isArray(record.models) ? record.models : [];
  if (!models.length) return [];
  return models.map(model => {
    const visible = equipmentItems(model.equipment)
      .filter(item => !isSkippableWargear(skippableEntry, item.name))
      .map(item => ({
        ...item,
        display: `${quantityPrefix(item.count)}${compactItemName(item.name, compact)}`
      }));
    return {
      name: model.name,
      count: Number(model.count || 1),
      items: visible
    };
  }).filter(model => model.items.length);
}

function flatExportItems(record, document, skippableEntry, compact) {
  const items = new Map();
  for (const model of modelExportItems(record, document, skippableEntry, compact)) {
    for (const item of model.items) addItemCount(items, item.name, item.explicitCount ? item.count : item.count * model.count);
  }
  if (!items.size) {
    for (const weapon of record.configured?.weapons || []) {
      if (isSkippableWargear(skippableEntry, weapon.name)) continue;
      addItemCount(items, weapon.name, Number(weapon.count || 1));
    }
  }
  return [...items.values()]
    .sort((a, b) => (b.count - a.count) || String(a.name).localeCompare(String(b.name)))
    .map(item => `${quantityPrefix(item.count)}${compactItemName(item.name, compact)}`);
}

function discordUnitSpecials(record, document, compact) {
  const specials = [];
  if (document.warlord?.instanceId === record.instanceId) specials.push("Warlord");
  for (const enhancement of enhancementBearerMap(document).get(record.instanceId) || []) {
    const name = compact ? abbreviateName(enhancement.name) : enhancement.name;
    specials.push(`E: ${name}${enhancement.points ? ` (+${enhancement.points} pts)` : ""}`);
  }
  return specials;
}

function discordExportRecordFor(document, record, options) {
  const skippableEntry = findSkippableEntry(options.skippableWargear || {}, document, record.name);
  const modelItems = modelExportItems(record, document, skippableEntry, options.compact);
  const enhancementPoints = enhancementPointsForBearer(document, record.instanceId);
  return {
    instanceId: record.instanceId,
    name: record.name,
    count: Number(record.unitSize?.current || 1),
    points: Number(record.points || 0) + enhancementPoints,
    specials: discordUnitSpecials(record, document, options.compact),
    flatItems: flatExportItems(record, document, skippableEntry, options.compact),
    modelItems
  };
}

function discordExportRecords(document, options) {
  return sortedExportRecords(document).map(record => discordExportRecordFor(document, record, options));
}

function discordSignature(record, hideSubunits) {
  return JSON.stringify({
    name: record.name,
    count: record.count,
    points: record.points,
    specials: record.specials,
    flatItems: record.flatItems,
    modelItems: hideSubunits ? [] : record.modelItems
  });
}

function combineDiscordRecords(records, hideSubunits) {
  const bySignature = new Map();
  const output = [];
  for (const record of records) {
    const signature = discordSignature(record, hideSubunits);
    const existing = bySignature.get(signature);
    if (existing) existing.copies += 1;
    else {
      const next = { ...record, copies: 1 };
      bySignature.set(signature, next);
      output.push(next);
    }
  }
  return output;
}

function ansi(text, code, bold = false, enabled = false) {
  if (!enabled || !text) return text;
  return `\u001b[${bold ? "1;" : ""}${code}m${text}\u001b[0m`;
}

function discordItemsSuffix(items) {
  return items.length ? ` (${items.join(", ")})` : "";
}

function discordHeaderLines(document) {
  return [
    document.name || document.subfaction || document.faction || "Roster",
    document.faction ? `Faction: ${document.faction}` : null,
    detachmentText(document) ? `Detachment: ${detachmentText(document)}` : null,
    `${document.totalPoints || 0} / ${document.pointsLimit || 0} pts`
  ].filter(Boolean);
}

function discordGroupRecords(document, group, options) {
  const byId = new Map((document.rosterEntries || []).map(record => [record.instanceId, record]));
  const memberIds = group.memberInstanceIds || [];
  const bodyguardId = group.bodyguardInstanceId || memberIds[0];
  const orderedIds = group.kind === "attached"
    ? [...memberIds.filter(id => id !== bodyguardId), bodyguardId]
    : memberIds;
  return orderedIds.map(id => byId.get(id)).filter(Boolean).map(record => discordExportRecordFor(document, record, options));
}

function discordExportGroups(document, options) {
  const groups = Array.isArray(document.groupedPresentation) && document.groupedPresentation.length
    ? document.groupedPresentation
    : [];
  if (!groups.length) return [];
  const order = new Map(sortedExportRecords(document).map((record, index) => [record.instanceId, index]));
  return groups.map((group, index) => ({
    kind: group.kind || "unit",
    index,
    title: group.title || "Unit",
    points: Number(group.totalPoints || 0),
    records: discordGroupRecords(document, group, options),
    order: Math.min(...(group.memberInstanceIds || []).map(id => order.get(id)).filter(value => value !== undefined))
  })).filter(group => group.records.length).sort((a, b) => (a.order - b.order) || (a.index - b.index));
}

function discordRecordLine(record, options) {
  const copyPrefix = record.copies > 1 ? `${record.copies}x` : "";
  const countPrefix = record.count > 1 || record.copies > 1 ? `${record.count} ` : "";
  const displayName = `${copyPrefix}${countPrefix}${record.name}`.trim();
  const topItems = [...record.specials, ...(options.hideSubunits ? record.flatItems : record.modelItems.length ? [] : record.flatItems)];
  const points = `[${record.points}]`;
  return `${options.noBullets ? "" : "* "}${ansi(displayName, options.unitColor, true, options.useAnsi)}${ansi(discordItemsSuffix(topItems), options.detailColor, false, options.useAnsi)}${options.hidePoints ? "" : ` ${ansi(points, options.pointsColor, true, options.useAnsi)}`}`;
}

function discordModelLines(record, options) {
  if (options.hideSubunits) return [];
  return record.modelItems.map(model => {
    const modelName = `${model.count > 1 ? `${model.count} ` : ""}${model.name}`;
    return `${options.noBullets ? "" : "  + "}${ansi(modelName, options.unitColor, true, options.useAnsi)}${ansi(discordItemsSuffix(model.items.map(item => item.display)), options.detailColor, false, options.useAnsi)}`;
  });
}

function exportDiscordText(document, options = {}) {
  const compact = options.compact !== false;
  const hideSubunits = Boolean(options.hideSubunits);
  const combine = Boolean(options.combineIdentical);
  const useAnsi = options.ansi !== false;
  const noBullets = Boolean(options.noBullets);
  const hidePoints = Boolean(options.hidePoints);
  const unitColor = Number(options.unitAnsiCode || 37);
  const detailColor = Number(options.detailAnsiCode || unitColor);
  const pointsColor = Number(options.pointsAnsiCode || 33);
  const renderOptions = { hideSubunits, noBullets, hidePoints, unitColor, detailColor, pointsColor, useAnsi };
  const recordOptions = { ...options, compact };
  const grouped = Boolean(options.groupAttached !== false);
  const groups = grouped ? discordExportGroups(document, recordOptions) : [];
  const records = groups.length ? [] : combine
    ? combineDiscordRecords(discordExportRecords(document, recordOptions), hideSubunits)
    : discordExportRecords(document, recordOptions).map(record => ({ ...record, copies: 1 }));
  const lines = [];
  if (useAnsi) lines.push("```ansi");
  if (options.multilineHeader) {
    lines.push(...discordHeaderLines(document).map(line => ansi(line, pointsColor, true, useAnsi)), "");
  }
  if (groups.length) {
    let attachedIndex = 0;
    for (const group of groups) {
      const isAttached = group.kind === "attached";
      if (isAttached) {
        attachedIndex += 1;
        lines.push(`${ansi(`Attached unit ${attachedIndex}:`, pointsColor, true, useAnsi)}${hidePoints ? "" : ` ${ansi(`[${group.points}]`, pointsColor, true, useAnsi)}`}`);
      }
      const groupRecords = combine
        ? combineDiscordRecords(group.records, hideSubunits)
        : group.records.map(record => ({ ...record, copies: 1 }));
      for (const record of groupRecords) {
        lines.push(discordRecordLine(record, renderOptions));
        lines.push(...discordModelLines(record, renderOptions));
      }
      if (isAttached) lines.push("");
    }
    if (lines[lines.length - 1] === "") lines.pop();
  } else {
    for (const record of records) {
      lines.push(discordRecordLine(record, renderOptions));
      lines.push(...discordModelLines(record, renderOptions));
    }
  }
  if (useAnsi) lines.push("```");
  return lines.join("\n");
}

function unitCategory(record) {
  const keywords = (record.keywords || []).map(item => String(item).toLowerCase());
  const roles = record.roles || {};
  if (record.alliedFor) return "ALLIED UNITS";
  if (roles.character || roles.epicHero || keywords.includes("character") || keywords.includes("epic hero")) return "CHARACTER";
  if (roles.battleline || keywords.includes("battleline")) return "BATTLELINE";
  return "OTHER DATASHEETS";
}

function sortedExportRecords(document) {
  const order = ["CHARACTER", "BATTLELINE", "OTHER DATASHEETS", "ALLIED UNITS"];
  const records = [...(document.rosterEntries || [])];
  records.sort((a, b) => {
    const categoryDelta = order.indexOf(unitCategory(a)) - order.indexOf(unitCategory(b));
    return categoryDelta || String(a.name).localeCompare(String(b.name));
  });
  return records;
}

function characterIndexMap(records) {
  let count = 0;
  const indexes = new Map();
  for (const record of records) {
    if (unitCategory(record) === "CHARACTER") indexes.set(record.instanceId, ++count);
  }
  return indexes;
}

function unitSizePrefix(record) {
  return record.unitSize?.current > 1 ? `${record.unitSize.current}x ` : "";
}

function formatHeaderLines(document, records) {
  const characterIndexes = characterIndexMap(records);
  const warlordIndex = characterIndexes.get(document.warlord?.instanceId);
  return [
    "+++++++++++++++++++++++++++++++++++++++++++++++",
    `+ FACTION KEYWORD: ${document.faction || forceName(document)}`,
    detachmentText(document) ? `+ DETACHMENT: ${detachmentText(document)}` : null,
    `+ TOTAL ARMY POINTS: ${document.totalPoints || 0}pts`,
    "+",
    document.warlord?.name
      ? `+ WARLORD: ${warlordIndex ? `Char${warlordIndex}: ` : ""}${document.warlord.name}`
      : null,
    (document.enhancements || []).length
      ? `+ ENHANCEMENT: ${(document.enhancements || []).map(item => `${item.name}${item.bearerName ? ` (on ${item.bearerName})` : ""}`).join("; ")}`
      : "+ ENHANCEMENT: ",
    `+ NUMBER OF UNITS: ${records.length}`,
    "+++++++++++++++++++++++++++++++++++++++++++++++"
  ].filter(Boolean);
}

function exportTournamentText(document, format) {
  const compact = format === "WTC-Compact" || format === "GW-Compact";
  const gw = format === "GW" || format === "GW-Compact";
  const records = sortedExportRecords(document);
  const enhancementsByBearer = enhancementBearerMap(document);
  const characterIndexes = characterIndexMap(records);
  const lines = formatHeaderLines(document, records);
  let currentCategory = null;

  for (const record of records) {
    const category = unitCategory(record);
    if (category !== currentCategory && !compact) {
      lines.push("", category);
      currentCategory = category;
    }
    const characterPrefix = characterIndexes.has(record.instanceId) ? `Char${characterIndexes.get(record.instanceId)}: ` : "";
    const points = gw ? `${record.points || 0} points` : `${record.points || 0} pts`;
    const base = `${characterPrefix}${unitSizePrefix(record)}${record.name} (${points})`;
    const wargear = wargearNames(record);
    const enhancements = enhancementsByBearer.get(record.instanceId) || [];
    const suffix = [
      ...enhancements.map(item => `Enhancement: ${item.name}${item.points ? ` (+${item.points} pts)` : ""}`),
      ...wargear
    ];

    if (compact) {
      lines.push(`${base}${suffix.length ? `: ${suffix.join(", ")}` : ""}`);
      continue;
    }

    lines.push(base);
    for (const item of enhancements) lines.push(`  • Enhancement: ${item.name}${item.points ? ` (+${item.points} pts)` : ""}`);
    for (const item of wargear) lines.push(`  • ${item}`);
  }

  return lines.join("\n");
}

function exportNrText(document) {
  const lines = [];
  lines.push(`${document.faction || forceName(document)} - ${document.name || "Roster"} - ${document.totalPoints || 0} pts`);
  if (detachmentText(document)) lines.push("", `# ++ ${detachmentText(document)} ++ ${document.totalPoints || 0} pts`);
  for (const record of sortedExportRecords(document)) {
    lines.push("", `## ${unitCategory(record)}`);
    lines.push(`${unitSizePrefix(record)}${record.name} ${record.points || 0} pts`);
    for (const enhancement of enhancementBearerMap(document).get(record.instanceId) || []) {
      lines.push(`- Enhancement: ${enhancement.name}${enhancement.points ? ` (${enhancement.points} pts)` : ""}`);
    }
    for (const item of wargearNames(record)) lines.push(`- ${item}`);
  }
  return lines.join("\n");
}

function exportRosterText(document, options = {}) {
  const exportOptions = typeof options === "string" ? { format: options } : (options || {});
  const format = exportOptions.format;
  if (format === "NR") return exportNrText(document);
  if (["WTC", "WTC-Compact", "GW", "GW-Compact"].includes(format)) return exportTournamentText(document, format);
  if (format === "DISCORD") return exportDiscordText(document, exportOptions);
  if (format === "DISCORD_COMPACT") return exportDiscordText(document, { ...exportOptions, compact: true });
  if (format === "DISCORD_COMPACT_FLAT") return exportDiscordText(document, { ...exportOptions, compact: true, hideSubunits: true });
  if (format === "DISCORD_COMPACT_COMBINED") return exportDiscordText(document, { ...exportOptions, compact: true, hideSubunits: true, combineIdentical: true });
  if (format === "DISCORD_EXTENDED_COMBINED") return exportDiscordText(document, { ...exportOptions, compact: false, hideSubunits: true, combineIdentical: true });

  const lines = [];
  lines.push(document.name || document.subfaction || document.faction || "Roster");
  if (document.name && (document.subfaction || document.faction)) lines.push(document.subfaction || document.faction);
  const detachmentNames = (document.detachments || []).map(item =>
    `${item.name}${item.detachmentPoints ? ` (${item.detachmentPoints}DP)` : ""}`
  );
  if (detachmentNames.length === 1) lines.push(`Detachment: ${detachmentNames[0]}`);
  else if (detachmentNames.length) lines.push(`Detachments: ${detachmentNames.join(", ")}`);
  else if (document.detachment?.name) lines.push(`Detachment: ${document.detachment.name}`);
  if (document.warlord?.name) lines.push(`Warlord: ${document.warlord.name}`);
  lines.push(`${document.totalPoints || 0} / ${document.pointsLimit || 0} pts`);

  if ((document.enhancements || []).length) {
    lines.push("");
    lines.push("Enhancements");
    for (const enhancement of document.enhancements) {
      lines.push(`- ${enhancement.name} -> ${enhancement.bearerName || enhancement.bearerInstanceId || "missing bearer"} (${enhancement.points || 0} pts)`);
    }
  }

  if ((document.validationWarnings || []).length) {
    lines.push("");
    lines.push("Warnings");
    for (const warning of document.validationWarnings) lines.push(`- ${warning.message}`);
  }

  lines.push("");
  lines.push("Units");
  const recordsById = new Map((document.rosterEntries || []).map(item => [item.instanceId, item]));
  const groups = document.groupedPresentation?.length
    ? document.groupedPresentation
    : (document.rosterEntries || []).map(item => ({
        kind: "unit",
        title: item.name,
        totalPoints: item.points,
        memberInstanceIds: [item.instanceId],
        warnings: []
      }));

  for (const group of groups) {
    lines.push(`${group.title} - ${group.totalPoints || 0} pts${group.kind === "attached" ? " (attached)" : ""}`);
    for (const warning of group.warnings || []) lines.push(`  WARNING: ${warning.message}`);
    for (const instanceId of group.memberInstanceIds || []) {
      const record = recordsById.get(instanceId);
      if (!record) continue;
      const size = record.unitSize?.current > 1 ? `${record.unitSize.current}x ` : "";
      lines.push(`  ${size}${record.name} - ${record.points || 0} pts`);
      if ((record.keywords || []).length) lines.push(`    Keywords: ${record.keywords.join(", ")}`);
      for (const line of weaponLines(record.configured, "    ")) lines.push(line);
    }
  }

  return stripMarkup(lines.join("\n"));
}

const api = {
  ROSTER_DOCUMENT_KIND,
  ROSTER_DOCUMENT_SCHEMA_VERSION,
  createRosterDocument,
  exportRosterText,
  hydrateRosterDocument
};

if (typeof module !== "undefined" && module.exports) module.exports = api;
if (typeof window !== "undefined") window.RosterDocument = api;
