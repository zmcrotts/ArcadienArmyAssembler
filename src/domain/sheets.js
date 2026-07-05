"use strict";

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function uniqueByName(items) {
  const seen = new Set();
  const result = [];
  for (const item of items || []) {
    const key = normalizeText(item?.name || item).toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function uniqueAbilities(items) {
  const seen = new Set();
  const result = [];
  for (const item of items || []) {
    const key = [
      normalizeText(item?.provider || item?.providerUnitName).toLowerCase(),
      normalizeText(item?.name).toLowerCase()
    ].join(":");
    if (!normalizeText(item?.name) || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function configuredFor(record) {
  return record?.configured || {};
}

function unitProfiles(record) {
  return asArray(configuredFor(record).units);
}

function weaponsFor(record, typeName) {
  return asArray(configuredFor(record).weapons)
    .filter(item => !typeName || item.typeName === typeName)
    .map(normalizeWeapon);
}

function weaponKeywordNames(record) {
  const keywords = new Set();
  for (const weapon of [
    ...weaponsFor(record, "Ranged Weapons"),
    ...weaponsFor(record, "Melee Weapons")
  ]) {
    for (const keyword of String(weapon.keywords || "").split(",")) {
      const normalized = normalizeText(keyword).toLowerCase();
      if (normalized && normalized !== "-") keywords.add(normalized);
    }
  }
  return keywords;
}

function weaponKeywordRuleNames() {
  return new Set([
    "anti",
    "assault",
    "blast",
    "close-quarters",
    "devastating wounds",
    "extra attacks",
    "hazardous",
    "heavy",
    "ignores cover",
    "indirect fire",
    "lethal hits",
    "one shot",
    "pistol",
    "precision",
    "rapid fire",
    "sustained hits",
    "torrent",
    "twin-linked"
  ]);
}

function normalizeWeapon(weapon) {
  const characteristics = clone(weapon?.characteristics || {});
  const keywords = characteristics.Keywords ?? characteristics.keywords ?? "";
  return {
    ...clone(weapon),
    characteristics,
    keywords: abbreviateWeaponKeywords(keywords)
  };
}

function abbreviateWeaponKeywords(value) {
  return abbreviateWeaponKeywordEntries(value).map(item => item.keyword).join(", ");
}

function abbreviateWeaponKeywordEntries(value) {
  const text = normalizeText(value);
  if (!text || text === "-") return [];
  return text.split(",").map(abbreviateWeaponKeywordEntry).filter(item => item.keyword);
}

function abbreviateWeaponKeywordEntry(value) {
  const keyword = normalizeText(value).replace(/\s*-\s*/g, "-");
  if (!keyword || keyword === "-") return { keyword: "", original: "" };

  const anti = keyword.match(/^Anti-([A-Za-z][A-Za-z\s-]*?)\s+(\d+\+)$/i);
  if (anti) return { keyword: `A${antiTargetAbbreviation(anti[1])}${anti[2]}`, original: keyword };

  const rapidFire = keyword.match(/^Rapid\s+Fire\s+(\d+)$/i);
  if (rapidFire) return { keyword: `RF${rapidFire[1]}`, original: keyword };

  const sustainedHits = keyword.match(/^Sustained\s+Hits\s+(\d+)$/i);
  if (sustainedHits) return { keyword: `SH${sustainedHits[1]}`, original: keyword };

  const direct = new Map([
    ["close-quarters", "CQ"],
    ["devastating wounds", "DEV"],
    ["extra attacks", "EA"],
    ["hazardous", "HAZ"],
    ["ignores cover", "IgCover"],
    ["indirect fire", "Indirect"],
    ["lethal hits", "LH"],
    ["one shot", "OneShot"],
    ["twin-linked", "TL"]
  ]);
  const abbreviated = direct.get(keyword.toLowerCase()) || keyword;
  return {
    keyword: abbreviated,
    original: abbreviated === keyword ? "" : keyword
  };
}

function antiTargetAbbreviation(value) {
  const target = normalizeText(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const known = new Map([
    ["aircraft", "Air"],
    ["beast", "Bea"],
    ["character", "Cha"],
    ["chaos", "Cha"],
    ["daemon", "Dae"],
    ["epic hero", "Epic"],
    ["fly", "Fly"],
    ["infantry", "Inf"],
    ["imperium", "Imp"],
    ["monster", "Mon"],
    ["mounted", "Mtd"],
    ["psyker", "Psy"],
    ["titanic", "Tit"],
    ["vehicle", "Veh"]
  ]);
  if (known.has(target)) return known.get(target);
  const compact = target.replace(/[^a-z0-9]/g, "");
  return compact ? compact.slice(0, 3).replace(/^[a-z]/, char => char.toUpperCase()) : "";
}

function abilitiesFor(record) {
  return asArray(configuredFor(record).abilities)
    .map(item => ({
      id: item.id,
      name: item.name,
      description: item.characteristics?.Description || item.description || "",
      providerUnitName: record?.name || "Unit",
      provider: abilityProviderName(record, item)
    }))
    .filter(sheetRelevantAbility);
}

function abilityProviderName(record, ability) {
  const unitNames = unitProfiles(record).map(profile => normalizeText(profile.name)).filter(Boolean);
  const haystack = `${ability?.name || ""} ${ability?.characteristics?.Description || ability?.description || ""}`.toLowerCase();
  const named = unitNames.find(name => haystack.includes(name.toLowerCase()));
  if (named) return named;
  if (unitNames.length === 1) return unitNames[0];
  return record?.name || "Unit";
}

function sheetRelevantAbility(item) {
  const name = normalizeText(item?.name);
  const normalizedName = name.toLowerCase();
  if (!normalizedName) return false;
  if (["leader", "bodyguard"].includes(normalizedName)) return false;
  return true;
}

function statlinesForRecord(record, enhancements = []) {
  const inferredInSv = inferredInvulnerableSave(record, enhancements);
  return unitProfiles(record).map(profile => {
    const characteristics = clone(profile.characteristics || {});
    const current = invulnerableSaveValue(characteristics);
    const best = bestSave(current, inferredInSv);
    if (best) {
      characteristics.InSv = best;
      if (characteristics["Invulnerable Save"] !== undefined) characteristics["Invulnerable Save"] = best;
    }
    return {
      name: profile.name,
      count: profile.count || 1,
      characteristics
    };
  });
}

function inferredInvulnerableSave(record, enhancements = []) {
  const texts = [
    ...asArray(configuredFor(record).abilities).flatMap(effectTextParts),
    ...asArray(configuredFor(record).rules).flatMap(effectTextParts),
    ...asArray(configuredFor(record).profiles).flatMap(effectTextParts),
    ...asArray(enhancements).flatMap(effectTextParts)
  ];
  return bestSave("", ...texts.map(extractInvulnerableSave).filter(Boolean));
}

function effectTextParts(item) {
  return [
    item?.name,
    item?.description,
    item?.characteristics?.Description,
    ...(item?.profiles || []).flatMap(effectTextParts),
    ...(item?.rules || []).flatMap(effectTextParts)
  ].filter(Boolean);
}

function invulnerableSaveValue(characteristics = {}) {
  const value = normalizeText(characteristics.InSv || characteristics["Invulnerable Save"]);
  return value && value !== "-" ? value : "";
}

function extractInvulnerableSave(text) {
  const normalized = normalizeText(text);
  const match = normalized.match(/\b([2-6]\+)\s*(?:\*\*)?\s*(?:InSv|invulnerable\s+save)\b/i)
    || normalized.match(/\b(?:InSv|invulnerable\s+save)\s*(?:of|:)?\s*(?:\*\*)?\s*([2-6]\+)/i);
  return match ? match[1] : "";
}

function bestSave(...values) {
  return values
    .map(value => normalizeText(value))
    .filter(value => /^[2-6]\+$/.test(value))
    .sort((left, right) => Number.parseInt(left, 10) - Number.parseInt(right, 10))[0] || "";
}

function rulesTagsFor(record) {
  const weaponKeywords = weaponKeywordNames(record);
  return asArray(configuredFor(record).rules)
    .map(rule => compactRuleTag(rule, weaponKeywords))
    .filter(Boolean);
}

function compactRuleTag(rule, weaponKeywords = new Set()) {
  const name = normalizeText(rule?.name || rule);
  if (!name) return "";
  const normalized = name.toLowerCase();
  if (["leader", "bodyguard"].includes(normalized)) return "";
  if (isWeaponKeywordRule(name, weaponKeywords)) return "";

  const text = normalizeText(`${name} ${rule?.description || rule?.characteristics?.Description || ""}`);
  if (/feel\s+no\s+pain/i.test(text)) return appendRuleValue("FNP", extractSaveValue(text));
  if (/invulnerable(?:\s+save)?/i.test(text)) return appendRuleValue("Inv", extractSaveValue(text));
  if (/\bscouts?\b/i.test(text)) return appendRuleValue("Scouts", extractDistanceValue(text));
  if (/deadly\s+demise/i.test(text)) return appendRuleValue("Deadly Demise", extractDeadlyDemiseValue(text));

  const direct = new Map([
    ["deep strike", "Deep Strike"],
    ["fights first", "Fights First"],
    ["fight first", "Fights First"],
    ["infiltrators", "Infiltrators"],
    ["lone operative", "Lone Op"],
    ["stealth", "Stealth"]
  ]);
  return direct.get(normalized) || name;
}

function appendRuleValue(label, value) {
  return value ? `${label} ${value}` : label;
}

function extractSaveValue(text) {
  const match = normalizeText(text).match(/\b([2-6]\+)/);
  return match ? match[1] : "";
}

function extractDistanceValue(text) {
  const match = normalizeText(text).match(/\b([1-9]\d*)\s*(?:"|&quot;|inches?\b)/i);
  return match ? `${match[1]}"` : "";
}

function extractDeadlyDemiseValue(text) {
  const match = normalizeText(text).match(/deadly\s+demise\s+((?:d\d+|\d+)(?:\+\d+)?)/i);
  return match ? match[1].toUpperCase() : "";
}

function isWeaponKeywordRule(name, weaponKeywords = new Set()) {
  const normalized = normalizeText(name).toLowerCase();
  const base = normalized
    .replace(/\s+\d+\+?$/, "")
    .replace(/^anti-[a-z0-9\s-]+$/, "anti");
  if (weaponKeywords.has(normalized)) return true;
  if (weaponKeywordRuleNames().has(base)) return true;
  if (/^anti-[a-z0-9\s-]+\s+\d+\+$/i.test(normalized)) return true;
  if (/^rapid\s+fire\s+\d+$/i.test(normalized)) return true;
  if (/^sustained\s+hits\s+\d+$/i.test(normalized)) return true;
  return false;
}

function enhancementRecords(document, memberIds) {
  const ids = new Set(memberIds);
  return asArray(document?.enhancements).filter(item => ids.has(item.bearerInstanceId));
}

function enhancementPointsFor(document, instanceId) {
  return asArray(document?.enhancements)
    .filter(item => item.bearerInstanceId === instanceId)
    .reduce((sum, item) => sum + Number(item.points || 0), 0);
}

function groupRecords(document, group) {
  const byId = new Map(asArray(document?.rosterEntries).map(item => [item.instanceId, item]));
  return asArray(group?.memberInstanceIds).map(id => byId.get(id)).filter(Boolean);
}

function fallbackGroups(document) {
  return asArray(document?.rosterEntries).map(item => ({
    id: item.instanceId,
    kind: "unit",
    title: item.name,
    totalPoints: item.points,
    memberInstanceIds: [item.instanceId],
    warnings: []
  }));
}

function buildCombinedUnitSheet(document, group) {
  const records = groupRecords(document, group);
  const memberIds = asArray(group.memberInstanceIds);
  const keywords = uniqueByName(records.flatMap(item => asArray(item.keywords))).map(String);
  const basePoints = Number(group.basePoints ?? records.reduce((sum, item) => sum + Number(item.points || 0), 0));
  const enhancementPoints = Number(group.enhancementPoints ?? memberIds.reduce((sum, instanceId) => sum + enhancementPointsFor(document, instanceId), 0));
  const enhancementsByBearer = new Map(memberIds.map(instanceId => [instanceId, enhancementRecords(document, [instanceId])]));

  return {
    id: group.id,
    kind: group.kind === "attached" ? "combined-unit" : "unit",
    title: group.title || records.map(item => item.name).join(" + ") || "Unit",
    totalPoints: Number(group.totalPoints ?? basePoints + enhancementPoints),
    basePoints,
    enhancementPoints,
    memberInstanceIds: memberIds,
    members: records.map(item => ({
      instanceId: item.instanceId,
      name: item.name,
      points: Number(item.points || 0),
      enhancementPoints: enhancementPointsFor(document, item.instanceId),
      totalPoints: Number(item.points || 0) + enhancementPointsFor(document, item.instanceId),
      unitSize: clone(item.unitSize),
      keywords: clone(item.keywords || [])
    })),
    statlines: records.flatMap(record => statlinesForRecord(record, enhancementsByBearer.get(record.instanceId))),
    rangedWeapons: records.flatMap(item => weaponsFor(item, "Ranged Weapons")).map(clone),
    meleeWeapons: records.flatMap(item => weaponsFor(item, "Melee Weapons")).map(clone),
    abilities: uniqueAbilities(records.flatMap(abilitiesFor)),
    rulesTags: uniqueByName(records.flatMap(rulesTagsFor)).map(String),
    keywords,
    enhancements: enhancementRecords(document, memberIds).map(clone),
    warnings: []
  };
}

function sheetReferenceSignature(sheet) {
  return JSON.stringify({
    kind: sheet.kind,
    title: sheet.title,
    totalPoints: sheet.totalPoints,
    basePoints: sheet.basePoints,
    enhancementPoints: sheet.enhancementPoints,
    members: asArray(sheet.members).map(member => ({
      name: member.name,
      points: member.points,
      enhancementPoints: member.enhancementPoints,
      totalPoints: member.totalPoints,
      unitSize: member.unitSize,
      keywords: member.keywords
    })),
    statlines: sheet.statlines,
    rangedWeapons: sheet.rangedWeapons,
    meleeWeapons: sheet.meleeWeapons,
    abilities: sheet.abilities,
    rulesTags: sheet.rulesTags,
    keywords: sheet.keywords,
    enhancements: asArray(sheet.enhancements).map(enhancement => ({
      name: enhancement.name,
      points: enhancement.points,
      bearerName: enhancement.bearerName,
      description: enhancement.description,
      profiles: enhancement.profiles,
      rules: enhancement.rules
    }))
  });
}

function uniqueReferenceSheets(sheets) {
  const seen = new Set();
  const result = [];
  for (const sheet of sheets) {
    const signature = sheetReferenceSignature(sheet);
    if (seen.has(signature)) continue;
    seen.add(signature);
    result.push(sheet);
  }
  return result;
}

function buildCrusadeSheet(document, record) {
  const profile = statlinesForRecord(record, enhancementRecords(document, [record.instanceId]))[0] || {};
  return {
    id: `crusade:${record.instanceId}`,
    kind: "crusade-unit",
    unitInstanceId: record.instanceId,
    unitName: record.name,
    points: Number(record.points || 0),
    keywords: clone(record.keywords || []),
    unitSize: clone(record.unitSize),
    statline: {
      name: profile.name || record.name,
      characteristics: clone(profile.characteristics || {})
    },
    equipment: [
      ...weaponsFor(record, "Ranged Weapons"),
      ...weaponsFor(record, "Melee Weapons")
    ].map(item => `${item.count || 1}x ${item.name}${item.keywords ? ` [${item.keywords}]` : ""}`),
    abilities: uniqueAbilities(abilitiesFor(record)),
    rulesTags: uniqueByName(rulesTagsFor(record)).map(String),
    crusade: {
      crusadePoints: "",
      experiencePoints: "",
      rank: "",
      battlesPlayed: "",
      battlesSurvived: "",
      unitsDestroyed: "",
      battleHonours: "",
      battleScars: "",
      notes: ""
    }
  };
}

function stratagemRecords(document) {
  const detachments = asArray(document?.detachments);
  const detachmentStratagems = detachments.flatMap(detachment =>
    asArray(detachment.stratagems).map(stratagem => ({
      ...clone(stratagem),
      detachmentName: detachment.name,
      sourceLabel: detachment.name || stratagem.detachment || "Detachment"
    }))
  );
  const coreStratagems = asArray(document?.coreStratagems).map(stratagem => ({
    ...clone(stratagem),
    sourceLabel: "Core"
  }));
  return { coreStratagems, detachmentStratagems };
}

function buildReferenceSheets(document) {
  const legend = weaponKeywordLegend(document);
  const detachments = asArray(document?.detachments).map(detachment => ({
    id: detachment.id,
    name: detachment.name,
    detachmentPoints: Number(detachment.detachmentPoints || 0),
    rules: asArray(detachment.rules).filter(rule => sheetRelevantReferenceRule(rule, legend)).map(clone),
    stratagems: asArray(detachment.stratagems).map(stratagem => ({
      ...clone(stratagem),
      detachmentName: detachment.name,
      sourceLabel: detachment.name || stratagem.detachment || "Detachment"
    }))
  }));
  const { coreStratagems } = stratagemRecords(document);
  return {
    rules: {
      id: "reference:rules",
      kind: "rules-reference",
      title: "Army & Detachment Rules",
      armyRules: asArray(document?.armyRules).filter(rule => sheetRelevantReferenceRule(rule, legend)).map(clone),
      weaponKeywordLegend: legend,
      detachments
    },
    stratagems: {
      id: "reference:stratagems",
      kind: "stratagem-reference",
      title: "Core Stratagems",
      source: clone(document?.stratagemSource || null),
      coreStratagems
    }
  };
}

function sheetRelevantReferenceRule(rule, legend = []) {
  const name = normalizeText(rule?.name || rule).toLowerCase();
  if (!name) return false;
  const glossaryNames = weaponKeywordRuleNames();
  for (const item of legend) glossaryNames.add(normalizeText(item.original).toLowerCase().replace(/\s+\d+\+?$/, ""));
  const normalized = name.replace(/\s+\d+\+?$/, "");
  if (glossaryNames.has(normalized)) return false;
  if (/^anti-[a-z0-9\s-]+\s+\d+\+$/i.test(name)) return false;
  if (/^rapid\s+fire\s+\d+$/i.test(name)) return false;
  if (/^sustained\s+hits\s+\d+$/i.test(name)) return false;
  return true;
}

function weaponKeywordLegend(document) {
  const entries = new Map();
  for (const record of asArray(document?.rosterEntries)) {
    for (const weapon of asArray(configuredFor(record).weapons)) {
      const characteristics = weapon?.characteristics || {};
      const keywords = characteristics.Keywords ?? characteristics.keywords ?? "";
      for (const item of abbreviateWeaponKeywordEntries(keywords)) {
        if (item.original && !entries.has(item.keyword)) entries.set(item.keyword, item.original);
      }
    }
  }
  return [...entries.entries()].map(([keyword, original]) => ({ keyword, original }));
}

function buildRosterSheets(document) {
  const groups = asArray(document?.groupedPresentation).length
    ? asArray(document.groupedPresentation)
    : fallbackGroups(document);
  const combinedUnitSheets = groups.map(group => buildCombinedUnitSheet(document, group));

  return {
    kind: "roster-engine.printableSheets",
    schemaVersion: 1,
    rosterName: document?.name || document?.subfaction || document?.faction || "Roster",
    faction: document?.faction || null,
    subfaction: document?.subfaction || null,
    pointsLimit: Number(document?.pointsLimit || 0),
    totalPoints: Number(document?.totalPoints || 0),
    detachments: clone(document?.detachments || []),
    referenceSheets: buildReferenceSheets(document),
    combinedUnitSheets: uniqueReferenceSheets(combinedUnitSheets),
    crusadeSheets: asArray(document?.rosterEntries).map(record => buildCrusadeSheet(document, record))
  };
}

const sheetsApi = { buildRosterSheets };

if (typeof module !== "undefined" && module.exports) module.exports = sheetsApi;
if (typeof window !== "undefined") window.RosterSheets = sheetsApi;
