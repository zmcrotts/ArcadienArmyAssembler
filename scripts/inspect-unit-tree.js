const fs = require("fs");
const path = require("path");
const { XMLParser } = require("fast-xml-parser");

const DATA_DIR = path.join(__dirname, "..", "data", "wh40K", "wh40k-10e-main", "wh40k-10e-main");

const unitName = process.argv.slice(2).join(" ");

if (!unitName) {
  console.error('Usage: node scripts/inspect-unit-tree.js "Khorne Berzerkers"');
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

function readXml(filePath) {
  return parser.parse(fs.readFileSync(filePath, "utf8"));
}

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function findAllCatalogues() {
  return fs
    .readdirSync(DATA_DIR)
    .filter((file) => file.endsWith(".cat"))
    .map((file) => path.join(DATA_DIR, file));
}

function findUnitByName(name) {
  for (const file of findAllCatalogues()) {
    const xml = readXml(file);
    const catalogue = xml.catalogue;
    const entries = asArray(catalogue?.sharedSelectionEntries?.selectionEntry);

    const found = entries.find(
      (entry) => entry.name?.toLowerCase() === name.toLowerCase()
    );

    if (found) {
      return {
        file,
        catalogueName: catalogue.name,
        unit: found,
      };
    }
  }

  return null;
}

function simplify(node) {
  if (!node || typeof node !== "object") return node;

  const keepKeys = [
    "id",
    "name",
    "type",
    "collective",
    "import",
    "hidden",
    "targetId",
    "selectionEntryId",
    "profileTypeId",
    "field",
    "scope",
    "value",
    "percentValue",
    "shared",
    "includeChildSelections",
    "includeChildForces",
    "childId",
    "typeId",
  ];

  const result = {};

  for (const key of keepKeys) {
    if (node[key] !== undefined) result[key] = node[key];
  }

  for (const key of [
    "categoryLinks",
    "constraints",
    "costs",
    "modifiers",
    "selectionEntries",
    "selectionEntryGroups",
    "entryLinks",
    "profiles",
    "infoLinks",
  ]) {
    if (node[key] !== undefined) result[key] = simplify(node[key]);
  }

  if (Array.isArray(node)) return node.map(simplify);

  for (const [key, value] of Object.entries(node)) {
    if (result[key] !== undefined) continue;
    if (typeof value === "object") result[key] = simplify(value);
  }

  return result;
}

const result = findUnitByName(unitName);

if (!result) {
  console.error(`Could not find unit: ${unitName}`);
  process.exit(1);
}

console.log(`Found: ${result.unit.name}`);
console.log(`Catalogue: ${result.catalogueName}`);
console.log(`File: ${path.basename(result.file)}`);
console.log("");
console.log(JSON.stringify(simplify(result.unit), null, 2));