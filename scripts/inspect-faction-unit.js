const fs = require("fs");
const { XMLParser } = require("fast-xml-parser");

const bsDataDir =
  "E:/my own rosterbuilder/data/wh40K/wh40k-10e-main/wh40k-10e-main";

const factionFile = process.argv[2];
const unitName = process.argv[3];

if (!factionFile || !unitName) {
  console.log(
    'Usage: node .\\scripts\\inspect-faction-unit.js "Imperium - Black Templars.cat" "Land Raider Crusader"'
  );
  process.exit(1);
}

const sourceFile = `${bsDataDir}/${factionFile}`;

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
const catalogue = data.catalogue;

const entries = asArray(
  catalogue.sharedSelectionEntries?.selectionEntry
);

const unit = entries.find(
  (entry) => entry["@_name"] === unitName
);

if (!unit) {
  console.error(`Could not find unit: ${unitName}`);
  process.exit(1);
}

const outputDir =
  "E:/my own rosterbuilder/data/json";

const outputFile =
  `${outputDir}/${unitName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")}-raw.json`;

fs.writeFileSync(
  outputFile,
  JSON.stringify(unit, null, 2)
);

console.log(`Found unit: ${unitName}`);
console.log(`Wrote: ${outputFile}`);