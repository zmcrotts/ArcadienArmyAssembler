"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, "ui", "engine-data");

function normalizeText(value) {
  return String(value || "")
    .replace(/\^\^\*\*/g, "")
    .replace(/\*\*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function loadFactionFile(filePath) {
  const sandbox = {
    window: { ROSTER_ENGINE_FACTIONS: {} }
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(filePath, "utf8"), sandbox, { filename: filePath });
  return sandbox.window.ROSTER_ENGINE_FACTIONS;
}

function effectTextParts(item) {
  return [
    item?.name,
    item?.description,
    item?.characteristics?.Description
  ].filter(Boolean);
}

function configuredEffectRecords(unit) {
  const configured = unit?.defaultSummary?.configured || {};
  const records = [];
  for (const [area, items] of [
    ["abilities", configured.abilities],
    ["rules", configured.rules],
    ["profiles", configured.profiles]
  ]) {
    for (const item of asArray(items)) {
      const text = normalizeText(effectTextParts(item).join(" "));
      if (text) records.push({ area, name: item?.name || "Unnamed", text });
    }
  }
  return records;
}

function isLeaderOrSupport(unit) {
  const roles = unit?.definition?.roles || unit?.roles || {};
  return Boolean(roles.leader || roles.support);
}

function mentionsLeadingUnit(text) {
  return /\bwhile\s+this\s+model\s+is\s+leading\s+a\s+unit\b/i.test(text)
    || /\bwhile\s+this\s+unit\s+is\s+led\s+by\b/i.test(text)
    || /\bif\s+this\s+unit\s+is\s+attached\s+to\s+a\s+unit\b/i.test(text)
    || /\bwhile\s+.*\bmodel\s+is\s+leading\s+a\s+unit\b/i.test(text)
    || /\bwhile\s+.*\bunit\s+is\s+leading\s+a\s+unit\b/i.test(text);
}

function classifyEffects(text) {
  const buckets = new Set();
  if (/\bweapons?\b/i.test(text) && /\[(?:[^\]]+)\]/.test(text)) buckets.add("weapon-keywords");
  if (/\b(?:add|subtract)\s+1\s+to\s+the\s+Hit\s+roll\b/i.test(text)) buckets.add("hit-roll");
  if (/\bre-?roll\s+(?:a\s+)?Hit\s+roll\b/i.test(text)) buckets.add("hit-reroll");
  if (/\b(?:add|subtract)\s+1\s+to\s+the\s+Wound\s+roll\b/i.test(text)) buckets.add("wound-roll");
  if (/\bre-?roll\s+(?:a\s+)?Wound\s+roll\b/i.test(text)) buckets.add("wound-reroll");
  if (/\bArmou?r\s+Penetration\b|\bAP\b/i.test(text)) buckets.add("ap");
  if (/\bStrength\s+characteristic\b/i.test(text)) buckets.add("strength");
  if (/\bAttacks\s+characteristic\b/i.test(text)) buckets.add("attacks");
  if (/\bDamage\s+characteristic\b/i.test(text)) buckets.add("damage");
  if (/\bCritical\s+(?:Hit|Wound)\b/i.test(text)) buckets.add("critical-threshold");
  if (/\bFeel\s+No\s+Pain\b/i.test(text)) buckets.add("feel-no-pain");
  if (/\binvulnerable\s+save\b|\bInSv\b/i.test(text)) buckets.add("invulnerable-save");
  if (/\b(?:Toughness|Save|Move|Objective Control|Leadership)\s+characteristic\b/i.test(text)) buckets.add("unit-characteristic");
  if (!buckets.size) buckets.add("other-leading-effect");
  return [...buckets];
}

function shortText(text, length = 280) {
  return text.length > length ? `${text.slice(0, length - 1)}...` : text;
}

function main() {
  const files = fs.readdirSync(DATA_DIR).filter(file => file.endsWith(".js")).sort();
  const matches = [];
  let leaderSupportUnits = 0;

  for (const file of files) {
    const factions = loadFactionFile(path.join(DATA_DIR, file));
    for (const [faction, units] of Object.entries(factions)) {
      for (const unit of units || []) {
        if (!isLeaderOrSupport(unit)) continue;
        leaderSupportUnits += 1;
        for (const record of configuredEffectRecords(unit)) {
          if (!mentionsLeadingUnit(record.text)) continue;
          matches.push({
            faction,
            unit: unit.name,
            roles: unit.definition?.roles || {},
            area: record.area,
            name: record.name,
            buckets: classifyEffects(record.text),
            text: record.text
          });
        }
      }
    }
  }

  const bucketCounts = new Map();
  const areaCounts = new Map();
  const uniqueMatches = new Map();
  for (const match of matches) {
    const key = `${match.unit}\n${match.area}\n${match.name}\n${match.text}`;
    if (!uniqueMatches.has(key)) uniqueMatches.set(key, match);
    areaCounts.set(match.area, (areaCounts.get(match.area) || 0) + 1);
    for (const bucket of match.buckets) bucketCounts.set(bucket, (bucketCounts.get(bucket) || 0) + 1);
  }
  const unique = [...uniqueMatches.values()];
  const uniqueBucketCounts = new Map();
  const uniqueAreaCounts = new Map();
  for (const match of unique) {
    uniqueAreaCounts.set(match.area, (uniqueAreaCounts.get(match.area) || 0) + 1);
    for (const bucket of match.buckets) uniqueBucketCounts.set(bucket, (uniqueBucketCounts.get(bucket) || 0) + 1);
  }

  console.log(`Scanned generated faction chunks: ${files.length}`);
  console.log(`Leader/support units scanned: ${leaderSupportUnits}`);
  console.log(`Leading-unit effect records found: ${matches.length}`);
  console.log(`Unique leading-unit effect records: ${unique.length}`);
  console.log("");
  console.log("By source area:");
  for (const [area, count] of [...areaCounts.entries()].sort()) console.log(`  ${area}: ${count}`);
  console.log("");
  console.log("By source area, unique:");
  for (const [area, count] of [...uniqueAreaCounts.entries()].sort()) console.log(`  ${area}: ${count}`);
  console.log("");
  console.log("By effect bucket:");
  for (const [bucket, count] of [...bucketCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
    console.log(`  ${bucket}: ${count}`);
  }
  console.log("");
  console.log("By effect bucket, unique:");
  for (const [bucket, count] of [...uniqueBucketCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
    console.log(`  ${bucket}: ${count}`);
  }
  console.log("");
  console.log("Representative examples:");
  for (const match of unique.slice(0, 40)) {
    console.log(`- ${match.faction} :: ${match.unit} :: ${match.area} :: ${match.name} :: ${match.buckets.join(", ")}`);
    console.log(`  ${shortText(match.text)}`);
  }
}

main();
