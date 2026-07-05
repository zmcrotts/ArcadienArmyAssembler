const fs = require("fs");
const { XMLParser } = require("fast-xml-parser");

const sourceFile =
  "E:/my own rosterbuilder/data/wh40K/wh40k-10e-main/wh40k-10e-main/Chaos - World Eaters.cat";

const unitName = process.argv[2] || "Khorne Berzerkers";

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

const xml = fs.readFileSync(sourceFile, "utf8");

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
});

const data = parser.parse(xml);

const entries = asArray(
  data.catalogue.sharedSelectionEntries?.selectionEntry
);

const unit = entries.find((entry) => entry["@_name"] === unitName);

if (!unit) {
  console.error(`Could not find unit: ${unitName}`);
  process.exit(1);
}

const safeName = unitName
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-|-$/g, "");

const outputFile = `E:/my own rosterbuilder/data/json/${safeName}-raw.json`;

fs.writeFileSync(outputFile, JSON.stringify(unit, null, 2));

console.log(`Dumped ${unitName} to:`);
console.log(outputFile);
console.log("");
console.log("Top-level keys:");
console.log(Object.keys(unit));