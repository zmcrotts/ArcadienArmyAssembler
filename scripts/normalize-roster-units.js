const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const INPUT_DIR = path.join(ROOT, "data", "roster-rules");
const OUTPUT_DIR = path.join(ROOT, "data", "builder-units");

fs.mkdirSync(OUTPUT_DIR, { recursive: true });

function slugify(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function getFactionFromFilename(file) {
  return file
    .replace(/-roster-units\.json$/i, "")
    .replace(/-/g, " ")
    .replace(/\b\w/g, c => c.toUpperCase());
}

function getCategoryNames(unit) {
  const cats = unit.categories || [];
  return cats.map(c => {
    if (typeof c === "string") return c;
    return c.name || c.text || c.value || "";
  }).filter(Boolean);
}

function hasCategory(categoryNames, target) {
  const t = target.toLowerCase();
  return categoryNames.some(c => c.toLowerCase() === t);
}

function hasCategoryIncludes(categoryNames, target) {
  const t = target.toLowerCase();
  return categoryNames.some(c => c.toLowerCase().includes(t));
}

function getPoints(unit) {
  if (typeof unit.points === "number") return unit.points;

  if (Array.isArray(unit.costs)) {
    const pts = unit.costs.find(c =>
      String(c.name || c.type || "").toLowerCase().includes("pts")
    );
    if (pts && !Number.isNaN(Number(pts.value))) return Number(pts.value);
  }

  if (unit.cost && !Number.isNaN(Number(unit.cost))) return Number(unit.cost);

  return null;
}

function normalizeUnit(unit, selectableInFaction, sourceFile) {
  const categories = getCategoryNames(unit);
  const name = unit.name || unit.entryName || unit.selectionEntryName || "Unnamed Unit";

  const sourceFactionCategory = categories.find(c =>
    c.toLowerCase().startsWith("faction:")
  );

  const sourceFaction =
    unit.sourceFaction ||
    unit.faction ||
    (sourceFactionCategory ? sourceFactionCategory.replace(/^faction:\s*/i, "") : selectableInFaction);

  return {
    id: unit.id || unit.entryId || slugify(`${selectableInFaction}-${name}`),
    name,

    sourceFaction,
    selectableInFaction,

    sourceCatalogue: unit.source || unit.sourceCatalogue || unit.catalogue || null,
    sourceFile,

    entryType: unit.entryType || unit.type || null,
    rosterKind: unit.kind || unit.rosterKind || null,

    points: getPoints(unit),

    roles: {
      battleline: hasCategory(categories, "Battleline"),
      character: hasCategory(categories, "Character"),
      vehicle: hasCategory(categories, "Vehicle"),
      monster: hasCategory(categories, "Monster"),
      infantry: hasCategory(categories, "Infantry"),
      mounted: hasCategory(categories, "Mounted"),
      swarm: hasCategory(categories, "Swarm"),
      fortification: hasCategory(categories, "Fortification"),
      dedicatedTransport: hasCategoryIncludes(categories, "Dedicated Transport"),
      epicHero: hasCategory(categories, "Epic Hero")
    },

    categories,

    profiles: unit.profiles || [],
    optionGroups: unit.optionGroups || unit.selectionGroups || [],
    composition: unit.composition || unit.selections || [],

    rawRef: {
      id: unit.id || null,
      name,
      sourceFile
    }
  };
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

function main() {
  const files = fs.readdirSync(INPUT_DIR)
    .filter(f => f.endsWith("-roster-units.json"))
    .sort();

  let totalUnits = 0;
  const warnings = [];

  for (const file of files) {
    const inputPath = path.join(INPUT_DIR, file);
    const source = readJson(inputPath);

    const selectableInFaction =
      source.faction ||
      source.catalogueName ||
      source.name ||
      getFactionFromFilename(file);

    const rawUnits =
      source.units ||
      source.rosterUnits ||
      source.entries ||
      (Array.isArray(source) ? source : []);

    if (!Array.isArray(rawUnits)) {
      warnings.push(`${file}: could not find unit array`);
      continue;
    }

    const normalized = rawUnits.map(unit =>
      normalizeUnit(unit, selectableInFaction, file)
    );

    normalized.sort((a, b) => a.name.localeCompare(b.name));

    const outputFile = file.replace("-roster-units.json", "-builder-units.json");
    const outputPath = path.join(OUTPUT_DIR, outputFile);

    writeJson(outputPath, {
      faction: selectableInFaction,
      sourceFile: file,
      unitCount: normalized.length,
      units: normalized
    });

    totalUnits += normalized.length;

    console.log(`${file} -> ${outputFile}: ${normalized.length} units`);
  }

  console.log("");
  console.log(`Done. ${files.length} files processed, ${totalUnits} builder units written.`);

  if (warnings.length) {
    console.log("");
    console.log("Warnings:");
    for (const warning of warnings) {
      console.log(`- ${warning}`);
    }
  }
}

main();