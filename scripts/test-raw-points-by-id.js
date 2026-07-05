const fs = require("fs");
const path = require("path");
const { XMLParser } = require("fast-xml-parser");

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  allowBooleanAttributes: true
});

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function getPoints(entry) {
  const directCosts = asArray(entry?.costs?.cost);
  const directPts = directCosts.find((c) => c.name?.toLowerCase() === "pts");

  if (directPts) {
    return Number(directPts.value);
  }

  const childPointValues = [];

  const directChildEntries = asArray(entry?.selectionEntries?.selectionEntry);

  for (const child of directChildEntries) {
    const childPoints = getPoints(child);

    if (Number.isFinite(childPoints) && childPoints > 0) {
      childPointValues.push(childPoints);
    }
  }

  const childGroups = asArray(entry?.selectionEntryGroups?.selectionEntryGroup);

  for (const group of childGroups) {
    const groupPoints = getPoints(group);

    if (Number.isFinite(groupPoints) && groupPoints > 0) {
      childPointValues.push(groupPoints);
    }
  }

  if (childPointValues.length > 0) {
    return Math.min(...childPointValues);
  }

  return 0;
}

function findById(node, id) {
  if (!node || typeof node !== "object") return null;

  if (node.id === id) return node;

  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const child of value) {
        const found = findById(child, id);
        if (found) return found;
      }
    } else if (value && typeof value === "object") {
      const found = findById(value, id);
      if (found) return found;
    }
  }

  return null;
}

const filePath = path.join(
  process.cwd(),
  "data",
  "wh40K",
  "wh40k-10e-main",
  "wh40k-10e-main",
  "Imperium - Adeptus Mechanicus.cat"
);

const data = parser.parse(fs.readFileSync(filePath, "utf8"));

const targetId = "7efb-de37-79c4-cccb";
const entry = findById(data, targetId);

if (!entry) {
  console.log("Entry not found");
  process.exit(1);
}

console.log("id:", entry.id);
console.log("name:", entry.name);
console.log("type:", entry.type);
console.log("points:", getPoints(entry));