"use strict";

function normalizeName(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

const KEYWORD_GRANT_CORRECTIONS = [
  { faction: "Xenos - Orks", detachment: "Rollin' Deff", keyword: "Wagon", names: ["Battlewagon", "Hunta Rig", "Kill Rig"], categoryName: "Wagon" },
  { faction: "Xenos - Tyranids", detachment: "Warrior Bioform Onslaught", keyword: "Tyranid Warriors", names: ["Tyranid Warriors with Melee Bio-weapons", "Tyranid Warriors with Ranged Bio-weapons"] },
  { faction: "Xenos - Tyranids", detachment: "Warrior Bioform Onslaught", keyword: "Battleline", names: ["Tyranid Warriors with Melee Bio-weapons", "Tyranid Warriors with Ranged Bio-weapons"] },
  { faction: "Xenos - Aeldari", detachment: "Devoted of Ynnead", keyword: "Ynnari", anyKeywords: ["Asuryani"], excludeRoles: ["epicHero"] },
  { faction: "Chaos - Chaos Space Marines", detachment: "Cult of the Arkifane", keyword: "Daemon", anyKeywords: ["Vehicle"] },
  { faction: "Chaos - Chaos Space Marines", detachment: "Cult of the Arkifane", keyword: "Soul Forge", anyKeywords: ["Vehicle"], names: ["Lord Discordant on Helstalker", "Vashtorr the Arkifane"], matchEither: true },
  { faction: "Chaos - Death Guard", detachment: "Contagion Engines", keyword: "Contagion Engine", nameIncludes: ["Foetid Bloat-drone", "Helbrute", "Myphitic Blight-hauler"] },
  { faction: "Chaos - Thousand Sons", detachment: "Servants of Change", keyword: "Battleline", nameIncludes: ["Tzaangor"] },
  { faction: "Chaos - World Eaters", detachment: "Cult of Blood", keyword: "Battleline", names: ["Jakhals", "Goremongers"] },
  { faction: "Xenos - Genestealer Cults", detachment: "Heroes of the Uprising", keyword: "Killer", names: ["Kelermorph", "Locus", "Reductus Saboteur", "Sanctus"] },
  { faction: "Imperium - Adeptus Mechanicus", detachment: "Cohort Acquisitus", keyword: "Recon Augury", nameIncludes: ["Pteraxii", "Infiltrator", "Rangers", "Serberys Raiders", "Serberys Sulphurhounds"] },
  { faction: "Imperium - Astra Militarum", detachment: "Abhuman Auxiliaries", keyword: "Abhuman", nameIncludes: ["Bullgryn", "Ogryn", "Ratlings"] },
  { factionPrefix: "Imperium - Adeptus Astartes", detachment: "Fulguris Task Force", keyword: "Speeder", nameIncludes: ["Land Speeder", "Storm Speeder Hailstrike", "Storm Speeder Hammerstrike", "Storm Speeder Thunderstrike"] },
  { factionPrefix: "Imperium - Adeptus Astartes", detachment: "Armoured Speartip", keyword: "Heavy Transport", anyKeywords: ["Transport"], minimumWounds: 14 }
];

function unitWounds(unit) {
  const values = [];
  function visit(node) {
    if (!node) return;
    for (const profile of node.profiles || []) {
      if (profile.typeName !== "Unit") continue;
      const value = Number(String(profile.characteristics?.W || "").replace(/[^0-9.]/g, ""));
      if (Number.isFinite(value)) values.push(value);
    }
    for (const child of node.children || []) visit(child);
  }
  visit(unit?.selectionTree);
  return values.length ? Math.max(...values) : 0;
}

function factionMatches(unitFaction, correction) {
  if (correction.faction) return unitFaction === correction.faction;
  return Boolean(correction.factionPrefix && String(unitFaction || "").startsWith(correction.factionPrefix));
}

function unitMatchesCorrection(unit, correction) {
  if (!factionMatches(unit?.faction, correction)) return false;
  const name = normalizeName(unit?.name);
  const keywords = new Set((unit?.keywords || unit?.categories || []).map(normalizeName));
  const nameMatch = (correction.names || []).some(item => name === normalizeName(item))
    || (correction.nameIncludes || []).some(item => name.includes(normalizeName(item)));
  const keywordMatch = (correction.anyKeywords || []).some(item => keywords.has(normalizeName(item)));
  const hasNamedMatcher = Boolean((correction.names || []).length || (correction.nameIncludes || []).length);
  const hasKeywordMatcher = Boolean((correction.anyKeywords || []).length);
  const targetMatches = correction.matchEither
    ? nameMatch || keywordMatch
    : (!hasNamedMatcher || nameMatch) && (!hasKeywordMatcher || keywordMatch);
  if (!targetMatches) return false;
  if ((correction.excludeRoles || []).some(role => unit?.roles?.[role])) return false;
  if (correction.minimumWounds && unitWounds(unit) < correction.minimumWounds) return false;
  return true;
}

function findDetachmentId(armies, correction) {
  const army = (armies || []).find(item => correction.faction
    ? item.faction === correction.faction
    : String(item.faction || "").startsWith(correction.factionPrefix || ""));
  return army?.detachments?.find(item => normalizeName(item.name) === normalizeName(correction.detachment))?.id || null;
}

function applyDetachmentKeywordCorrections(units, armies) {
  return (units || []).map(unit => {
    const additions = [];
    for (const correction of KEYWORD_GRANT_CORRECTIONS) {
      if (!unitMatchesCorrection(unit, correction)) continue;
      const detachmentId = findDetachmentId(armies.filter(army => army.faction === unit.faction), correction);
      if (!detachmentId) continue;
      additions.push({
        keyword: correction.keyword,
        detachmentIds: [detachmentId],
        source: "detachment-rule-correction"
      });
    }
    const byKey = new Map([...(unit.conditionalKeywords || []), ...additions]
      .flatMap(grant => (grant.detachmentIds || []).map(detachmentId => [
        `${normalizeName(grant.keyword)}|${detachmentId}`,
        { ...grant, detachmentIds: [detachmentId] }
      ])));
    return { ...unit, conditionalKeywords: [...byKey.values()] };
  });
}

function supplementalCategoryNamesFor(faction, unitName) {
  return KEYWORD_GRANT_CORRECTIONS
    .filter(item => item.categoryName && factionMatches(faction, item) && (item.names || []).some(name => normalizeName(name) === normalizeName(unitName)))
    .map(item => item.categoryName);
}

module.exports = {
  KEYWORD_GRANT_CORRECTIONS,
  applyDetachmentKeywordCorrections,
  supplementalCategoryNamesFor,
  unitMatchesCorrection
};
