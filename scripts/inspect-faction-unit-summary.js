const fs = require("fs");
const path = require("path");
const { XMLParser } = require("fast-xml-parser");

const DATA_DIR = path.join(
  __dirname,
  "..",
  "data",
  "wh40K",
  "wh40k-10e-main",
  "wh40k-10e-main"
);

const factionName = process.argv[2];
const unitName = process.argv.slice(3).join(" ");

if (!factionName || !unitName) {
  console.error(
    'Usage: node scripts/inspect-faction-unit-summary.js "Chaos - World Eaters" "Khorne Berzerkers"'
  );
  process.exit(1);
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  isArray: (name) =>
    [
      "selectionEntry",
      "selectionEntryGroup",
      "entryLink",
      "profile",
      "categoryLink",
      "constraint",
      "modifier",
      "condition",
      "cost",
      "infoLink",
    ].includes(name),
});

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function readXml(filePath) {
  return parser.parse(fs.readFileSync(filePath, "utf8"));
}

function findAllCatalogues() {
  return fs
    .readdirSync(DATA_DIR)
    .filter((file) => file.endsWith(".cat"))
    .map((file) => path.join(DATA_DIR, file));
}

function getConstraints(node) {
  return asArray(node?.constraints?.constraint);
}

function getMinMax(node) {
  const constraints = getConstraints(node);

  const min = constraints.find(
    (c) => c.type === "min" && c.field === "selections"
  );

  const max = constraints.find(
    (c) => c.type === "max" && c.field === "selections"
  );

  return {
    min: min ? Number(min.value) : null,
    max: max ? Number(max.value) : null,
  };
}

function formatRange(min, max) {
  if (min !== null && max !== null && min === max) return `${min}x`;
  if (min !== null && max !== null) return `${min}-${max}x`;
  if (min !== null) return `${min}+x`;
  if (max !== null) return `0-${max}x`;
  return "?x";
}

function walkGroups(groups, callback) {
  for (const group of asArray(groups?.selectionEntryGroup)) {
    callback(group);
    walkGroups(group.selectionEntryGroups, callback);
  }
}

function printEntries(entries, indent = "  ") {
  for (const entry of asArray(entries?.selectionEntry)) {
    const { min, max } = getMinMax(entry);

    if (entry.type === "model") {
      console.log(`${indent}${formatRange(min, max)} ${entry.name}`);
    } else {
      console.log(`${indent}- ${entry.name}`);
    }
  }
}

function printEntryLinks(entryLinks, indent = "  ") {
  for (const link of asArray(entryLinks?.entryLink)) {
    console.log(`${indent}- ${link.name}`);
  }
}

function findUnitInCatalogue(catalogueFile, unitName) {
  const xml = readXml(catalogueFile);
  const catalogue = xml.catalogue;

  const entries = asArray(
    catalogue?.sharedSelectionEntries?.selectionEntry
  );

  return entries.find(
    (entry) => entry.name?.toLowerCase() === unitName.toLowerCase()
  );
}

function findUnitByFaction(factionName, unitName) {
  const catalogues = findAllCatalogues();

  const factionFile = catalogues.find((file) => {
    const name = path.basename(file, ".cat");
    return name.toLowerCase() === factionName.toLowerCase();
  });

  if (!factionFile) {
    throw new Error(`Faction catalogue not found: ${factionName}`);
  }

  const directHit = findUnitInCatalogue(factionFile, unitName);

  if (directHit) {
    return {
      file: factionFile,
      catalogueName: path.basename(factionFile, ".cat"),
      unit: directHit,
      source: "Faction Catalogue"
    };
  }

  for (const file of catalogues) {
    const unit = findUnitInCatalogue(file, unitName);

    if (unit) {
      return {
        file,
        catalogueName: path.basename(file, ".cat"),
        unit,
        source: "Shared Catalogue"
      };
    }
  }

  return null;
}

const result = findUnitByFaction(factionName, unitName);

if (!result) {
  console.error(`Could not find ${unitName}`);
  process.exit(1);
}

const unit = result.unit;

console.log(`UNIT: ${unit.name}`);
console.log(`REQUESTED FACTION: ${factionName}`);
console.log(`FOUND IN: ${result.catalogueName}`);
console.log(`SOURCE TYPE: ${result.source}`);
console.log("");

console.log("CATEGORIES");
console.log("----------");

for (const cat of asArray(unit.categoryLinks?.categoryLink)) {
  console.log(`- ${cat.name}`);
}

console.log("");

console.log("POINTS");
console.log("------");

for (const cost of asArray(unit.costs?.cost)) {
  if (cost.name?.toLowerCase() === "pts") {
    console.log(`${cost.value} pts`);
  }
}

console.log("");

console.log("COMPOSITION");
console.log("-----------");

for (const entry of asArray(unit.selectionEntries?.selectionEntry)) {
  if (entry.type === "model") {
    const { min, max } = getMinMax(entry);
    console.log(`${formatRange(min, max)} ${entry.name}`);
  }
}

walkGroups(unit.selectionEntryGroups, (group) => {
  const entries = asArray(group.selectionEntries?.selectionEntry);
  const models = entries.filter((e) => e.type === "model");

  if (!models.length) return;

  const { min, max } = getMinMax(group);

  console.log(`${formatRange(min, max)} ${group.name}`);

  for (const model of models) {
    const mm = getMinMax(model);
    console.log(
      `  ${formatRange(mm.min, mm.max)} ${model.name}`
    );
  }
});

console.log("");

console.log("UNIT ENTRY LINKS");
console.log("----------------");

printEntryLinks(unit.entryLinks);
