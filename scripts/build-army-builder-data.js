const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const UNIT_DIR = path.join(ROOT, "data", "builder-units");
const DATASHEET_DIR = path.join(ROOT, "data", "json");
const OVERRIDES_FILE = path.join(ROOT, "data", "overrides", "11th", "points-overrides.json");
const OUT = path.join(ROOT, "ui", "army-builder-data.js");

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function normalizeName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function loadDatasheets() {
  const byName = new Map();
  const files = fs.readdirSync(DATASHEET_DIR).filter(f => f.endsWith("-datasheets.json"));

  for (const fileName of files) {
    const json = readJson(path.join(DATASHEET_DIR, fileName));

    const sheets = Array.isArray(json)
      ? json
      : Array.isArray(json.datasheets)
        ? json.datasheets
        : Array.isArray(json.units)
          ? json.units
          : [];

    for (const sheet of sheets) {
      if (!sheet?.name) continue;
      const key = normalizeName(sheet.name);
      if (!byName.has(key)) byName.set(key, []);
      byName.get(key).push({ ...sheet, datasheetSourceFile: fileName });
    }
  }

  return byName;
}

function loadOverrides() {
  if (!fs.existsSync(OVERRIDES_FILE)) return new Map();

  const json = readJson(OVERRIDES_FILE);
  const map = new Map();

  for (const [factionName, faction] of Object.entries(json.factions || {})) {
    for (const [unitName, override] of Object.entries(faction.units || {})) {
      const key = `${normalizeName(factionName)}::${normalizeName(unitName)}`;
      map.set(key, override);
    }
  }

  return map;
}

function factionCandidates(unit, jsonFaction) {
  return [
    unit.sourceFaction,
    unit.selectableInFaction,
    jsonFaction,
    jsonFaction?.replace("Imperium - Space Marines", "Adeptus Astartes"),
    jsonFaction?.replace("Chaos - Chaos Space Marines", "Heretic Astartes"),
    jsonFaction?.replace("Aeldari - Craftworlds", "Asuryani"),
    jsonFaction?.replace("Chaos - Chaos Daemons", "Legiones Daemonica")
  ].filter(Boolean);
}

function findOverride(unit, jsonFaction, overrides) {
  for (const faction of factionCandidates(unit, jsonFaction)) {
    const key = `${normalizeName(faction)}::${normalizeName(unit.name)}`;
    if (overrides.has(key)) return overrides.get(key);
  }
  return null;
}

function parsePointsChangeText(text) {
  const value = String(text || "");

  const arrow = value.match(/(\d+)\s*->\s*(\d+)/);
  const exactModels = value.match(/\((\d+)\s+models?\)/i);
  const rangeModels = value.match(/\((\d+)\s*-\s*(\d+)\s+models?\)/i);
  const copyTag = value.match(/\[(.*?)\]/);

  return {
    oldPoints: arrow ? Number(arrow[1]) : null,
    newPoints: arrow ? Number(arrow[2]) : null,
    exactModels: exactModels ? Number(exactModels[1]) : null,
    minModels: rangeModels ? Number(rangeModels[1]) : null,
    maxModels: rangeModels ? Number(rangeModels[2]) : null,
    copyTag: copyTag ? copyTag[1] : null,
    rawText: value
  };
}

function getPrimaryDelta(override) {
  if (!override?.changes?.length) return 0;

  const usable = override.changes.filter(c => {
    if (typeof c.delta !== "number") return false;

    const text = String(c.text || "").toLowerCase();

    if (text.includes("model")) return false;
    if (text.includes("2nd")) return false;
    if (text.includes("3rd")) return false;
    if (text.includes("copy")) return false;
    if (text.includes("new")) return false;
    if (text.includes("wargear")) return false;

    return /\d+\s*->\s*\d+/.test(text);
  });

  if (!usable.length) return 0;

  return usable[usable.length - 1].delta;
}

