"use strict";

const fs = require("fs");

function normalizeName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/armour/g, "armor")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function localFactionAliases(faction) {
  const raw = String(faction || "");
  const withoutAlliance = raw
    .replace(/^Imperium - /, "")
    .replace(/^Chaos - /, "")
    .replace(/^Xenos - /, "")
    .replace(/^Aeldari - /, "")
    .replace(/^Library - /, "");
  const withoutAstartes = withoutAlliance.replace(/^Adeptus Astartes - /, "");
  const aliases = new Set([raw, withoutAlliance, withoutAstartes]);
  if (/^Adeptus Astartes - /.test(withoutAlliance)) aliases.add("Space Marines");

  if (withoutAlliance === "Agents of the Imperium") aliases.add("Imperial Agents");
  if (withoutAlliance === "Adeptus Titanicus") aliases.add("Titan Legions");
  if (withoutAlliance === "Titanicus Traitoris") aliases.add("Chaos Titan Legions");
  if (withoutAlliance === "Titans") aliases.add("Titan Legions");
  if (withoutAlliance === "Daemons Library") aliases.add("Chaos Daemons");
  if (withoutAlliance === "Aeldari Library") aliases.add("Aeldari");

  return [...aliases].map(normalizeName).filter(Boolean);
}

function readMfmAttachments(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return { source: null, factions: [] };
  }
  const payload = JSON.parse(fs.readFileSync(filePath, "utf8"));
  return {
    source: payload.source || null,
    generatedAt: payload.generatedAt || null,
    factions: Array.isArray(payload.factions) ? payload.factions : []
  };
}

function buildRecordLookup(payload) {
  const byFaction = new Map();
  for (const faction of payload.factions || []) {
    const factionKey = normalizeName(faction.name);
    if (!factionKey) continue;
    const records = new Map();
    for (const record of faction.attachments || []) {
      const unitKey = normalizeName(record.unitName);
      if (!unitKey || !["LEADER", "SUPPORT"].includes(record.role)) continue;
      const existing = records.get(unitKey);
      const targets = Array.isArray(record.targets) ? record.targets.filter(Boolean) : [];
      if (existing) {
        existing.role = existing.role === "SUPPORT" || record.role === "SUPPORT" ? "SUPPORT" : "LEADER";
        existing.targets = [...new Set([...existing.targets, ...targets])];
        continue;
      }
      records.set(unitKey, {
        unitName: record.unitName,
        role: record.role,
        targets,
        sourceUrl: faction.url || null,
        sourceFaction: faction.name
      });
    }
    byFaction.set(factionKey, records);
  }
  return byFaction;
}

function resolveLeaderTargetSelectionKeys(definitions) {
  const knownKeywords = new Set(definitions.flatMap(definition =>
    [...(definition.categories || []), ...(definition.keywords || [])].map(normalizeName)
  ).filter(Boolean));
  let predicateCount = 0;
  let unresolvedCount = 0;

  function keywordPredicateFor(targetName) {
    const keywords = normalizeName(targetName).split(/\s+/).filter(Boolean);
    if (keywords.length < 2 || !keywords.every(keyword => knownKeywords.has(keyword))) return null;
    return { kind: "keywords-all", keywords, label: targetName, source: "mfm-attachment" };
  }

  for (const definition of definitions) {
    const candidates = definitions.filter(candidate => candidate.faction === definition.faction);
    const candidateNames = new Set(candidates.map(candidate => normalizeName(candidate.name)));
    const declaredTargets = [...new Set(definition.rosterRules.leaderTargetNames || [])];
    const targetNames = declaredTargets.filter(name => candidateNames.has(normalizeName(name)));
    const inferredPredicates = declaredTargets
      .filter(name => !candidateNames.has(normalizeName(name)))
      .map(keywordPredicateFor)
      .filter(Boolean);
    predicateCount += inferredPredicates.length;
    unresolvedCount += declaredTargets.length - targetNames.length - inferredPredicates.length;
    const targets = new Set(targetNames.map(normalizeName));
    definition.rosterRules.leaderTargetNames = targetNames;
    definition.rosterRules.leaderTargetSelectionKeys = candidates
      .filter(candidate => targets.has(normalizeName(candidate.name)))
      .map(candidate => candidate.selectionKey);
    definition.rosterRules.leaderTargetPredicates = [...new Map([
      ...(definition.rosterRules.leaderTargetPredicates || []),
      ...inferredPredicates
    ].map(predicate => [JSON.stringify(predicate), predicate])).values()];
    definition.roles.leader = definition.rosterRules.leaderTargetSelectionKeys.length > 0
      || definition.rosterRules.leaderTargetPredicates.length > 0;
  }
  return { predicateCount, unresolvedCount };
}

function applyMfmAttachments(definitions, payload) {
  const byFaction = buildRecordLookup(payload);
  let matched = 0;
  let unmatched = 0;

  for (const definition of definitions) {
    const factionRecords = localFactionAliases(definition.faction)
      .map(alias => byFaction.get(alias))
      .find(Boolean);
    if (!factionRecords) continue;

    const record = factionRecords.get(normalizeName(definition.name));
    if (!record) continue;

    const targets = [...new Set(record.targets)];
    definition.roles = {
      ...(definition.roles || {}),
      leader: targets.length > 0,
      support: record.role === "SUPPORT"
    };
    definition.rosterRules = {
      ...(definition.rosterRules || {}),
      leaderTargetNames: targets,
      leaderTargetSelectionKeys: [],
      leaderTargetPredicates: [],
      allowsAdditionalLeader: record.role === "SUPPORT"
        ? true
        : Boolean(definition.rosterRules?.allowsAdditionalLeader),
      mfmAttachmentRole: record.role,
      mfmAttachmentSource: record.sourceUrl
    };
    const categories = definition.categories || [];
    const keywords = definition.keywords || categories;
    if (record.role === "SUPPORT" && !categories.includes("Support")) {
      definition.categories = [...categories, "Support"];
      definition.keywords = [...keywords, "Support"];
    }
    matched += 1;
  }

  for (const faction of payload.factions || []) {
    const localDefinitions = definitions.filter(definition =>
      localFactionAliases(definition.faction).includes(normalizeName(faction.name))
    );
    const localNames = new Set(localDefinitions.map(definition => normalizeName(definition.name)));
    unmatched += (faction.attachments || []).filter(record => !localNames.has(normalizeName(record.unitName))).length;
  }

  const targetSummary = resolveLeaderTargetSelectionKeys(definitions);
  return { definitions, summary: { matched, unmatched, ...targetSummary } };
}

module.exports = {
  applyMfmAttachments,
  readMfmAttachments
};
