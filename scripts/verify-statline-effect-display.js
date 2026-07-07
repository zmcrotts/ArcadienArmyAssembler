"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { buildRosterSheets } = require("../src/domain/sheets");

const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, "ui", "engine-data");
const MANIFEST = path.join(ROOT, "ui", "engine-data-manifest.js");
const REPORT = path.join(ROOT, "reports", "statline-effect-display-verification.md");
const STATIC_REPORT = path.join(ROOT, "reports", "static-statline-effect-candidates.md");
const CONDITIONAL_REPORT = path.join(ROOT, "reports", "conditional-statline-effect-reminders.md");
const TOGGLE_REPORT = path.join(ROOT, "reports", "selectable-toggle-effect-candidates.md");
const WANTED_FLAT_REPORT = path.join(ROOT, "reports", "wanted-flat-statline-effects.md");

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

function loadJsGlobal(filePath, windowShape) {
  const sandbox = { window: windowShape };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(filePath, "utf8"), sandbox, { filename: filePath });
  return sandbox.window;
}

function loadFactionChunks() {
  const rows = [];
  const files = fs.readdirSync(DATA_DIR).filter(file => file.endsWith(".js")).sort();
  for (const file of files) {
    const win = loadJsGlobal(path.join(DATA_DIR, file), { ROSTER_ENGINE_FACTIONS: {} });
    for (const [faction, units] of Object.entries(win.ROSTER_ENGINE_FACTIONS || {})) {
      for (const unit of units || []) rows.push({ faction, unit });
    }
  }
  return rows;
}

function loadManifest() {
  return loadJsGlobal(MANIFEST, {}).ROSTER_ENGINE_DATA || {};
}

function effectTextParts(item) {
  return [
    item?.name,
    item?.description,
    item?.characteristics?.Description,
    ...asArray(item?.profiles).flatMap(effectTextParts),
    ...asArray(item?.rules).flatMap(effectTextParts)
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
      if (isSkippableReferenceEffect(item)) continue;
      const text = normalizeText(effectTextParts(item).join(" "));
      if (text) records.push({ area, name: item?.name || "Unnamed", item, text });
    }
  }
  return records;
}

function isSkippableReferenceEffect(item) {
  const name = normalizeText(item?.name || item).toLowerCase();
  const description = normalizeText(item?.description || item?.characteristics?.Description);
  if (!name) return true;
  if (["leader", "bodyguard"].includes(name)) return true;
  if (isWeaponKeywordRuleName(name)) return true;
  if (/this ability always takes the form/i.test(description)) return true;
  return false;
}

function isWeaponKeywordRuleName(name) {
  const normalized = normalizeText(name).toLowerCase()
    .replace(/\s+\d+\+?$/, "")
    .replace(/^anti-[a-z0-9\s-]+$/, "anti");
  return weaponKeywordRuleNames().has(normalized)
    || /^anti-[a-z0-9\s-]+\s+\d+\+$/i.test(name)
    || /^rapid\s+fire\s+\d+$/i.test(name)
    || /^sustained\s+hits\s+\d+$/i.test(name);
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
    "lance",
    "lethal hits",
    "one shot",
    "pistol",
    "psychic",
    "precision",
    "rapid fire",
    "sustained hits",
    "torrent",
    "twin-linked"
  ]);
}

function isLeaderOrSupport(unit) {
  const roles = unit?.definition?.roles || unit?.roles || {};
  return Boolean(roles.leader || roles.support);
}

function mentionsAttachedUnit(text) {
  return /\bwhile\s+.*\b(?:is\s+)?leading\b/i.test(text)
    || /\bwhile\s+.*\bunit\s+is\s+led\b/i.test(text)
    || /\bif\s+this\s+unit\s+is\s+attached\s+to\s+a\s+unit\b/i.test(text)
    || /\bmodels?\s+in\s+(?:this|that)\s+unit\b/i.test(text)
    || /\bweapons?\s+equipped\s+by\s+models?\s+in\s+(?:this|that)\s+unit\b/i.test(text);
}

