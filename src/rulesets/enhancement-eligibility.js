"use strict";

const GENERIC_TYPE_TAGS = new Set([
  "aircraft", "battleline", "battlesuit", "beast", "character", "fly",
  "fortification", "infantry", "mounted", "monster", "psyker", "swarm",
  "terminator", "transport", "vehicle", "walker"
]);

function normalize(value) {
  return String(value || "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\badpetus\b/g, "adeptus")
    .replace(/\s+/g, " ")
    .trim();
}

function singular(value) {
  const words = normalize(value).split(" ");
  const last = words.at(-1) || "";
  if (last.endsWith("ies") && last.length > 3) words[words.length - 1] = `${last.slice(0, -3)}y`;
  else if (last.endsWith("sses")) words[words.length - 1] = last.slice(0, -2);
  else if (last.endsWith("s") && !last.endsWith("ss")) words[words.length - 1] = last.slice(0, -1);
  return words.join(" ");
}

function plainDescription(enhancement) {
  return [
    ...(enhancement.profiles || []).map(profile => profile.characteristics?.Description),
    ...(enhancement.rules || []).map(rule => rule.description)
  ]
    .filter(Boolean)
    .join(" ")
    .replace(/<[^>]+>/g, " ")
    .replace(/[*^]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function explicitLimiter(enhancement) {
  const description = plainDescription(enhancement);
  return description.match(/^(.{1,240}?\b(?:models?|units?)\s+only(?:\s*\([^)]*\))?\.)/i)?.[1] || null;
}

function addTag(tags, value) {
  const normalized = normalize(value).replace(/^faction /, "");
  if (!normalized) return;
  tags.add(normalized);
  tags.add(singular(normalized));
}

function collectTreeTags(node, tags) {
  if (!node) return;
  if (node.kind === "unit" || node.kind === "model") {
    addTag(tags, node.name);
    for (const category of node.categories || []) addTag(tags, category);
    for (const profile of node.profiles || []) addTag(tags, profile.name);
  }
  for (const child of node.children || []) collectTreeTags(child, tags);
}

function tagsForUnit(unit, detachmentId, army = null) {
  const tags = new Set();
  addTag(tags, unit.name);
  for (const keyword of unit.keywords || unit.categories || []) addTag(tags, keyword);
  if (army && unit.source?.importedAsFaction === army.faction) {
    addTag(tags, army.faction.split(" - ").at(-1));
  }
  for (const grant of unit.conditionalKeywords || []) {
    if ((grant.detachmentIds || []).includes(detachmentId)) addTag(tags, grant.keyword);
  }
  collectTreeTags(unit.selectionTree, tags);
  return tags;
}

function selectableBlessingTagsForUnit(unit) {
  const tags = new Set();
  if (!/daemon prince/i.test(String(unit?.name || ""))) return tags;
  function visit(node) {
    if (!node) return;
    if (["god blessing", "mark of chaos"].includes(normalize(node.name))) {
      for (const child of node.children || []) addTag(tags, child.name);
    }
    for (const child of node.children || []) visit(child);
  }
  visit(unit.selectionTree);
  return tags;
}

function wordsSegmentedByTags(phrase, tags) {
  const words = normalize(phrase).split(" ").filter(Boolean);
  const memo = new Map();
  function visit(index) {
    if (index === words.length) return true;
    if (memo.has(index)) return memo.get(index);
    for (let end = words.length; end > index; end -= 1) {
      const candidate = words.slice(index, end).join(" ");
      if ((tags.has(candidate) || tags.has(singular(candidate))) && visit(end)) {
        memo.set(index, true);
        return true;
      }
    }
    memo.set(index, false);
    return false;
  }
  return words.length > 0 && visit(0);
}

function alternativesFor(subject) {
  const commaOrParts = String(subject || "")
    .replace(/^friendly\s+/i, "")
    .split(/\s*,\s*|\s+or\s+/i)
    .map(part => part.trim())
    .filter(Boolean);
  const alternatives = [];
  for (const part of commaOrParts) {
    if (!part.includes("/")) {
      alternatives.push(part);
      continue;
    }
    const slashParts = part.split("/").map(value => value.trim()).filter(Boolean);
    for (const slashPart of slashParts) alternatives.push(slashPart);
    if (slashParts.length === 2) {
      const left = normalize(slashParts[0]);
      const rightWords = slashParts[1].split(/\s+/);
      if (rightWords.length > 1 && GENERIC_TYPE_TAGS.has(left)) {
        alternatives.push(`${slashParts[0]} ${rightWords.slice(1).join(" ")}`);
      }
    }
  }
  return [...new Set(alternatives)];
}

function phraseMatchesTags(phrase, tags) {
  const alternatives = alternativesFor(phrase);
  const sharedSuffixAlternatives = alternatives.filter(option => {
    const words = normalize(option).split(" ");
    return !GENERIC_TYPE_TAGS.has(words[0]) || words.length > 1;
  });
  return (sharedSuffixAlternatives.length ? sharedSuffixAlternatives : alternatives)
    .some(option => wordsSegmentedByTags(option, tags));
}

function limiterMatchesUnit(limiter, unit, detachmentId, army = null) {
  const match = String(limiter || "").match(/^(.+?)\s+(?:models?|units?)\s+only(?:\s*\(([^)]*)\))?\./i);
  if (!match) return true;
  const tags = tagsForUnit(unit, detachmentId, army);
  if (!phraseMatchesTags(match[1], tags)
    && !phraseMatchesTags(match[1], selectableBlessingTagsForUnit(unit))) return false;
  const exclusion = String(match[2] || "")
    .replace(/^excluding\s+/i, "")
    .replace(/\s+(?:models?|units?)$/i, "")
    .trim();
  return !exclusion || !phraseMatchesTags(exclusion, tags);
}

function selectionKeyMatches(selectionKey, eligibleSelectionKeys) {
  if ((eligibleSelectionKeys || []).includes(selectionKey)) return true;
  const entryId = String(selectionKey || "").split(":").at(-1);
  return Boolean(entryId && (eligibleSelectionKeys || []).some(key => String(key).split(":").at(-1) === entryId));
}

function applyEnhancementEligibilityRestrictions(units, armies) {
  const unitsByKey = new Map((units || []).map(unit => [unit.selectionKey, unit]));
  let filteredLinks = 0;
  let affectedEnhancements = 0;
  const restrictedArmies = (armies || []).map(army => ({
    ...army,
    enhancements: (army.enhancements || []).map(enhancement => {
      const limiter = explicitLimiter(enhancement);
      if (!limiter) return enhancement;
      const eligibleSelectionKeys = (enhancement.eligibleSelectionKeys || []).filter(selectionKey => {
        const unit = unitsByKey.get(selectionKey);
        return unit && (enhancement.detachmentIds || [])
          .some(detachmentId => limiterMatchesUnit(limiter, unit, detachmentId, army));
      });
      const removed = (enhancement.eligibleSelectionKeys || []).length - eligibleSelectionKeys.length;
      if (removed > 0) {
        filteredLinks += removed;
        affectedEnhancements += 1;
      }
      return { ...enhancement, eligibleSelectionKeys };
    }).filter(enhancement => enhancement.eligibleSelectionKeys.length > 0)
  }));
  return { armies: restrictedArmies, summary: { affectedEnhancements, filteredLinks } };
}

module.exports = {
  applyEnhancementEligibilityRestrictions,
  explicitLimiter,
  limiterMatchesUnit,
  normalize,
  selectionKeyMatches,
  tagsForUnit
};
