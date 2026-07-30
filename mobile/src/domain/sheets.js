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

function effectiveWeaponsFor(record, typeName, effects = [], context = {}) {
  const recordContext = {
    ...context,
    unitName: record?.name || "",
    keywords: [...asArray(context.keywords), ...asArray(record?.keywords)]
  };
  const configured = applyWeaponEffectsToConfigured(configuredFor(record), effects, recordContext);
  return asArray(configured.weapons)
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

function normalizeWeapon(weapon) {
  const characteristics = clone(weapon?.characteristics || {});
  const keywords = characteristics.Keywords ?? characteristics.keywords ?? "";
  return {
    ...clone(weapon),
    characteristics,
    keywords: abbreviateWeaponKeywords(keywords)
  };
}

function applyWeaponEffectsToConfigured(configured = {}, effects = [], context = {}) {
  const weaponEffects = extractWeaponEffects(effects);
  if (!weaponEffects.length) return clone(configured);
  const next = clone(configured) || {};
  next.weapons = asArray(next.weapons).map(weapon => applyWeaponEffectsToWeapon(weapon, weaponEffects, context));
  return next;
}

function extractWeaponEffects(effects = []) {
  const extracted = asArray(effects).flatMap(effect => {
    if (isWeaponKeywordGlossaryEffect(effect)) return [];
    if (effectRecordRequiresBattleState(effect)) return [];
    const source = effect?.sourceKind || effect?.source || "";
    return effectTextParts(effect).flatMap(text => staticEffectClauses(text).flatMap(clause =>
      extractWeaponEffectsFromText(clause, source).map(extractedEffect => ({
        ...extractedEffect,
        bearerInstanceId: extractedEffect.scope === "bearer" ? effect?.bearerInstanceId || null : null
      }))
    ));
  });
  return uniqueWeaponEffects(extracted);
}

function uniqueWeaponEffects(effects) {
  const seen = new Set();
  const result = [];
  for (const effect of effects) {
    const key = [
      effect.kind || "",
      effect.weaponType || "",
      effect.keyword || "",
      effect.characteristic || "",
      effect.weaponName || "",
      effect.requiredWeaponKeyword || "",
      effect.excludedWeaponKeyword || "",
      effect.scope || "",
      (effect.targets || []).join("/"),
      effect.bearerInstanceId || "",
      effect.bodyguardOnly ? "bodyguard" : "",
      effect.delta ?? ""
      , effect.value ?? ""
    ].join(":");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(effect);
  }
  return result;
}

function extractWeaponEffectsFromText(text, sourceKind = "") {
  const normalized = normalizeText(text);
  if (!normalized || !effectAppliesAutomatically(normalized, sourceKind)) return [];

  const effects = [];
  const weaponType = effectWeaponType(normalized);
  effects.push(...bracketedWeaponKeywordEffects(normalized));
  const genericCharacteristics = weaponCharacteristicEffects(normalized);
  effects.push(...genericCharacteristics);

  if (apImprovesByOne(normalized) && !genericCharacteristics.some(effect => effect.characteristic === "AP")) effects.push({ kind: "ap", weaponType, delta: -1 });
  if (meleeStrengthImprovesByOne(normalized) && !genericCharacteristics.some(effect => effect.characteristic === "S")) {
    effects.push({ kind: "characteristic", weaponType: "Melee Weapons", characteristic: "S", delta: 1, bodyguardOnly: bodyguardModelsOnly(normalized) });
  }
  const attacks = weaponAttacksImprovement(normalized);
  if (attacks && !genericCharacteristics.some(effect => effect.characteristic === "A")) {
    effects.push({
      kind: "characteristic",
      weaponType: attacks.weaponType || "",
      weaponName: attacks.weaponName || "",
      characteristic: "A",
      delta: attacks.delta,
      bodyguardOnly: bodyguardModelsOnly(normalized)
    });
  }
  effects.push(...attackSkillEffects(normalized));

  return effects;
}

function staticEffectClauses(text) {
  const lines = String(text || "")
    .replace(/\r\n?/g, "\n")
    .split(/\n+/)
    .map(line => line.trim())
    .filter(Boolean);
  const contextualized = [];
  let listIntroduction = "";
  for (const line of lines) {
    const bullet = line.match(/^(?:[-*•■]\s*)(.+)$/);
    if (bullet) {
      contextualized.push(listIntroduction ? `${listIntroduction} ${bullet[1]}` : bullet[1]);
      continue;
    }
    contextualized.push(line);
    listIntroduction = /:\s*$/.test(line) ? line : "";
  }
  return contextualized
    .flatMap(line => normalizeText(line).split(/(?<=[.;])\s+|,\s+and\s+(?=each\s+time\b)/i))
    .map(normalizeText)
    .filter(Boolean);
}

function weaponCharacteristicEffects(text) {
  if (!/\bcharacteristics?\b/i.test(text) || !/\b(?:weapons?|Pistols?|this\s+model['’]s)\b/i.test(text)) return [];
  const effects = [];
  const compound = text.match(/\badd\s+(\d+)\s+to\s+(?:the\s+)?(.+?)\s+and\s+add\s+(\d+)\s+to\s+(?:the\s+)?(.+?)\s+characteristics?\s+of\s+(.+?)(?=[.;]|$)/i);
  if (compound) {
    effects.push(...weaponEffectsForNames(compound[2], compound[5], Number(compound[1]), "add"));
    effects.push(...weaponEffectsForNames(compound[4], compound[5], Number(compound[3]), "add"));
  }
  for (const match of text.matchAll(/\b(add|adds|adding)\s+(\d+)\s*(?:"|&quot;|inches?)?\s+to\s+(?:the\s+)?(.+?)\s+characteristics?\s+of\s+(.+?)(?=[.;]|$)/ig)) {
    if (/\band\s+add\s+\d+/i.test(match[3])) continue;
    effects.push(...weaponEffectsForNames(match[3], match[4], Number(match[2]), "add"));
  }
  for (const match of text.matchAll(/\badd\s+(\d+)\s+(?:the\s+)?(.+?)\s+characteristics?\s+of\s+(.+?\bweapons?\b.*?\bbearer\b)(?=[.;]|$)/ig)) {
    effects.push(...weaponEffectsForNames(match[2], match[3], Number(match[1]), "add"));
  }
  for (const match of text.matchAll(/\b(improve|improves|improving)\s+(?:the\s+)?(.+?)\s+characteristics?\s+of\s+(.+?)\s+by\s+(\d+)\b/ig)) {
    effects.push(...weaponEffectsForNames(match[2], match[3], Number(match[4]), "improve"));
  }
  for (const match of text.matchAll(/\b(improve|improves|improving)\s+(?:the\s+)?(.+?)\s+characteristics?\s+of\s+(.+?\bweapons?\s+equipped\s+by\s+the\s+wearer)\s+of\s+(\d+)\b/ig)) {
    effects.push(...weaponEffectsForNames(match[2], match[3], Number(match[4]), "improve"));
  }
  for (const match of text.matchAll(/\bchange\s+(?:the\s+)?(.+?)\s+characteristics?\s+of\s+(.+?)\s+to\s+([0-9]+(?:D[0-9]+)?(?:\+\d+)?)(?=[,.;]|$)/ig)) {
    const scope = weaponEffectScope(match[2]);
    if (!scope) continue;
    for (const characteristic of characteristicNames(match[1], true)) {
      effects.push({ kind: "set-characteristic", ...scope, characteristic, value: normalizeText(match[3]) });
    }
  }
  return effects;
}

function weaponEffectsForNames(names, scopeText, amount, operation) {
  const scope = weaponEffectScope(scopeText);
  if (!scope) return [];
  return characteristicNames(names, true).map(characteristic => ({
    kind: "characteristic",
    ...scope,
    characteristic,
    delta: characteristicOperationDelta(characteristic, amount, operation),
    bodyguardOnly: bodyguardModelsOnly(scopeText)
  }));
}

function weaponEffectScope(value) {
  const text = normalizeText(value);
  if (!/\b(?:weapons?|Pistols?|this\s+model['’]s)\b/i.test(text)) return null;
  const weaponType = effectWeaponType(text);
  const requiredWeaponKeyword = (text.match(/\b(Psychic|Torrent|Pistol)\s+weapons?\b/i) || [])[1] || "";
  const pistolScope = /\bbearer['’]s\s+Pistols?\b/i.test(text);
  const excludedWeaponKeyword = /\bexcluding\s+(?:\[[^\]]*\]\s*)?Extra Attacks\b/i.test(text) ? "Extra Attacks" : "";
  const scope = /\bmodels?\s+in\s+(?:the\s+)?bearer['’]s\s+unit\b|\bmodels?\s+in\s+(?:this|that)\s+unit\b/i.test(text)
    ? "bearer-unit"
    : /\bbearer['’]s\b|\bequipped\s+by\s+(?:the\s+)?(?:bearer|wearer)\b/i.test(text)
      ? "bearer"
      : "";
  const generic = text
    .replace(/\s+equipped\s+by\b.*$/i, "")
    .replace(/^(?:the\s+)?bearer['’]s\s+/i, "")
    .replace(/^this\s+model['’]s\s+/i, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/\bPistols?\b/ig, "")
    .replace(/\b(?:melee|ranged|Psychic|Torrent|Pistol)\b/ig, "")
    .replace(/\bweapons?\b/ig, "")
    .replace(/[*^]/g, "")
    .trim();
  return {
    weaponType,
    requiredWeaponKeyword: requiredWeaponKeyword || (pistolScope ? "Pistol" : ""),
    excludedWeaponKeyword,
    weaponName: generic && !/\bmodels?\b|\bunit\b/i.test(generic) ? generic : "",
    scope
  };
}

function characteristicNames(value, weapon = false) {
  const mappings = weapon
    ? [
        ["Armour Penetration", "AP"], ["Armor Penetration", "AP"], ["Ballistic Skill", "BS"],
        ["Weapon Skill", "WS"], ["Objective Control", "OC"], ["Attacks", "A"], ["Attack", "A"],
        ["Strength", "S"], ["Damage", "D"], ["Range", "Range"], ["AP", "AP"], ["BS", "BS"], ["WS", "WS"]
      ]
    : [
        ["Objective Control", "OC"], ["Leadership", "LD"], ["Toughness", "T"], ["Movement", "M"], ["Wounds", "W"],
        ["Wound", "W"], ["Save", "SV"], ["Move", "M"], ["OC", "OC"], ["LD", "LD"],
        ["SV", "SV"], ["T", "T"], ["W", "W"], ["M", "M"]
      ];
  const normalized = normalizeText(value).replace(/[*^]/g, " ");
  const found = [];
  for (const [name, characteristic] of mappings) {
    if (new RegExp(`\\b${name.replace(/\s+/g, "\\s+")}\\b`, "i").test(normalized) && !found.includes(characteristic)) found.push(characteristic);
  }
  return found;
}

function characteristicOperationDelta(characteristic, amount, operation) {
  if (operation === "improve" && ["AP", "BS", "WS", "LD", "SV"].includes(characteristic)) return -amount;
  if (operation === "add" && ["AP", "BS", "WS"].includes(characteristic)) return -amount;
  return amount;
}

function attackSkillEffects(text) {
  const match = normalizeText(text).match(/\bFriendly\s+(.+?)\s+units?[’']?\s+attacks\s+have\s+\+1\s+(BS|WS)(?:\s+and\s+(BS|WS))?\b/i);
  if (!match) return [];
  const targets = match[1].split(/\s*\/\s*/).map(normalizeMatchText).filter(Boolean);
  return [...new Set([match[2], match[3]].filter(Boolean).map(item => item.toUpperCase()))]
    .map(characteristic => ({ kind: "characteristic", characteristic, delta: -1, targets }));
}

function bracketedWeaponKeywordEffects(text) {
  const effects = [];
  for (const match of normalizeText(text).matchAll(/\[([^\]]+)\]/g)) {
    if (!bracketBelongsToWeaponEffect(text, match.index)) continue;
    const keyword = normalizeWeaponKeywordName(match[1]);
    if (keyword) effects.push({ kind: "keyword", weaponType: scopedWeaponTypeBefore(text.slice(0, match.index), effectWeaponType(text)), keyword });
  }
  const seen = new Set();
  return effects.filter(effect => {
    const key = `${effect.weaponType || ""}:${effect.keyword}`;
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
  const lower = normalizeText(prefix).toLowerCase();
  const meleeIndex = lower.lastIndexOf("melee weapons");
  const rangedIndex = lower.lastIndexOf("ranged weapons");
  if (meleeIndex > rangedIndex) return "Melee Weapons";
  if (rangedIndex > meleeIndex) return "Ranged Weapons";
  return fallbackWeaponType;
}

function normalizeWeaponKeywordName(value) {
  let keyword = normalizeText(value).replace(/\^/g, "");
  if (/^pyschic$/i.test(keyword)) keyword = "Psychic";
  if (!keyword || /\bthis ability\b/i.test(keyword) || /\bexample\b/i.test(keyword)) return "";
  if (/^Sustained Hits X$/i.test(keyword)) return "";
  const known = weaponKeywordRuleNames();
  const base = keyword.toLowerCase()
    .replace(/\s+\d+\+?$/, "")
    .replace(/^anti-[a-z0-9\s-]+$/, "anti");
  if (!known.has(base) && !/^anti-[a-z0-9\s-]+\s+\d+\+$/i.test(keyword)) return "";
  return keyword.toLowerCase().replace(/\b[a-z]/g, char => char.toUpperCase());
}

function isWeaponKeywordGlossaryEffect(effect) {
  const name = normalizeText(effect?.name || effect).toLowerCase();
  if (!name) return false;
  if (isWeaponKeywordRule(name)) return true;
  return false;
}

function effectAppliesAutomatically(text, sourceKind = "") {
  if (effectRequiresBattleState(text)) return false;
  if (sourceKind === "detachment" || sourceKind === "army") return true;
  return /while\s+.*\b(?:is\s+)?leading\b/i.test(text)
    || /\bwhile\s+.*\bunit\s+is\s+led\b/i.test(text)
    || /\bif\s+this\s+unit\s+is\s+attached\s+to\s+a\s+unit\b/i.test(text)
    || /\badd\s+\d+\s+to\s+the\s+bearer['’]s\s+\w+\s+characteristic\b/i.test(text)
    || /\bbearer['’]s\s+.+?\s+characteristics?\b/i.test(text)
    || /\bthe\s+bearer\s+has\s+(?:an?|their)\s+.+?\s+characteristics?\b/i.test(text)
    || /\bthe\s+bearer\s+has\b.*\bcharacteristics?\b/i.test(text)
    || /\bthis\s+model['’]s\s+.+?\s+characteristics?\b/i.test(text)
    || /\bcharacteristics?\s+of\s+this\s+model['’]s\b/i.test(text)
    || /\bcharacteristic\s+of\s+(?:the\s+)?bearer\b/i.test(text)
    || /\bmodels?\s+in\s+(?:the\s+)?bearer['’]s\s+unit\b/i.test(text)
    || /\bweapons?\s+equipped\s+by\s+(?:the\s+)?bearer\b/i.test(text)
    || /\bweapons?\s+equipped\s+by\s+(?:the\s+)?wearer\b/i.test(text)
    || /\bbearer['’]s\s+(?:melee|ranged)?\s*weapons?\b/i.test(text)
    || /\bbearer['’]s\s+(?:Pistols?|Psychic\s+weapons?|Torrent\s+weapons?)\b/i.test(text)
    || /\bcharacteristics?\s+of\b.*\bweapons?\b.*\bbearer\b/i.test(text)
    || /\bmodels?\s+in\s+(?:this|that)\s+unit\b/i.test(text)
    || /\bweapons?\s+equipped\s+by\s+models?\s+in\s+(?:this|that)\s+unit\b/i.test(text)
    || /\bthis\s+unit'?s\s+.*weapons?\b/i.test(text)
    || /\bthis\s+unit\s+has\s+\+\d+\s+(?:M|T|SV|W|LD|OC)\b/i.test(text);
}

function effectRecordRequiresBattleState(effect) {
  if (!effect || typeof effect !== "object") return false;
  const label = normalizeText([effect.name, effect.type, effect.kind].filter(Boolean).join(" "));
  if (/\bAura\b/i.test(label)) return true;
  const description = normalizeText(effect.description || effect.characteristics?.Description || "");
  const payloadIndex = firstStaticEffectPayloadIndex(description);
  if (payloadIndex > 0 && effectRequiresBattleState(description.slice(0, payloadIndex))) return true;
  return /\b(?:select|choose)\s+one\s+of\s+(?:the\s+)?(?:.+?\s+)?(?:below|following)\b/i.test(description)
    || /\b(?:select|choose)\s+which\b[\s\S]*?\b(?:active|augmentation|ability|effect)\b/i.test(description)
    || /\b(?:select|choose)\s+(?:one|a)\b[\s\S]*?\b(?:until\s+the\s+end|is\s+active|becomes?\s+active)\b/i.test(description);
}

function firstStaticEffectPayloadIndex(text) {
  const normalized = normalizeText(text);
  const patterns = [
    /\b(?:add|adds|adding|improve|improves|improving|change|set)\b[\s\S]*?\bcharacteristics?\b/i,
    /\b(?:melee|ranged|Psychic|Torrent|Pistol)?\s*weapons?\b[\s\S]*?\b(?:have|has|gain|gains)\b[\s\S]*?\[[^\]]+\]/i,
    /\b(?:models?\s+(?:in|from)\b[^.;]*?|units?\s+from\b[^.;]*?|(?:this|that)\s+unit)\s+(?:have|has|gain|gains)\s+(?:a\s+)?[2-6]\+\s*(?:InSv|invulnerable\s+save)\b/i,
    /\b(?:this\s+unit|models?\s+in\s+this\s+unit)\b[\s\S]*?\bhas\s+\+\d+\s+(?:M|T|SV|W|LD|OC)\b/i
  ];
  const indexes = patterns.map(pattern => normalized.search(pattern)).filter(index => index >= 0);
  return indexes.length ? Math.min(...indexes) : -1;
}

function effectRequiresBattleState(text) {
  const stableAttachment = /\bwhile\s+.*\b(?:is\s+)?leading\b/i.test(text)
    || /\bwhile\s+.*\bunit\s+is\s+led\b/i.test(text)
    || /\bif\s+this\s+unit\s+is\s+attached\s+to\s+a\s+unit\b/i.test(text);
  return /\bAura\b/i.test(text)
    || /\bwithin\s+\d+\s*(?:"|&quot;|inches?\b)/i.test(text)
    || (!stableAttachment && /\b(?:if|unless|when|whenever|while)\b/i.test(text))
    || /\b(?:once\s+per|each\s+time|after\s+|during\s+|for\s+every|selected\s+to)\b/i.test(text)
    || (!stableAttachment && /\b(?:at\s+the\s+start\s+of|until\s+)\b/i.test(text))
    || /\b(?:in|at\s+the\s+start\s+of|at\s+the\s+end\s+of)\s+(?:your|the|your\s+opponent['’]s|an?\s+opponent['’]s)\s+(?:Command|Movement|Shooting|Charge|Fight)\s+phase\b/i.test(text)
    || /\b(?:on\s+the\s+charge|made\s+(?:a|an)\s+(?:Charge|Advance|Normal|Fall\s+Back|Ingress)\s+move|charged\s+this\s+turn)\b/i.test(text)
    || /\b(?:remained\s+stationary|has\s+not\s+moved|is\s+engaged|within\s+Engagement\s+Range)\b/i.test(text)
    || /\bin\s+a\s+turn\s+in\s+which\b/i.test(text)
    || /\b(?:this|that)\s+(?:phase|turn|battle\s+round)\b/i.test(text)
    || /\b(?:is|becomes?|remains?)\s+active\b/i.test(text)
    || /\bif\s+the\s+Waaagh!?'?s?\s+active\b/i.test(text)
    || /\bif\s+the\s+Waaagh!?\s+is\s+active\b/i.test(text)
    || /\bwhile\s+the\s+Waaagh!?\s+is\s+active\b/i.test(text)
    || /\buntil\s+the\s+end\s+of\s+(?:the\s+)?(?:phase|turn|battle round)\b/i.test(text)
    || /\bbattle\s+rounds?\s+\d/i.test(text)
    || /\bduring\s+the\s+(?:first|second|third|fourth|fifth)[^.]*battle\s+rounds?\b/i.test(text)
    || /\bBattle[-\u2010-\u2015]?shocked\b/i.test(text)
    || /\bStarting Strength\b/i.test(text)
    || /\bBelow Half-strength\b/i.test(text)
    || /\bbelow Starting Strength\b/i.test(text)
    || /\bBenefit of Cover\b/i.test(text)
    || /\bfor every\s+\d+\s+models?\b/i.test(text)
    || /\bselect\s+one\b/i.test(text);
}

function effectWeaponType(text) {
  const hasMelee = /\bmelee\b/i.test(text);
  const hasRanged = /\branged\b/i.test(text);
  if (hasMelee && !hasRanged) return "Melee Weapons";
  if (hasRanged && !hasMelee) return "Ranged Weapons";
  return null;
}

function apImprovesByOne(text) {
  return /\b(?:improve|improves|improving)\s+the\s+Armou?r\s+Penetration\b.*\bby\s+1\b/i.test(text)
    || /\b(?:add|adds|adding)\s+1\s+to\s+the\s+Armou?r\s+Penetration\b/i.test(text)
    || /\b(?:improve|improves|improving)\s+the\s+AP\b.*\bby\s+1\b/i.test(text)
    || /\b(?:add|adds|adding)\s+1\s+to\s+the\s+AP\b/i.test(text);
}

function meleeStrengthImprovesByOne(text) {
  return /\badd\s+1\s+to\s+the\s+Strength\s+characteristic\s+of\s+melee\s+weapons\b/i.test(text);
}

function weaponAttacksImprovement(text) {
  const improveMatch = text.match(/\b(?:improve|improves|improving)\s+the\s+Attacks\s+characteristics?\s+of\s+(.+?)\s+by\s+(\d+)\b/i);
  if (improveMatch) return weaponAttackScope(improveMatch[1], Number(improveMatch[2]));

  const addMatch = text.match(/\b(?:add|adds|adding)\s+(\d+)\s+to\s+the\s+Attacks\s+characteristics?\s+of\s+(.+?)(?=,\s+and\b|[.;]|$)/i);
  if (addMatch) return weaponAttackScope(addMatch[2], Number(addMatch[1]));
  return "";
}

function weaponAttackScope(value, delta) {
  const weaponScope = normalizeText(value)
    .replace(/\s+equipped\s+by\s+(?:(?:models?\s+in\s+)?(?:this|that)\s+unit|that\s+unit|(?:the\s+)?bearer)\b.*$/i, "")
    .replace(/^(?:the\s+)?bearer['’]s\s+/i, "");
  if (/\bmelee\b/i.test(weaponScope)) return { weaponType: "Melee Weapons", delta };
  if (/\branged\b/i.test(weaponScope)) return { weaponType: "Ranged Weapons", delta };
  const namedWeapon = weaponScope.replace(/\s+weapons?$/i, "");
  return namedWeapon ? { weaponName: namedWeapon, delta } : "";
}

function bodyguardModelsOnly(text) {
  return /\bBodyguard\s+models?\b/i.test(text);
}

function applyWeaponEffectsToWeapon(weapon, effects, context = {}) {
  const next = clone(weapon) || {};
  const characteristics = clone(next.characteristics || {});
  const originalCharacteristics = clone(characteristics);
  for (const effect of effects) {
    if (effect.bearerInstanceId && effect.bearerInstanceId !== context.instanceId) continue;
    if (effect.bodyguardOnly && !context.isBodyguard) continue;
    if (!effectTargetsUnit(effect, context)) continue;
    if (effect.weaponType && effect.weaponType !== next.typeName) continue;
    if (effect.weaponName && !weaponNameMatches(effect.weaponName, next.name)) continue;
    if (effect.requiredWeaponKeyword && !weaponHasKeyword(characteristics, effect.requiredWeaponKeyword)) continue;
    if (effect.excludedWeaponKeyword && weaponHasKeyword(characteristics, effect.excludedWeaponKeyword)) continue;
    if (effect.kind === "keyword") characteristics.Keywords = addWeaponKeyword(characteristics.Keywords ?? characteristics.keywords, effect.keyword);
    if (effect.kind === "ap") characteristics.AP = improveAp(characteristics.AP, effect.delta);
    if (effect.kind === "characteristic") characteristics[effect.characteristic] = applyCharacteristicDelta(characteristics[effect.characteristic], effect.delta, effect.characteristic);
    if (effect.kind === "set-characteristic") characteristics[effect.characteristic] = effect.value;
  }
  next.characteristics = characteristics;
  next.modifiedCharacteristics = mergedModifiedCharacteristics(
    next.modifiedCharacteristics,
    changedCharacteristicNames(originalCharacteristics, characteristics)
  );
  return next;
}

function weaponHasKeyword(characteristics, keyword) {
  return normalizeText(characteristics.Keywords ?? characteristics.keywords)
    .split(",")
    .map(item => normalizeText(item).toLowerCase())
    .some(item => item === normalizeText(keyword).toLowerCase() || item.startsWith(`${normalizeText(keyword).toLowerCase()} `));
}

function effectTargetsUnit(effect, context = {}) {
  if (!(effect.targets || []).length) return true;
  const candidates = [
    context.unitName,
    ...asArray(context.unitNames),
    ...asArray(context.keywords)
  ].map(normalizeMatchText).filter(Boolean);
  return effect.targets.some(target => candidates.some(candidate =>
    candidate === target || candidate.includes(target) || target.includes(candidate)
  ));
}

function normalizeWeaponName(value) {
  return normalizeText(value).toLowerCase().replace(/^[^a-z0-9]+/, "");
}

function weaponNameMatches(effectName, weaponName) {
  const effect = normalizeWeaponName(effectName);
  const weapon = normalizeWeaponName(weaponName);
  return effect === weapon
    || (weapon.startsWith(effect) && /[\s:—–-]/.test(weapon.charAt(effect.length)));
}

function applyUnitEffectsToProfiles(profiles = [], effects = [], context = {}) {
  const unitEffects = extractUnitEffects(effects);
  if (!unitEffects.length) return clone(profiles);
  return asArray(profiles).map(profile => {
    const next = clone(profile) || {};
    const characteristics = clone(next.characteristics || {});
    const originalCharacteristics = clone(characteristics);
    for (const effect of unitEffects) {
      if (effect.bearerInstanceId && effect.bearerInstanceId !== context.instanceId) continue;
      if (effect.bodyguardOnly && !context.isBodyguard) continue;
      if (!effectTargetsUnit(effect, context)) continue;
      if (effect.kind === "set-characteristic") {
        characteristics[effect.characteristic] = effect.value;
      } else {
        characteristics[effect.characteristic] = applyCharacteristicDelta(characteristics[effect.characteristic], effect.delta, effect.characteristic);
      }
    }
    next.characteristics = characteristics;
    next.modifiedCharacteristics = mergedModifiedCharacteristics(
      next.modifiedCharacteristics,
      changedCharacteristicNames(originalCharacteristics, characteristics)
    );
    return next;
  });
}

function changedCharacteristicNames(before = {}, after = {}) {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter(key => normalizeText(before[key]) !== normalizeText(after[key]));
}

function mergedModifiedCharacteristics(existing = [], changed = []) {
  return [...new Set([...asArray(existing), ...asArray(changed)])];
}

function extractUnitEffects(effects = []) {
  const extracted = asArray(effects).flatMap(effect => {
    if (effectRecordRequiresBattleState(effect)) return [];
    const source = effect?.sourceKind || effect?.source || "";
    return effectTextParts(effect).flatMap(text => staticEffectClauses(text).flatMap(clause =>
      extractUnitEffectsFromText(clause, source).map(extractedEffect => ({
        ...extractedEffect,
        bearerInstanceId: extractedEffect.scope === "bearer" ? effect?.bearerInstanceId || null : null
      }))
    ));
  });
  const seen = new Set();
  const result = [];
  for (const effect of extracted) {
    const key = [effect.kind, effect.characteristic, effect.bodyguardOnly ? "bodyguard" : "", effect.scope || "", (effect.targets || []).join("/"), effect.bearerInstanceId || "", effect.delta, effect.value].join(":");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(effect);
  }
  return result;
}

function extractUnitEffectsFromText(text, sourceKind = "") {
  const normalized = normalizeText(text);
  if (!normalized || !effectAppliesAutomatically(normalized, sourceKind)) return [];
  const effects = [];
  const genericCharacteristics = genericModelCharacteristicEffects(normalized);
  effects.push(...genericCharacteristics);
  const toughnessMatch = normalized.match(/\badd\s+(\d+)\s+to\s+the\s+(?:bearer['’]s|model['’]s|models?['’])?\s*Toughness\s+characteristic(?:\s+of\s+(?:Bodyguard\s+)?models)?\b/i);
  if (toughnessMatch && !genericCharacteristics.some(effect => effect.characteristic === "T")) {
    effects.push({ kind: "unit-characteristic", characteristic: "T", delta: Number(toughnessMatch[1]), bodyguardOnly: bodyguardModelsOnly(normalized) });
  }
  for (const effect of modelCharacteristicEffects(normalized)) {
    if (!genericCharacteristics.some(item => item.characteristic === effect.characteristic && item.kind === effect.kind)) effects.push(effect);
  }
  return effects;
}

function genericModelCharacteristicEffects(text) {
  if (!/\bcharacteristics?\b/i.test(text) || /\bweapons?\b/i.test(text)) return [];
  const effects = [];
  for (const match of text.matchAll(/\b(add|adds|adding)\s+(\d+)\s*(?:"|&quot;|inches?)?\s+to\s+this\s+model['’]s\s+(.+?)\s+characteristics?\b/ig)) {
    for (const characteristic of characteristicNames(match[3])) {
      effects.push({
        kind: "unit-characteristic",
        scope: "model",
        characteristic,
        delta: characteristicOperationDelta(characteristic, Number(match[2]), "add")
      });
    }
  }
  for (const match of text.matchAll(/\b(add|adds|adding)\s+(\d+)\s*(?:"|&quot;|inches?)?\s+to\s+(?:the\s+)?bearer['’]s\s+(.+?)\s+characteristics?\b/ig)) {
    for (const characteristic of characteristicNames(match[3])) {
      effects.push({
        kind: "unit-characteristic",
        scope: "bearer",
        characteristic,
        delta: characteristicOperationDelta(characteristic, Number(match[2]), "add")
      });
    }
  }
  for (const match of text.matchAll(/\b(improve|improves|improving)\s+(?:the\s+)?bearer['’]s\s+(.+?)\s+characteristics?\s+by\s+(\d+)\b/ig)) {
    for (const characteristic of characteristicNames(match[2])) {
      effects.push({
        kind: "unit-characteristic",
        scope: "bearer",
        characteristic,
        delta: characteristicOperationDelta(characteristic, Number(match[3]), "improve")
      });
    }
  }
  for (const match of text.matchAll(/\b(add|adds|adding)\s+(\d+)\s*(?:"|&quot;|inches?)?\s+to\s+(?:the\s+)?(.+?)\s+characteristics?\s+of\s+(.+?)(?=(?:\s+and\s+add\s+\d+\s+to\s+(?:Advance|Charge|Hit|Wound|save)\b)|[.;]|$)/ig)) {
    effects.push(...unitEffectsForNames(match[3], match[4], Number(match[2]), "add"));
  }
  for (const match of text.matchAll(/\b(improve|improves|improving)\s+(?:the\s+)?(.+?)\s+characteristics?\s+of\s+(.+?)\s+by\s+(\d+)\b/ig)) {
    effects.push(...unitEffectsForNames(match[2], match[3], Number(match[4]), "improve"));
  }
  for (const match of text.matchAll(/\b(.+?)\s+have\s+(?:an?|their)\s+(.+?)\s+characteristics?\s+of\s+([0-9]+(?:\+|")?)(?=[.;]|$)/ig)) {
    const scope = unitEffectScope(match[1]);
    for (const characteristic of characteristicNames(match[2])) {
      effects.push({ kind: "set-characteristic", ...scope, characteristic, value: normalizeText(match[3]) });
    }
  }
  for (const match of text.matchAll(/\b(.+?)\s+has\s+(?:an?|their)\s+(.+?)\s+characteristics?\s+of\s+([0-9]+(?:\+|")?)(?=\s+and\b|[.;]|$)/ig)) {
    const scope = unitEffectScope(match[1]);
    for (const characteristic of characteristicNames(match[2])) {
      effects.push({ kind: "set-characteristic", ...scope, characteristic, value: normalizeText(match[3]) });
    }
  }
  for (const match of text.matchAll(/\bthe\s+bearer\s+has\b.*?\band\s+(?:an?|their)\s+(.+?)\s+characteristics?\s+of\s+([0-9]+(?:\+|")?)(?=\s+and\b|[.;]|$)/ig)) {
    for (const characteristic of characteristicNames(match[1])) {
      effects.push({ kind: "set-characteristic", scope: "bearer", characteristic, value: normalizeText(match[2]) });
    }
  }
  for (const match of text.matchAll(/\b(?:the\s+)?bearer['’]s\s+(.+?)\s+characteristic\s+(?:becomes|is)\s+([0-9]+(?:\+|")?)(?=[.;]|$)/ig)) {
    for (const characteristic of characteristicNames(match[1])) {
      effects.push({ kind: "set-characteristic", scope: "bearer", characteristic, value: normalizeText(match[2]) });
    }
  }
  return effects;
}

function unitEffectsForNames(names, scopeText, amount, operation) {
  const scope = unitEffectScope(scopeText);
  return characteristicNames(names).map(characteristic => ({
    kind: "unit-characteristic",
    ...scope,
    characteristic,
    delta: characteristicOperationDelta(characteristic, amount, operation),
    bodyguardOnly: bodyguardModelsOnly(scopeText)
  }));
}

function unitEffectScope(value) {
  const text = normalizeText(value);
  const scope = /\b(?:the\s+)?bearer\b|\bbearer['’]s\b/i.test(text) && !/\bbearer['’]s\s+unit\b/i.test(text)
    ? "bearer"
    : /\bbearer['’]s\s+unit\b|\b(?:this|that)\s+unit\b/i.test(text)
      ? "bearer-unit"
      : "";
  return { scope, targets: unitEffectTargets(text) };
}

function unitEffectTargets(text) {
  const patterns = [
    /\bmodels?\s+in\s+(.+?)\s+units?\s+from\s+your\s+army\b/i,
    /\bFriendly\s+(.+?)\s+units?\b/i,
    /\b(.+?)\s+models?\s+in\s+those\s+units?\b/i
  ];
  for (const pattern of patterns) {
    const match = normalizeText(text).match(pattern);
    if (!match) continue;
    const subject = match[1].split(/\band\b/i).at(-1) || match[1];
    const target = normalizeMatchText(subject.replace(/\bmodels?\b/ig, "").replace(/\bunits?\b/ig, ""));
    return target ? [target] : [];
  }
  return [];
}

function modelCharacteristicEffects(text) {
  const effects = [];
  const setPatterns = [
    ["M", /\bmodels?\s+in\s+(?:this|that)\s+unit\s+have\s+a\s+Move\s+characteristic\s+of\s+(.+?)(?:\s+and\b|[.,;]|$)/i],
    ["M", /\bchange\s+the\s+Move\s+characteristic\s+of\s+models?\s+in\s+(?:this|that)\s+unit\s+to\s+(.+?)(?:\s+and\b|[.,;]|$)/i],
    ["SV", /\bmodels?\s+in\s+(?:this|that)\s+unit\s+have\s+a\s+Save\s+characteristic\s+of\s+(.+?)(?:\s+and\b|[.,;]|$)/i]
  ];
  for (const [characteristic, pattern] of setPatterns) {
    const match = text.match(pattern);
    if (match) effects.push({ kind: "set-characteristic", characteristic, value: normalizeText(match[1]), bodyguardOnly: bodyguardModelsOnly(text) });
  }
  for (const [name, characteristic] of [
    ["Move", "M"],
    ["Objective Control", "OC"],
    ["Leadership", "LD"]
  ]) {
    const addMatch = text.match(new RegExp(`\\badd\\s+(\\d+)\\s+to\\s*(?:the\\s+)?${name}\\s+characteristic\\s+of\\s+models?\\s+in\\s+(?:this|that)\\s+unit\\b`, "i"));
    if (addMatch) effects.push({ kind: "unit-characteristic", characteristic, delta: Number(addMatch[1]), bodyguardOnly: bodyguardModelsOnly(text) });
    const improveMatch = text.match(new RegExp(`\\bimprove\\s+the\\s+${name}\\s+characteristic\\s+of\\s+models?\\s+in\\s+(?:this|that)\\s+unit\\s+by\\s+(\\d+)\\b`, "i"));
    if (improveMatch) {
      const amount = Number(improveMatch[1]);
      effects.push({ kind: "unit-characteristic", characteristic, delta: characteristicImprovementDelta(characteristic, amount), bodyguardOnly: bodyguardModelsOnly(text) });
    }
  }
  for (const [abbreviation, characteristic] of [
    ["M", "M"],
    ["T", "T"],
    ["W", "W"],
    ["LD", "LD"],
    ["OC", "OC"]
  ]) {
    const shorthandMatch = text.match(new RegExp(`\\bthis\\s+unit\\s+has\\s+\\+(\\d+)\\s+${abbreviation}\\b`, "i"));
    if (!shorthandMatch) continue;
    effects.push({
      kind: "unit-characteristic",
      characteristic,
      delta: characteristicImprovementDelta(characteristic, Number(shorthandMatch[1])),
      bodyguardOnly: false
    });
  }
  return effects;
}

function characteristicImprovementDelta(characteristic, amount) {
  if (characteristic === "LD" || characteristic === "SV") return -amount;
  return amount;
}

function addNumericCharacteristic(value, delta) {
  const text = normalizeText(value);
  if (!/^-?\d+$/.test(text)) return value;
  return String(Number(text) + Number(delta || 0));
}

function applyCharacteristicDelta(value, delta, characteristic = "") {
  if (["BS", "WS", "LD", "SV"].includes(characteristic)) return improvePlusCharacteristic(value, delta);
  if (characteristic === "M" || characteristic === "Range") return addMoveCharacteristic(value, delta);
  return addNumericOrDiceCharacteristic(value, delta);
}

function addNumericOrDiceCharacteristic(value, delta) {
  const numeric = addNumericCharacteristic(value, delta);
  if (numeric !== value) return numeric;
  const text = normalizeText(value);
  if (!/^\d*D\d+(?:[+-]\d+)?$/i.test(text) || !Number(delta)) return value;
  const suffix = text.match(/([+-]\d+)$/);
  const base = suffix ? text.slice(0, -suffix[1].length) : text;
  const total = Number(suffix?.[1] || 0) + Number(delta);
  return total ? `${base}${total > 0 ? "+" : ""}${total}` : base;
}

function improvePlusCharacteristic(value, delta) {
  const text = normalizeText(value);
  const match = text.match(/^(\d+)\+$/);
  if (!match) return value;
  return `${Math.max(2, Number(match[1]) + Number(delta || 0))}+`;
}

function addMoveCharacteristic(value, delta) {
  const text = normalizeText(value);
  const match = text.match(/^(-?\d+)(.*)$/);
  if (!match) return value;
  return `${Number(match[1]) + Number(delta || 0)}${match[2]}`;
}

function addWeaponKeyword(value, keyword) {
  const entries = normalizeText(value).split(",").map(normalizeText).filter(item => item && item !== "-");
  const nextSustained = sustainedHitsValue(keyword);
  if (nextSustained !== null) {
    let best = nextSustained;
    const withoutSustained = [];
    for (const entry of entries) {
      const current = sustainedHitsValue(entry);
      if (current === null) {
        withoutSustained.push(entry);
      } else {
        best = Math.max(best, current);
      }
    }
    withoutSustained.push(`Sustained Hits ${best}`);
    return withoutSustained.join(", ");
  }
  const seen = new Set(entries.map(item => item.toLowerCase()));
  if (!seen.has(keyword.toLowerCase())) entries.push(keyword);
  return entries.join(", ");
}

function sustainedHitsValue(value) {
  const match = normalizeText(value).match(/^Sustained\s+Hits\s+(\d+)$/i);
  return match ? Number(match[1]) : null;
}

function improveAp(value, delta) {
  const text = normalizeText(value);
  if (!/^-?\d+$/.test(text)) return value;
  return String(Number(text) + Number(delta || 0));
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
      description: item.characteristics?.Description || item.characteristics?.Capacity || item.description || "",
      profileType: item.typeName || "Abilities",
      providerUnitName: record?.name || "Unit",
      provider: abilityProviderName(record, item)
    }))
    .filter(sheetRelevantAbility);
}

function abilityProviderName(record, ability) {
  const sectionName = normalizeText(ability?.typeName);
  if (sectionName && !["abilities", "unit"].includes(sectionName.toLowerCase())) {
    const recordName = normalizeText(record?.name).toLowerCase();
    if (sectionName.toLowerCase() !== recordName) return sectionName;
  }
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

function statlinesForRecord(record, enhancements = [], effects = [], context = {}) {
  const recordContext = { ...context, unitName: record?.name || "", keywords: record?.keywords || [] };
  const inferredInSv = inferredInvulnerableSave(record, enhancements, effects, recordContext);
  return applyUnitEffectsToProfiles(unitProfiles(record), effects, recordContext).map(profile => {
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
      modifiedCharacteristics: clone(profile.modifiedCharacteristics || []),
      characteristics
    };
  });
}

function inferredInvulnerableSave(record, enhancements = [], effects = [], context = {}) {
  const texts = [
    ...asArray(configuredFor(record).abilities).flatMap(invulnerableEffectTextParts),
    ...asArray(configuredFor(record).rules).flatMap(invulnerableEffectTextParts),
    ...asArray(configuredFor(record).profiles).flatMap(invulnerableEffectTextParts),
    ...asArray(enhancements).flatMap(invulnerableEffectTextParts),
    ...invulnerableEffectTextsFromEffects(effects, context)
  ];
  return bestSave("", ...texts.map(extractInvulnerableSave).filter(Boolean));
}

function invulnerableEffectTextsFromEffects(effects = [], context = {}) {
  return asArray(effects).flatMap(effect => {
    if (effect?.bodyguardOnly && !context.isBodyguard) return [];
    if (effectRecordRequiresBattleState(effect)) return [];
    const source = effect?.sourceKind || effect?.source || "";
    return invulnerableEffectTextParts(effect).filter(text =>
      effectAppliesAutomatically(text, source) && invulnerableEffectTargetsUnit(text, context)
    );
  });
}

function invulnerableEffectTargetsUnit(text, context = {}) {
  const normalized = normalizeText(text);
  const marker = normalized.search(/\bmodels?\s+from\s+your\s+army\s+have\s+(?:a\s+)?[2-6]\+\s*(?:InSv|invulnerable\s+save)/i);
  if (marker < 0) return true;
  const prefix = normalized.slice(0, marker);
  const subject = prefix.split(/\s+-\s+/).at(-1)?.replace(/^Friendly\s+/i, "").trim() || "";
  if (!subject) return true;
  const targets = subject.split(/\s*\/\s*/).map(normalizeMatchText).filter(Boolean);
  const candidates = [context.unitName, ...(context.keywords || [])].map(normalizeMatchText).filter(Boolean);
  return targets.some(target => candidates.some(candidate => candidate === target || candidate.includes(target) || target.includes(candidate)));
}

function normalizeMatchText(value) {
  return normalizeText(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function effectTextParts(item) {
  const description = item?.description || item?.characteristics?.Description || "";
  return [
    item?.name,
    description,
    ...(item?.profiles || []).flatMap(effectTextParts),
    ...(item?.rules || []).flatMap(effectTextParts)
  ].filter(Boolean);
}

function invulnerableEffectTextParts(item) {
  const description = item?.description || item?.characteristics?.Description || "";
  return [
    ...effectTextParts(item),
    `${item?.name || ""} ${description}`.trim(),
    ...(item?.profiles || []).flatMap(invulnerableEffectTextParts),
    ...(item?.rules || []).flatMap(invulnerableEffectTextParts)
  ].filter(Boolean);
}

function invulnerableSaveValue(characteristics = {}) {
  const value = normalizeText(characteristics.InSv || characteristics["Invulnerable Save"]);
  return value && value !== "-" ? value : "";
}

function extractInvulnerableSave(text) {
  const normalized = normalizeText(text);
  const match = normalized.match(/\b([2-6]\+)\s*(?:\*\*)?\s*(?:InSv|invulnerable\s+save)\b/i)
    || normalized.match(/\b(?:InSv|invulnerable\s+save)\s*(?::|of)?\s*(?:\*\*)?\s*([2-6]\+)/i);
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

function selectedRuleEffects(document) {
  return [
    ...asArray(document?.armyRules).map(item => ({ ...item, sourceKind: "army" })),
    ...asArray(document?.detachments).flatMap(detachment =>
      asArray(detachment.rules).map(rule => ({ ...rule, sourceKind: "detachment", sourceLabel: detachment.name }))
    )
  ];
}

function memberRuleEffects(records, document, memberIds) {
  return [
    ...selectedRuleEffects(document),
    ...records.flatMap(record => [
      ...asArray(configuredFor(record).abilities),
      ...asArray(configuredFor(record).rules),
      ...asArray(configuredFor(record).profiles)
    ]),
    ...enhancementRecords(document, memberIds)
  ];
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
  const weaponEffects = memberRuleEffects(records, document, memberIds);
  const bodyguardInstanceId = group?.bodyguard?.instanceId || memberIds[0] || null;

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
    statlines: records.flatMap(record => statlinesForRecord(record, enhancementsByBearer.get(record.instanceId), weaponEffects, {
      instanceId: record.instanceId,
      isBodyguard: record.instanceId === bodyguardInstanceId,
      unitNames: records.map(item => item.name),
      keywords
    })),
    rangedWeapons: records.flatMap(item => effectiveWeaponsFor(item, "Ranged Weapons", weaponEffects, {
      instanceId: item.instanceId,
      isBodyguard: item.instanceId === bodyguardInstanceId,
      unitNames: records.map(record => record.name),
      keywords
    })).map(clone),
    meleeWeapons: records.flatMap(item => effectiveWeaponsFor(item, "Melee Weapons", weaponEffects, {
      instanceId: item.instanceId,
      isBodyguard: item.instanceId === bodyguardInstanceId,
      unitNames: records.map(record => record.name),
      keywords
    })).map(clone),
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
  const weaponEffects = memberRuleEffects([record], document, [record.instanceId]);
  const profile = statlinesForRecord(record, enhancementRecords(document, [record.instanceId]), weaponEffects, {
    instanceId: record.instanceId
  })[0] || {};
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
      ...effectiveWeaponsFor(record, "Ranged Weapons", weaponEffects),
      ...effectiveWeaponsFor(record, "Melee Weapons", weaponEffects)
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
    forceDisposition: clone(detachment.forceDisposition || null),
    rules: asArray(detachment.rules).filter(rule => sheetRelevantReferenceRule(rule, legend)).map(clone),
    stratagems: asArray(detachment.stratagems).map(stratagem => ({
      ...clone(stratagem),
      detachmentName: detachment.name,
      sourceLabel: detachment.name || stratagem.detachment || "Detachment"
    }))
  }));
  const forceDispositions = asArray(document?.forceDispositions).map(disposition => ({
    id: disposition.id,
    name: disposition.name,
    hidden: Boolean(disposition.hidden),
    missionMap: clone(disposition.missionMap || [])
  }));
  const { coreStratagems } = stratagemRecords(document);
  return {
    rules: {
      id: "reference:rules",
      kind: "rules-reference",
      title: "Army & Detachment Rules",
      armyRules: asArray(document?.armyRules).filter(rule => sheetRelevantReferenceRule(rule, legend)).map(clone),
      weaponKeywordLegend: legend,
      detachments,
      forceDispositions
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
    forceDispositions: clone(document?.forceDispositions || []),
    missionSetup: clone(document?.missionSetup || null),
    referenceSheets: buildReferenceSheets(document),
    combinedUnitSheets: uniqueReferenceSheets(combinedUnitSheets),
    crusadeSheets: asArray(document?.rosterEntries).map(record => buildCrusadeSheet(document, record))
  };
}

const sheetsApi = {
  applyUnitEffectsToProfiles,
  applyWeaponEffectsToConfigured,
  buildRosterSheets,
  effectAppliesAutomatically,
  effectRequiresBattleState,
  extractUnitEffects,
  extractWeaponEffects
};

if (typeof module !== "undefined" && module.exports) module.exports = sheetsApi;
if (typeof window !== "undefined") window.RosterSheets = sheetsApi;
