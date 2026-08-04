"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { extractNormalizedRuleset } = require("../src/rulesets/sources");

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
    const first = normalize(option).split(" ")[0];
    return !GENERIC_TYPE_TAGS.has(first) || normalize(option).split(" ").length > 1;
  });
  return (sharedSuffixAlternatives.length ? sharedSuffixAlternatives : alternatives)
    .some(option => wordsSegmentedByTags(option, tags));
}

function limiterMatchesUnit(limiter, unit, detachmentId, army = null) {
  const match = String(limiter || "").match(
    /^(.+?)\s+(?:models?|units?)\s+only(?:\s*\(([^)]*)\))?\./i
  );
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

function isCharacterForDetachment(unit, detachmentId) {
  if (unit.roles?.character) return true;
  return (unit.conditionalKeywords || []).some(grant =>
    normalize(grant.keyword) === "character" && (grant.detachmentIds || []).includes(detachmentId)
  );
}

function canActuallyBear(enhancement, unit, detachmentId) {
  if (!selectionKeyMatches(unit.selectionKey, enhancement.eligibleSelectionKeys)) return false;
  if (enhancement.kind === "upgrade") return true;
  return isCharacterForDetachment(unit, detachmentId) && !unit.roles?.epicHero;
}

function canExpectedlyBear(enhancement, unit, detachmentId, limiter, army) {
  if (enhancement.kind !== "upgrade" && (!isCharacterForDetachment(unit, detachmentId) || unit.roles?.epicHero)) {
    return false;
  }
  return limiter ? limiterMatchesUnit(limiter, unit, detachmentId, army) : canActuallyBear(enhancement, unit, detachmentId);
}

function nativeUnitsForArmy(ruleset, army) {
  const allowed = new Set(army.allowedSelectionKeys || []);
  return ruleset.units.filter(unit => allowed.has(unit.selectionKey));
}

function audit() {
  const ruleset = extractNormalizedRuleset("wh40k-11e-vflam");
  const findings = [];
  const records = [];

  for (const army of ruleset.armies) {
    const units = nativeUnitsForArmy(ruleset, army);
    for (const enhancement of army.enhancements || []) {
      const limiter = explicitLimiter(enhancement);
      for (const detachmentId of enhancement.detachmentIds || []) {
        const detachmentName = army.detachments.find(item => item.id === detachmentId)?.name || detachmentId;
        const actual = units.filter(unit => canActuallyBear(enhancement, unit, detachmentId));
        const expected = units.filter(unit => canExpectedlyBear(enhancement, unit, detachmentId, limiter, army));
        const actualKeys = new Set(actual.map(unit => unit.selectionKey));
        const expectedKeys = new Set(expected.map(unit => unit.selectionKey));
        const overBroad = actual.filter(unit => !expectedKeys.has(unit.selectionKey)).map(unit => unit.name).sort();
        const underBroad = expected.filter(unit => !actualKeys.has(unit.selectionKey)).map(unit => unit.name).sort();
        const record = {
          faction: army.faction,
          detachment: detachmentName,
          name: enhancement.name,
          kind: enhancement.kind,
          points: Number(enhancement.points || 0),
          limiter,
          actualEligibleNames: actual.map(unit => unit.name).sort(),
          expectedEligibleNames: expected.map(unit => unit.name).sort(),
          overBroad,
          underBroad
        };
        records.push(record);
        if (overBroad.length || underBroad.length) findings.push(record);
      }
    }
  }

  return {
    summary: {
      armies: ruleset.armies.length,
      records: records.length,
      enhancements: records.filter(item => item.kind === "enhancement").length,
      upgrades: records.filter(item => item.kind === "upgrade").length,
      explicitLimiters: records.filter(item => item.limiter).length,
      genericEnhancements: records.filter(item => !item.limiter).length,
      findings: findings.length,
      overBroadRecords: findings.filter(item => item.overBroad.length).length,
      underBroadRecords: findings.filter(item => item.underBroad.length).length
    },
    findings,
    records
  };
}

function main() {
  const outputIndex = process.argv.indexOf("--output");
  const outputPath = outputIndex >= 0 ? process.argv[outputIndex + 1] : null;
  const compact = process.argv.includes("--compact");
  const result = audit();
  const rendered = JSON.stringify(compact ? { summary: result.summary, findings: result.findings } : result, null, 2);
  if (outputPath) {
    const resolved = path.resolve(outputPath);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, `${rendered}\n`, "utf8");
    process.stdout.write(`${JSON.stringify(result.summary, null, 2)}\nReport: ${resolved}\n`);
  } else {
    process.stdout.write(`${rendered}\n`);
  }
}

if (require.main === module) main();

module.exports = { audit, explicitLimiter, limiterMatchesUnit };