function isConditional(text) {
  const normalized = normalizeText(text);
  const allowedStaticIfs = [
    /\bif\s+this\s+unit\s+is\s+attached\s+to\s+a\s+unit\s+at\s+the\s+start\s+of\s+the\s+battle\b/i
  ];
  const withoutStaticIfs = allowedStaticIfs.reduce((next, pattern) => next.replace(pattern, ""), normalized);
  return /\bAura\b/i.test(normalized)
    || /\bwithin\s+\d+\s*(?:"|&quot;|inches?\b)/i.test(normalized)
    || /\bwhile\s+within\b/i.test(normalized)
    || /\bif\s+the\s+Waaagh!?'?s?\s+active\b/i.test(normalized)
    || /\bif\s+the\s+Waaagh!?\s+is\s+active\b/i.test(normalized)
    || /\bwhile\s+the\s+Waaagh!?\s+is\s+active\b/i.test(normalized)
    || /\bDark\s+Pact\b/i.test(normalized)
    || /\bbattle\s+rounds?\s+\d/i.test(normalized)
    || /\b(?:first|second|third|fourth|fifth)\s+battle\s+round\b/i.test(normalized)
    || /\bduring\s+the\s+(?:first|second|third|fourth|fifth)[^.]*battle\s+rounds?\b/i.test(normalized)
    || /\bFavoured\s+Champions\b/i.test(normalized)
    || /\bFlow\s+of\s+Magic\b/i.test(normalized)
    || /\bOath\s+of\s+Moment\b/i.test(normalized)
    || /\bShadow\s+Operations\b/i.test(normalized)
    || /\buntil\s+the\s+end\s+of\s+(?:the\s+)?(?:phase|turn|battle round|next turn)\b/i.test(normalized)
    || /\b(?:your|opponent'?s|either player'?s)\s+(?:command|movement|shooting|charge|fight|reinforcements?)\s+phase\b/i.test(normalized)
    || /\b(?:start|end)\s+of\s+(?:your|the|each|any)\s+(?:command|movement|shooting|charge|fight|turn|phase|battle round)\b/i.test(normalized)
    || /\bStarting Strength\b/i.test(normalized)
    || /\bBenefit of Cover\b/i.test(normalized)
    || /\bfor every\s+\d+\s+models?\b/i.test(normalized)
    || /\bselect\s+(?:one|either|a|an)\b/i.test(normalized)
    || /\bchoose\b/i.test(normalized)
    || /\broll\s+(?:one\s+)?D\d\b/i.test(normalized)
    || /\b(?:on|roll|result of)\s+a\s+\d\+?\b/i.test(normalized)
    || /\bafter\b/i.test(normalized)
    || /\bwhen\b/i.test(normalized)
    || /\bwhile\s+targeting\b/i.test(normalized)
    || /\btargets?\b/i.test(normalized)
    || /\battacks?\s+targets?\b/i.test(normalized)
    || /\bselected\s+as\s+the\s+target\b/i.test(normalized)
    || /\bhas\s+(?:made|ended)\s+(?:a\s+)?(?:Charge|Advance|Normal|Fall\s+Back)\s+move\b/i.test(normalized)
    || /\bends?\s+a\s+Charge\s+move\b/i.test(normalized)
    || /\bcharged\b/i.test(normalized)
    || /\bBattle[-\u2010-\u2015]?shocked\b/i.test(normalized)
    || /\bbelow\s+(?:its\s+)?(?:Starting|Half)-strength\b/i.test(normalized)
    || /\bdestroy(?:ed|s)?\b/i.test(normalized)
    || /\bsuffers?\s+\d+\s+mortal\s+wounds?\b/i.test(normalized)
    || /\bif\b/i.test(withoutStaticIfs);
}

function expectedChanges(text) {
  const normalized = normalizeText(text);
  const changes = [];
  const conditional = isConditional(normalized);
  const weaponType = /\bmelee\b/i.test(normalized) && !/\branged\b/i.test(normalized)
    ? "melee"
    : /\branged\b/i.test(normalized) && !/\bmelee\b/i.test(normalized)
      ? "ranged"
      : "all";

  if (/\bweapons?\b/i.test(normalized) && /\[(?:[^\]]+)\]/.test(normalized)) {
    changes.push(...bracketedKeywordEffects(normalized, weaponType));
  }
  if (/\b(?:improve|improves|improving)\s+the\s+Armou?r\s+Penetration\b.*\bby\s+1\b/i.test(normalized)
    || /\b(?:add|adds|adding)\s+1\s+to\s+the\s+Armou?r\s+Penetration\b/i.test(normalized)
    || /\b(?:improve|improves|improving)\s+the\s+AP\b.*\bby\s+1\b/i.test(normalized)
    || /\b(?:add|adds|adding)\s+1\s+to\s+the\s+AP\b/i.test(normalized)) {
    changes.push({ kind: "ap", weaponType, label: `${weaponType} weapons improve AP by 1` });
  }
  if (/\badd\s+1\s+to\s+the\s+Strength\s+characteristic\s+of\s+melee\s+weapons\b/i.test(normalized)) {
    changes.push({ kind: "melee-s", label: "melee weapons gain S +1" });
  } else if (/\bStrength\s+characteristic\b/i.test(normalized)) {
    changes.push({ kind: "unsupported", label: "mentions Strength characteristic" });
  }
  if (/\badd\s+1\s+to\s+the\s+Toughness\s+characteristic\s+of\s+(?:Bodyguard\s+)?models\b/i.test(normalized)) {
    changes.push({ kind: "t", label: "models gain T +1" });
  } else if (/\bToughness\s+characteristic\b/i.test(normalized)) {
    changes.push({ kind: "unsupported", label: "mentions Toughness characteristic" });
  }
  if (/\binvulnerable\s+save\b|\bInSv\b/i.test(normalized)) {
    const value = normalized.match(/\b([2-6]\+)\s*(?:InSv|invulnerable\s+save)\b/i)?.[1]
      || normalized.match(/\b(?:InSv|invulnerable\s+save)\s*(?::|of)?\s*([2-6]\+)/i)?.[1]
      || "value";
    changes.push({ kind: "inv", value, label: `models gain ${value} invulnerable save` });
  }
  if (/\bFeel\s+No\s+Pain\b/i.test(normalized)) return changes.map(change => ({ ...change, conditional }));
  const moveSet = normalized.match(/\bmodels?\s+in\s+(?:this|that)\s+unit\s+have\s+a\s+Move\s+characteristic\s+of\s+(.+?)(?:\s+and\b|[.,;]|$)/i);
  if (moveSet) changes.push({ kind: "set-characteristic", characteristic: "M", value: normalizeText(moveSet[1]), label: `M becomes ${normalizeText(moveSet[1])}` });
  const saveSet = normalized.match(/\bmodels?\s+in\s+(?:this|that)\s+unit\s+have\s+a\s+Save\s+characteristic\s+of\s+(.+?)(?:\s+and\b|[.,;]|$)/i);
  if (saveSet) changes.push({ kind: "set-characteristic", characteristic: "SV", value: normalizeText(saveSet[1]), label: `SV becomes ${normalizeText(saveSet[1])}` });
  const namedWeaponAttack = normalized.match(/\badd\s+1\s+to\s+the\s+Attacks\s+characteristic\s+of\s+(.+?)\s+weapons\s+equipped\s+by\s+(?:(?:models\s+in\s+)?(?:this|that)\s+unit|that\s+unit)\b/i);
  if (namedWeaponAttack) {
    const weaponScope = normalizeText(namedWeaponAttack[1]);
    if (/^(?:ranged|melee)$/i.test(weaponScope)) {
      changes.push({ kind: "weapon-a", weaponType: weaponScope.toLowerCase(), label: `${weaponScope.toLowerCase()} weapons gain A +1` });
    } else {
      changes.push({ kind: "named-weapon-a", weaponName: weaponScope, label: `${weaponScope} weapons gain A +1` });
    }
  }
  for (const characteristic of [
    ["Move", "M"],
    ["Objective Control", "OC"],
    ["Leadership", "LD"],
    ["Save", "SV"],
    ["Attacks", "A"],
    ["Damage", "D"]
  ]) {
    const [sourceName, displayName] = characteristic;
    const addMatch = normalized.match(new RegExp(`\\badd\\s+(\\d+)\\s+to\\s+the\\s+${sourceName}\\s+characteristic\\b`, "i"));
    const improveMatch = normalized.match(new RegExp(`\\bimprove\\s+the\\s+${sourceName}\\s+characteristic\\b.*\\bby\\s+(\\d+)\\b`, "i"));
    const changeMatch = normalized.match(new RegExp(`\\bchange\\s+the\\s+${sourceName}\\s+characteristic\\s+of\\s+models?\\s+in\\s+that\\s+unit\\s+to\\s+([^.,;]+)`, "i"));
    if (addMatch && !weaponCharacteristicChangeAlreadyCaptured(normalized, sourceName)) {
      changes.push({ kind: "unit-delta", characteristic: displayName, delta: Number(addMatch[1]), label: `${displayName} +${addMatch[1]}` });
    } else if (improveMatch && !weaponCharacteristicChangeAlreadyCaptured(normalized, sourceName)) {
      changes.push({ kind: "unit-delta", characteristic: displayName, delta: characteristicImprovementDelta(displayName, Number(improveMatch[1])), label: `${displayName} improves by ${improveMatch[1]}` });
    } else if (changeMatch) {
      changes.push({ kind: "set-characteristic", characteristic: displayName, value: normalizeText(changeMatch[1]), label: `${displayName} becomes ${normalizeText(changeMatch[1])}` });
    } else if (new RegExp(`\\b${sourceName}\\s+characteristic\\b`, "i").test(normalized) && !weaponCharacteristicChangeAlreadyCaptured(normalized, sourceName)) {
      changes.push({ kind: "unsupported", weaponType, label: `mentions ${displayName} characteristic` });
    }
  }

  return changes.map(change => ({ ...change, conditional }));
}

