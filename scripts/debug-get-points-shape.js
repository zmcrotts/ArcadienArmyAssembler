const fs = require("fs");
const path = require("path");
const { XMLParser } = require("fast-xml-parser");

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  allowBooleanAttributes: true
});

const filePath = path.join(
  process.cwd(),
  "data",
  "wh40K",
  "wh40k-10e-main",
  "wh40k-10e-main",
  "Imperium - Adeptus Mechanicus.cat"
);

const data = parser.parse(fs.readFileSync(filePath, "utf8"));

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
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

const unit = findById(data, "7efb-de37-79c4-cccb");

console.log("Unit name:", unit.name);
console.log("Unit keys:", Object.keys(unit));

console.log("\nselectionEntryGroups:");
console.log(JSON.stringify(unit.selectionEntryGroups, null, 2).slice(0, 3000));