function buildSizeOptions(unit, override, displayPoints, basePoints) {
  const parsedOptions = [];

  const rows = [
    ...(override?.changes || []),
    ...(override?.copyRules || [])
  ];

  for (const row of rows) {
    const parsed = parsePointsChangeText(row.text);

    if (!parsed.newPoints) continue;

    if (parsed.minModels !== null && parsed.maxModels !== null) {
      parsedOptions.push({
        label: `${parsed.minModels}-${parsed.maxModels} models`,
        minModels: parsed.minModels,
        maxModels: parsed.maxModels,
        modelCount: null,
        points: parsed.newPoints,
        oldPoints: parsed.oldPoints,
        delta: row.delta,
        copyTag: parsed.copyTag,
        source: "override",
        rawText: parsed.rawText
      });
    } else if (parsed.exactModels !== null) {
      parsedOptions.push({
        label: `${parsed.exactModels} models`,
        minModels: parsed.exactModels,
        maxModels: parsed.exactModels,
        modelCount: parsed.exactModels,
        points: parsed.newPoints,
        oldPoints: parsed.oldPoints,
        delta: row.delta,
        copyTag: parsed.copyTag,
        source: "override",
        rawText: parsed.rawText
      });
    }
  }

  const baseWasReplacedByModelOption = parsedOptions.some(option =>
    option.oldPoints === basePoints &&
    option.points !== basePoints
  );

  const options = [];

  if (!baseWasReplacedByModelOption) {
    options.push({
      label: "Base size",
      minModels: null,
      maxModels: null,
      modelCount: null,
      points: displayPoints,
      oldPoints: basePoints,
      delta: displayPoints - basePoints,
      source: "base"
    });
  }

  options.push(...parsedOptions);

  const unique = [];
  const seen = new Set();

  for (const option of options) {
    const key = `${option.label}|${option.points}|${option.copyTag || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(option);
  }

  unique.sort((a, b) => {
    const aMin = a.minModels ?? 0;
    const bMin = b.minModels ?? 0;
    return aMin - bMin || a.points - b.points;
  });

  return unique;
}

function buildCopyPricing(override) {
  const rows = [
    ...(override?.changes || []),
    ...(override?.copyRules || [])
  ];

  return rows
    .map(row => {
      const parsed = parsePointsChangeText(row.text);
      if (!parsed.copyTag && !String(row.text || "").match(/2nd|3rd|copy/i)) return null;

      return {
        label: parsed.copyTag || row.text,
        points: parsed.newPoints,
        oldPoints: parsed.oldPoints,
        delta: row.delta,
        rawText: row.text
      };
    })
    .filter(Boolean);
}

function chooseDatasheet(unit, matches) {
  if (!matches?.length) return null;
  if (matches.length === 1) return matches[0];

  const wantedFaction = normalizeName(unit.sourceFaction || unit.selectableInFaction || "");
  const wantedFile = normalizeName(unit.sourceCatalogue?.definitionFile || unit.sourceFile || "");

  return (
    matches.find(m => normalizeName(m.datasheetSourceFile).includes(wantedFaction)) ||
    matches.find(m => wantedFile && normalizeName(m.datasheetSourceFile).includes(wantedFile.replace("cat", ""))) ||
    matches[0]
  );
}

function main() {
  const datasheetsByName = loadDatasheets();
  const overrides = loadOverrides();

  const factions = {};
  const files = fs.readdirSync(UNIT_DIR).filter(f => f.endsWith("-builder-units.json"));

  let enriched = 0;
  let notEnriched = 0;
  let overrideMatched = 0;

  for (const fileName of files) {
    const json = readJson(path.join(UNIT_DIR, fileName));

    if (!json || !json.faction || !Array.isArray(json.units) || json.units.length === 0) {
      console.log(`Skipping empty/invalid ${fileName}`);
      continue;
    }

    factions[json.faction] = json.units.map((unit, index) => {
      const sheet = chooseDatasheet(unit, datasheetsByName.get(normalizeName(unit.name)) || []);
      const override = findOverride(unit, json.faction, overrides);

      if (sheet) enriched++;
      else notEnriched++;

      if (override) overrideMatched++;

      const basePoints = typeof unit.points === "number" ? unit.points : 0;
      const pointsDelta = getPrimaryDelta(override);
      const displayPoints = basePoints + pointsDelta;
      const sizeOptions = buildSizeOptions(unit, override, displayPoints, basePoints);
      const copyPricing = buildCopyPricing(override);

      return {
        ...unit,
        id: unit.id || `${json.faction}-${index}`,
        name: unit.name,

        basePoints,
        points: displayPoints,
        pointsDelta,
        pointsOverride: override || null,
        sizeOptions,
        copyPricing,

        roles: unit.roles || {},
        categories: unit.categories || [],
        stats: sheet?.stats || unit.stats || null,
        keywords: sheet?.keywords || unit.keywords || unit.categories || [],
        displayRules: sheet?.rules || [],
        displayAbilities: sheet?.abilities || [],
        displayWeapons: sheet?.weapons || [],

        profiles: unit.profiles || [],
        rules: unit.rules || [],
        abilities: unit.abilities || [],
        weapons: unit.weapons || [],
        optionGroups: unit.optionGroups || [],
        composition: unit.composition || [],
        leaderTargets: unit.leaderTargets || [],
        isLeader: Array.isArray(unit.leaderTargets) && unit.leaderTargets.length > 0,
        sourceFile: unit.sourceFile || json.sourceFile || fileName,
        datasheetSourceFile: sheet?.datasheetSourceFile || null
      };
    });

    factions[json.faction].sort((a, b) => a.name.localeCompare(b.name));
  }

  fs.writeFileSync(
    OUT,
    "window.ARMY_BUILDER_DATA = " + JSON.stringify(factions, null, 2) + ";\n",
    "utf8"
  );

  console.log(`Wrote ${OUT}`);
  console.log(`Factions: ${Object.keys(factions).length}`);
  console.log(`Units: ${Object.values(factions).flat().length}`);
  console.log(`Datasheet enriched: ${enriched}`);
  console.log(`Datasheet missing: ${notEnriched}`);
  console.log(`Point overrides matched: ${overrideMatched}`);
}

main();