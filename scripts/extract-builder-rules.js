
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const INPUT_DIR = path.join(ROOT, "data", "builder-units");
const OUTPUT_DIR = path.join(ROOT, "data", "builder-rules");

fs.mkdirSync(OUTPUT_DIR, { recursive: true });

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function findRosterMax(unit) {
  const constraints = asArray(unit.composition)
    .flatMap(c => asArray(c.constraints));

  const rosterMax = constraints.find(c =>
    c.type === "max" &&
    c.field === "selections" &&
    c.scope === "roster" &&
    Number(c.value) > 0
  );

  if (rosterMax) return Number(rosterMax.value);

  if (unit.roles?.epicHero) return 1;
  if (unit.roles?.battleline) return 6;

  return 3;
}

function hasEntryLinkNamed(unit, name) {
  const needle = name.toLowerCase();

  const fromComposition = asArray(unit.composition)
    .flatMap(c => asArray(c.entryLinks));

  const fromOptions = asArray(unit.optionGroups)
    .flatMap(g => asArray(g.entryLinks));

  return [...fromComposition, ...fromOptions].some(link =>
    String(link.name || "").toLowerCase() === needle
  );
}

function normalizeChoices(group) {
  const directEntries = asArray(group.entries).map(e => ({
    id: e.id || null,
    name: e.name || "Unnamed Choice",
    type: e.type || null,
    targetId: null,
    source: "entry"
  }));

  const linkedEntries = asArray(group.entryLinks).map(e => ({
    id: e.id || null,
    name: e.name || "Unnamed Choice",
    type: e.type || null,
    targetId: e.targetId || null,
    source: "entryLink"
  }));

  return [...directEntries, ...linkedEntries];
}

function normalizeOptions(unit) {
  return asArray(unit.optionGroups)
    .map(group => ({
      id: group.id || null,
      name: group.name || "Unnamed Option Group",
      min: group.min ?? null,
      max: group.max ?? null,
      required: Number(group.min || 0) > 0,
      constraints: asArray(group.constraints),
      choices: normalizeChoices(group)
    }))
    .filter(group => group.choices.length > 0);
}

function normalizeUnit(unit) {
  return {
    id: unit.id,
    name: unit.name,
    points: unit.points,

    sourceFaction: unit.sourceFaction,
    selectableInFaction: unit.selectableInFaction,
    sourceFile: unit.sourceFile,

    roles: unit.roles,
    categories: unit.categories,

    rosterLimits: {
      maxPerRoster: findRosterMax(unit),
      source: "bsdata-or-default"
    },

    builderFlags: {
      canBeWarlord: hasEntryLinkNamed(unit, "Warlord"),
      canTakeEnhancements: hasEntryLinkNamed(unit, "Enhancements")
    },

    options: normalizeOptions(unit),

    profileRefs: asArray(unit.profiles).map(p => ({
      id: p.id || null,
      name: p.name || null,
      typeName: p.typeName || null,
      linked: Boolean(p.linked)
    })),

    rawRef: unit.rawRef
  };
}

function main() {
  const files = fs.readdirSync(INPUT_DIR)
    .filter(f => f.endsWith("-builder-units.json"))
    .sort();

  let totalUnits = 0;

  for (const file of files) {
    const inputPath = path.join(INPUT_DIR, file);
    const data = JSON.parse(fs.readFileSync(inputPath, "utf8"));

    const units = asArray(data.units).map(normalizeUnit);

    const outputFile = file.replace("-builder-units.json", "-builder-rules.json");
    const outputPath = path.join(OUTPUT_DIR, outputFile);

    fs.writeFileSync(outputPath, JSON.stringify({
      faction: data.faction,
      sourceFile: file,
      unitCount: units.length,
      units
    }, null, 2), "utf8");

    totalUnits += units.length;
    console.log(`${file} -> ${outputFile}: ${units.length} units`);
  }

  console.log("");
  console.log(`Done. ${files.length} files processed, ${totalUnits} builder-rule units written.`);
}

main();
'@ | Set-Content scripts\extract-builder-rules.js