function weaponCharacteristicChangeAlreadyCaptured(text, sourceName) {
  return new RegExp(`\\b${sourceName}\\s+characteristic\\s+of\\s+.+?\\s+weapons\\b`, "i").test(text);
}

function characteristicImprovementDelta(characteristic, amount) {
  if (characteristic === "LD" || characteristic === "SV") return -amount;
  return amount;
}

function bracketedKeywords(text) {
  const values = [];
  for (const match of text.matchAll(/\[([^\]]+)\]/g)) {
    let value = normalizeText(match[1]).replace(/\^/g, "").replace(/\s+/g, " ");
    if (/^pyschic$/i.test(value)) value = "Psychic";
    if (!/^(?:SUSTAINED HITS X|this ability|example)/i.test(value)) values.push(titleKeyword(value));
  }
  return [...new Set(values)];
}

function bracketedKeywordEffects(text, fallbackWeaponType) {
  const effects = [];
  for (const match of text.matchAll(/\[([^\]]+)\]/g)) {
    if (!bracketBelongsToWeaponEffect(text, match.index)) continue;
    let value = normalizeText(match[1]).replace(/\^/g, "").replace(/\s+/g, " ");
    if (/^pyschic$/i.test(value)) value = "Psychic";
    if (/^(?:SUSTAINED HITS X|this ability|example)/i.test(value)) continue;
    const keyword = titleKeyword(value);
    const scopedType = scopedWeaponTypeBefore(text.slice(0, match.index), fallbackWeaponType);
    effects.push({ kind: "keyword", weaponType: scopedType, label: `${scopedType} weapons gain ${keyword}` });
  }
  const seen = new Set();
  return effects.filter(effect => {
    const key = `${effect.weaponType}:${effect.label}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function bracketBelongsToWeaponEffect(text, index) {
  const prefix = normalizeText(text).slice(0, index);
  const lastBoundary = Math.max(prefix.lastIndexOf("."), prefix.lastIndexOf(";"));
  return /\bweapons?\b/i.test(prefix.slice(lastBoundary + 1));
}

function scopedWeaponTypeBefore(prefix, fallbackWeaponType) {
  const lower = prefix.toLowerCase();
  const meleeIndex = lower.lastIndexOf("melee weapons");
  const rangedIndex = lower.lastIndexOf("ranged weapons");
  if (meleeIndex > rangedIndex) return "melee";
  if (rangedIndex > meleeIndex) return "ranged";
  return fallbackWeaponType;
}

function titleKeyword(value) {
  return value.toLowerCase().replace(/\b[a-z]/g, char => char.toUpperCase());
}

function buildUnitDocument(sourceName, effect) {
  return {
    name: `Verification - ${sourceName}`,
    pointsLimit: 1000,
    totalPoints: 2,
    rosterEntries: [bodyguardEntry(), leaderEntry(sourceName, effect)],
    groupedPresentation: [{
      id: "attached:bodyguard-1",
      kind: "attached",
      title: `Bodyguard + ${sourceName}`,
      totalPoints: 2,
      memberInstanceIds: ["bodyguard-1", "leader-1"],
      bodyguard: { instanceId: "bodyguard-1" },
      warnings: []
    }]
  };
}

function buildDetachmentDocument(detachmentName, rule) {
  return {
    name: `Verification - ${detachmentName}`,
    pointsLimit: 1000,
    totalPoints: 1,
    detachments: [{ id: "detachment-1", name: detachmentName, rules: [rule] }],
    rosterEntries: [bodyguardEntry()],
    groupedPresentation: [{
      id: "unit:bodyguard-1",
      kind: "unit",
      title: "Bodyguard",
      totalPoints: 1,
      memberInstanceIds: ["bodyguard-1"],
      bodyguard: { instanceId: "bodyguard-1" },
      warnings: []
    }]
  };
}

function bodyguardEntry() {
  return {
    instanceId: "bodyguard-1",
    name: "Synthetic Bodyguard",
    points: 1,
    keywords: ["Infantry"],
    configured: {
      units: [{ name: "Bodyguard Model", count: 5, characteristics: { M: "6\"", T: "4", SV: "3+", W: "2", LD: "6+", OC: "1" } }],
      weapons: [
        { name: "Ranged test weapon", typeName: "Ranged Weapons", count: 5, characteristics: { Range: "24\"", A: "1", BS: "3+", S: "4", AP: "0", D: "1", Keywords: "-" } },
        { name: "Purifying Flame", typeName: "Ranged Weapons", count: 5, characteristics: { Range: "18\"", A: "1", BS: "3+", S: "4", AP: "0", D: "1", Keywords: "-" } },
        { name: "Melee test weapon", typeName: "Melee Weapons", count: 5, characteristics: { Range: "Melee", A: "1", WS: "3+", S: "4", AP: "0", D: "1", Keywords: "-" } }
      ],
      abilities: [],
      rules: []
    }
  };
}

function leaderEntry(name, effect) {
  return {
    instanceId: "leader-1",
    name,
    points: 1,
    keywords: ["Character"],
    configured: {
      units: [{ name, count: 1, characteristics: { M: "6\"", T: "4", SV: "3+", W: "4", LD: "6+", OC: "1" } }],
      weapons: [{ name: "Leader melee weapon", typeName: "Melee Weapons", count: 1, characteristics: { Range: "Melee", A: "1", WS: "2+", S: "4", AP: "0", D: "1", Keywords: "-" } }],
      abilities: [effect],
      rules: []
    }
  };
}

function verifyChange(change, sheet) {
  if (change.conditional) return false;
  const bodyguardStat = sheet.statlines.find(item => item.name === "Bodyguard Model");
  const ranged = sheet.rangedWeapons.find(item => item.name === "Ranged test weapon");
  const melee = sheet.meleeWeapons.find(item => item.name === "Melee test weapon");
  if (change.kind === "ap") {
    if (change.weaponType === "ranged") return ranged?.characteristics?.AP === "-1";
    if (change.weaponType === "melee") return melee?.characteristics?.AP === "-1";
    return ranged?.characteristics?.AP === "-1" && melee?.characteristics?.AP === "-1";
  }
  if (change.kind === "melee-s") return melee?.characteristics?.S === "5";
  if (change.kind === "t") return bodyguardStat?.characteristics?.T === "5";
  if (change.kind === "set-characteristic") {
    return asArray(sheet.statlines).some(profile =>
      normalizeText(profile?.characteristics?.[change.characteristic]) === normalizeText(change.value)
    );
  }
  if (change.kind === "unit-delta") return verifiesUnitDelta(bodyguardStat?.characteristics, change);
  if (change.kind === "named-weapon-a") {
    return asArray(sheet.rangedWeapons).concat(asArray(sheet.meleeWeapons)).some(row =>
      normalizeText(row?.name).toLowerCase() === normalizeText(change.weaponName).toLowerCase()
      && row?.characteristics?.A === "2"
    );
  }
  if (change.kind === "weapon-a") {
    if (change.weaponType === "ranged") return ranged?.characteristics?.A === "2";
    if (change.weaponType === "melee") return melee?.characteristics?.A === "2";
  }
  if (change.kind === "unsupported" && change.label === "OC +1") return bodyguardStat?.characteristics?.OC === "2";
  if (change.kind === "unsupported" && change.label === "A +1") {
    if (change.weaponType === "ranged") return ranged?.characteristics?.A === "2";
    if (change.weaponType === "melee") return melee?.characteristics?.A === "2";
    return ranged?.characteristics?.A === "2" && melee?.characteristics?.A === "2";
  }
  if (change.kind === "inv") return bodyguardStat?.characteristics?.InSv === change.value;
  if (change.kind === "keyword") {
    const rows = change.weaponType === "ranged" ? [ranged] : change.weaponType === "melee" ? [melee] : [ranged, melee];
    return rows.every(row => keywordMatches(row?.keywords, change.label));
  }
  return false;
}

function verifiesUnitDelta(characteristics = {}, change) {
  const expected = {
    M: change.delta === 1 ? "7\"" : "",
    OC: change.delta === 1 ? "2" : change.delta === 2 ? "3" : "",
    LD: change.delta === -1 ? "5+" : change.delta === 1 ? "7+" : "",
    SV: change.delta === -1 ? "2+" : change.delta === 1 ? "4+" : "",
    A: change.delta === 2 ? "" : ""
  }[change.characteristic];
  return Boolean(expected) && characteristics?.[change.characteristic] === expected;
}

function keywordMatches(displayValue, label) {
  const value = normalizeText(displayValue).toLowerCase();
  const expected = label.replace(/^.* gain /i, "").toLowerCase();
  const candidates = new Set([expected]);
  const abbreviations = new Map([
    ["lethal hits", "lh"],
    ["sustained hits 1", "sh1"],
    ["sustained hits 2", "sh2"],
    ["devastating wounds", "dev"],
    ["ignores cover", "igcover"],
    ["twin-linked", "tl"],
    ["extra attacks", "ea"]
  ]);
  if (abbreviations.has(expected)) candidates.add(abbreviations.get(expected));
  const anti = expected.match(/^anti-([a-z][a-z\s-]*?)\s+(\d+\+)$/i);
  if (anti) candidates.add(`a${antiTargetAbbreviation(anti[1])}${anti[2]}`.toLowerCase());
  const entries = value.split(",").map(item => normalizeText(item).toLowerCase());
  return entries.some(item => candidates.has(item));
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
  return target.split(" ").filter(Boolean).map(word => word.slice(0, 3).replace(/^./, char => char.toUpperCase())).join("");
}

function addResult(results, name, sourceLabel, effectName, change, confirmed) {
  const status = /Templar\s+Vows/i.test(effectName) ? "Toggle Candidate" : change.conditional ? "Conditional" : "Static";
  results.push({
    unitName: name,
    expectedChange: `${sourceLabel}: ${effectName}: ${change.label}`,
    status,
    confirmed: confirmed ? "Y" : "N"
  });
}

function main() {
  const results = [];
  const unitRows = loadFactionChunks();
  const seenUnitEffects = new Set();

  for (const { faction, unit } of unitRows) {
    if (!isLeaderOrSupport(unit)) continue;
    for (const record of configuredEffectRecords(unit)) {
      if (!mentionsAttachedUnit(record.text)) continue;
      const changes = expectedChanges(record.text);
      if (!changes.length) continue;
      const key = `${faction}\n${unit.name}\n${record.name}\n${record.text}`;
      if (seenUnitEffects.has(key)) continue;
      seenUnitEffects.add(key);
      const sheet = buildRosterSheets(buildUnitDocument(unit.name, record.item)).combinedUnitSheets[0];
      for (const change of changes) {
        addResult(results, unit.name, faction, record.name, change, verifyChange(change, sheet));
      }
    }
  }

  const manifest = loadManifest();
  const seenDetachmentRules = new Set();
  for (const army of Object.values(manifest.armies || {})) {
    for (const detachment of asArray(army.detachments)) {
      for (const rule of asArray(detachment.rules)) {
        if (isSkippableReferenceEffect(rule)) continue;
        const text = normalizeText(effectTextParts(rule).join(" "));
        const changes = expectedChanges(text);
        if (!changes.length) continue;
        const key = `${army.faction}\n${detachment.name}\n${rule.name}\n${text}`;
        if (seenDetachmentRules.has(key)) continue;
        seenDetachmentRules.add(key);
        const sheet = buildRosterSheets(buildDetachmentDocument(detachment.name, rule)).combinedUnitSheets[0];
        for (const change of changes) {
          addResult(results, `Detachment: ${detachment.name}`, army.faction, rule.name, change, verifyChange(change, sheet));
        }
      }
    }
  }

  results.sort((left, right) =>
    left.status.localeCompare(right.status)
    || left.confirmed.localeCompare(right.confirmed)
    || left.unitName.localeCompare(right.unitName)
    || left.expectedChange.localeCompare(right.expectedChange)
  );
  const staticResults = results.filter(item => item.status === "Static");
  const conditionalResults = results.filter(item => item.status === "Conditional");
  const toggleResults = results.filter(item => item.status === "Toggle Candidate");
  const wantedFlatResults = consolidateWantedFlatResults(staticResults.filter(isWantedFlatResult));
  staticResults.sort((left, right) =>
    left.confirmed.localeCompare(right.confirmed)
    || left.unitName.localeCompare(right.unitName)
    || left.expectedChange.localeCompare(right.expectedChange)
  );
  conditionalResults.sort((left, right) =>
    left.unitName.localeCompare(right.unitName)
    || left.expectedChange.localeCompare(right.expectedChange)
  );

  fs.mkdirSync(path.dirname(REPORT), { recursive: true });
  const lines = [
    "# Statline Effect Display Verification",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "Y means the current sheet/display data changed in the synthetic verification fixture. N means the source effect was found but current display logic did not confirm it, either because it is conditional/ambiguous or because that effect family is not implemented yet.",
    "",
    `Touched source effects: ${results.length}`,
    `Static source effects: ${staticResults.length}`,
    `Conditional source effects: ${conditionalResults.length}`,
    `Static confirmed Y: ${staticResults.filter(item => item.confirmed === "Y").length}`,
    `Static needs look N: ${staticResults.filter(item => item.confirmed === "N").length}`,
    "",
    "| Unit Name | Expected Change | Static/Conditional | Y/N |",
    "| --- | --- | --- | --- |",
    ...results.map(item => `| ${escapeTable(item.unitName)} | ${escapeTable(item.expectedChange)} | ${item.status} | ${item.confirmed} |`)
  ];
  fs.writeFileSync(REPORT, `${lines.join("\n")}\n`);
  fs.writeFileSync(STATIC_REPORT, `${staticReportLines(staticResults).join("\n")}\n`);
  fs.writeFileSync(CONDITIONAL_REPORT, `${conditionalReportLines(conditionalResults).join("\n")}\n`);
  fs.writeFileSync(TOGGLE_REPORT, `${toggleReportLines(toggleResults).join("\n")}\n`);
  fs.writeFileSync(WANTED_FLAT_REPORT, `${wantedFlatReportLines(wantedFlatResults).join("\n")}\n`);
  console.log(`Wrote ${REPORT}`);
  console.log(`Wrote ${STATIC_REPORT}`);
  console.log(`Wrote ${CONDITIONAL_REPORT}`);
  console.log(`Wrote ${TOGGLE_REPORT}`);
  console.log(`Wrote ${WANTED_FLAT_REPORT}`);
  console.log(`Touched source effects: ${results.length}`);
  console.log(`Static source effects: ${staticResults.length}`);
  console.log(`Conditional source effects: ${conditionalResults.length}`);
  console.log(`Toggle candidate source effects: ${toggleResults.length}`);
  console.log(`Static confirmed Y: ${staticResults.filter(item => item.confirmed === "Y").length}`);
  console.log(`Static needs look N: ${staticResults.filter(item => item.confirmed === "N").length}`);
  console.log(`Wanted flat effects: ${wantedFlatResults.length}`);
}

function isWantedFlatResult(item) {
  const change = item.expectedChange;
  if (/\bFeel\s+No\s+Pain\b/i.test(change)) return false;
  if (/\bmentions\b/i.test(change)) return false;
  if (/\battacks? allocated\b/i.test(change)) return false;
  return /\bweapons? gain\b/i.test(change)
    || /\bweapons? improve AP by 1\b/i.test(change)
    || /\bweapons? gain S \+1\b/i.test(change)
    || /\bweapons? gain A \+1\b/i.test(change)
    || /\bmodels gain T \+1\b/i.test(change)
    || /\bmodels gain [2-6]\+ invulnerable save\b/i.test(change)
    || /\b(?:OC|M|SV|LD|A|D) (?:\+\d+|improves by \d+|becomes )/i.test(change);
}

function consolidateWantedFlatResults(results) {
  const byEffect = new Map();
  for (const result of results) {
    const parsed = parseExpectedChange(result);
    const key = [
      parsed.unitName,
      parsed.effectName,
      parsed.changeLabel,
      genericSpaceMarineFaction(parsed.faction) || parsed.faction
    ].join("\n");
    const existing = byEffect.get(key) || {
      unitName: parsed.unitName,
      faction: parsed.faction,
      effectName: parsed.effectName,
      changeLabel: parsed.changeLabel,
      confirmed: result.confirmed,
      factions: new Set()
    };
    existing.factions.add(parsed.faction);
    if (result.confirmed === "Y") existing.confirmed = "Y";
    byEffect.set(key, existing);
  }
  return [...byEffect.values()].map(row => {
    const factions = [...row.factions].sort();
    const generic = factions.map(genericSpaceMarineFaction).filter(Boolean);
    const provider = generic.length > 1
      ? `${row.unitName} (${generic[0]})`
      : `${row.unitName} (${factions[0]})`;
    return {
      unitName: provider,
      expectedChange: `${row.effectName}: ${row.changeLabel}`,
      confirmed: row.confirmed
    };
  }).sort((left, right) =>
    left.confirmed.localeCompare(right.confirmed)
    || left.unitName.localeCompare(right.unitName)
    || left.expectedChange.localeCompare(right.expectedChange)
  );
}

function parseExpectedChange(result) {
  const match = result.expectedChange.match(/^(.+?):\s+([^:]+):\s+(.+)$/);
  return {
    unitName: result.unitName,
    faction: match ? match[1] : "",
    effectName: match ? match[2] : "",
    changeLabel: match ? match[3] : result.expectedChange
  };
}

function genericSpaceMarineFaction(faction) {
  return /^Imperium - Adeptus Astartes - (?:Black Templars|Blood Angels|Dark Angels|Deathwatch|Imperial Fists|Iron Hands|Raven Guard|Salamanders|Space Marines|Space Wolves|Ultramarines|White Scars)$/i.test(faction)
    ? "Imperium - Adeptus Astartes (generic chapters)"
    : "";
}

function staticReportLines(results) {
  return [
    "# Static Statline Effect Candidates",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "Only always-on roster/detachment effects belong here. Y means current display data confirmed the expected change. N means the source looks static but the display code does not yet flatten that effect family.",
    "",
    `Static source effects: ${results.length}`,
    `Confirmed Y: ${results.filter(item => item.confirmed === "Y").length}`,
    `Needs look N: ${results.filter(item => item.confirmed === "N").length}`,
    "",
    "| Unit Name | Expected Change | Y/N |",
    "| --- | --- | --- |",
    ...results.map(item => `| ${escapeTable(item.unitName)} | ${escapeTable(item.expectedChange)} | ${item.confirmed} |`)
  ];
}

function conditionalReportLines(results) {
  return [
    "# Conditional Statline Effect Reminders",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "These source effects mention statline-like changes but are not always-on roster construction changes. Keep them as ability/rule reminders unless we later add explicit toggles.",
    "",
    `Conditional source effects: ${results.length}`,
    "",
    "| Unit Name | Expected Change | Y/N |",
    "| --- | --- | --- |",
    ...results.map(item => `| ${escapeTable(item.unitName)} | ${escapeTable(item.expectedChange)} | N |`)
  ];
}

function toggleReportLines(results) {
  return [
    "# Selectable Toggle Effect Candidates",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "These source effects are not always-on and should not be flattened automatically. They are good future candidates for an explicit roster/battle-state toggle.",
    "",
    `Toggle candidate source effects: ${results.length}`,
    "",
    "| Unit Name | Expected Change | Y/N |",
    "| --- | --- | --- |",
    ...results.map(item => `| ${escapeTable(item.unitName)} | ${escapeTable(item.expectedChange)} | N |`)
  ];
}

function wantedFlatReportLines(results) {
  return [
    "# Effects We Want To Work Flat, All The Time",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "| Unit | Effect | Y/N |",
    "| --- | --- | --- |",
    ...results.map(item => `| ${escapeTable(item.unitName)} | ${escapeTable(item.expectedChange)} | ${item.confirmed} |`)
  ];
}

function escapeTable(value) {
  return normalizeText(value).replace(/\|/g, "\\|");
}

main();
