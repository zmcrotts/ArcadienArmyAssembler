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
  const configured = applyWeaponEffectsToConfigured(configuredFor(record), effects, context);
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
    const source = effect?.sourceKind || effect?.source || "";
    return effectTextParts(effect).flatMap(text => extractWeaponEffectsFromText(text, source));
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
      effect.bodyguardOnly ? "bodyguard" : "",
      effect.delta ?? ""
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

  if (apImprovesByOne(normalized)) effects.push({ kind: "ap", weaponType, delta: -1 });
  if (meleeStrengthImprovesByOne(normalized)) {
    effects.push({ kind: "characteristic", weaponType: "Melee Weapons", characteristic: "S", delta: 1, bodyguardOnly: bodyguardModelsOnly(normalized) });
  }
  const attacks = weaponAttacksImproveByOne(normalized);
  if (attacks) {
    effects.push({
      kind: "characteristic",
      weaponType: attacks.weaponType || "",
      weaponName: attacks.weaponName || "",
      characteristic: "A",
      delta: 1,
      bodyguardOnly: bodyguardModelsOnly(normalized)
    });
  }

  return effects;
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
    || /\bmodels?\s+in\s+(?:this|that)\s+unit\b/i.test(text)
    || /\bweapons?\s+equipped\s+by\s+models?\s+in\s+(?:this|that)\s+unit\b/i.test(text)
    || /\bthis\s+unit'?s\s+.*weapons?\b/i.test(text);
}

function effectRequiresBattleState(text) {
  return /\bAura\b/i.test(text)
    || /\bwithin\s+\d+\s*(?:"|&quot;|inches?\b)/i.test(text)
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

function weaponAttacksImproveByOne(text) {
  const match = text.match(/\badd\s+1\s+to\s+the\s+Attacks\s+characteristic\s+of\s+(.+?)\s+weapons\s+equipped\s+by\s+(?:(?:models\s+in\s+)?(?:this|that)\s+unit|that\s+unit)\b/i);
  if (!match) return "";
  const weaponScope = normalizeText(match[1]);
  if (/^ranged$/i.test(weaponScope)) return { weaponType: "Ranged Weapons" };
  if (/^melee$/i.test(weaponScope)) return { weaponType: "Melee Weapons" };
  return { weaponName: weaponScope };
}

function bodyguardModelsOnly(text) {
  return /\bBodyguard\s+models?\b/i.test(text);
}

function applyWeaponEffectsToWeapon(weapon, effects, context = {}) {
  const next = clone(weapon) || {};
  const characteristics = clone(next.characteristics || {});
  for (const effect of effects) {
    if (effect.bodyguardOnly && !context.isBodyguard) continue;
    if (effect.weaponType && effect.weaponType !== next.typeName) continue;
    if (effect.weaponName && normalizeWeaponName(effect.weaponName) !== normalizeWeaponName(next.name)) continue;
    if (effect.kind === "keyword") characteristics.Keywords = addWeaponKeyword(characteristics.Keywords ?? characteristics.keywords, effect.keyword);
    if (effect.kind === "ap") characteristics.AP = improveAp(characteristics.AP, effect.delta);
    if (effect.kind === "characteristic") characteristics[effect.characteristic] = addNumericCharacteristic(characteristics[effect.characteristic], effect.delta);
  }
  next.characteristics = characteristics;
  return next;
}

function normalizeWeaponName(value) {
  return normalizeText(value).toLowerCase();
}

function applyUnitEffectsToProfiles(profiles = [], effects = [], context = {}) {
  const unitEffects = extractUnitEffects(effects);
  if (!unitEffects.length) return clone(profiles);
  return asArray(profiles).map(profile => {
    const next = clone(profile) || {};
    const characteristics = clone(next.characteristics || {});
    for (const effect of unitEffects) {
      if (effect.bodyguardOnly && !context.isBodyguard) continue;
      if (effect.kind === "set-characteristic") {
        characteristics[effect.characteristic] = effect.value;
      } else {
        characteristics[effect.characteristic] = applyCharacteristicDelta(characteristics[effect.characteristic], effect.delta, effect.characteristic);
      }
    }
    next.characteristics = characteristics;
    return next;
  });
}

function extractUnitEffects(effects = []) {
  const extracted = asArray(effects).flatMap(effect => {
    const source = effect?.sourceKind || effect?.source || "";
    return effectTextParts(effect).flatMap(text => extractUnitEffectsFromText(text, source));
  });
  const seen = new Set();
  const result = [];
  for (const effect of extracted) {
    const key = [effect.kind, effect.characteristic, effect.bodyguardOnly ? "bodyguard" : "", effect.delta].join(":");
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
  if (/\badd\s+1\s+to\s+the\s+Toughness\s+characteristic\s+of\s+(?:Bodyguard\s+)?models\b/i.test(normalized)) {
    effects.push({ kind: "unit-characteristic", characteristic: "T", delta: 1, bodyguardOnly: bodyguardModelsOnly(normalized) });
  }
  for (const effect of modelCharacteristicEffects(normalized)) {
    effects.push(effect);
  }
  return effects;
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
  if (characteristic === "LD" || characteristic === "SV") return improvePlusCharacteristic(value, delta);
  if (characteristic === "M") return addMoveCharacteristic(value, delta);
  return addNumericCharacteristic(value, delta);
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
  const inferredInSv = inferredInvulnerableSave(record, enhancements, effects, context);
  return applyUnitEffectsToProfiles(unitProfiles(record), effects, context).map(profile => {
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
    const source = effect?.sourceKind || effect?.source || "";
    return invulnerableEffectTextParts(effect).filter(text => effectAppliesAutomatically(text, source));
  });
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
    statlines: records.flatMap(record => statlinesForRecord(record, enhancementsByBearer.get(record.instanceId), weaponEffects, { isBodyguard: record.instanceId === bodyguardInstanceId })),
    rangedWeapons: records.flatMap(item => effectiveWeaponsFor(item, "Ranged Weapons", weaponEffects, { isBodyguard: item.instanceId === bodyguardInstanceId })).map(clone),
    meleeWeapons: records.flatMap(item => effectiveWeaponsFor(item, "Melee Weapons", weaponEffects, { isBodyguard: item.instanceId === bodyguardInstanceId })).map(clone),
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
  const profile = statlinesForRecord(record, enhancementRecords(document, [record.instanceId]), weaponEffects)[0] || {};
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

const sheetsApi = { applyUnitEffectsToProfiles, applyWeaponEffectsToConfigured, buildRosterSheets };

if (typeof module !== "undefined" && module.exports) module.exports = sheetsApi;
if (typeof window !== "undefined") window.RosterSheets = sheetsApi;
