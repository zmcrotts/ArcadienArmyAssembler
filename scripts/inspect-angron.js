const fs = require("fs");
const { XMLParser } = require("fast-xml-parser");

const sourceFile =
  "E:/my own rosterbuilder/data/wh40K/wh40k-10e-main/wh40k-10e-main/Chaos - World Eaters.cat";

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

const angron = entries.find((entry) => entry["@_name"] === "Angron");

if (!angron) {
  console.error("Could not find Angron");
  process.exit(1);
}

fs.writeFileSync(
  "E:/my own rosterbuilder/data/json/angron-raw.json",
  JSON.stringify(angron, null, 2)
);

console.log("Dumped Angron raw entry to:");
console.log("E:/my own rosterbuilder/data/json/angron-raw.json");

console.log("");
console.log("Top-level Angron keys:");
console.log(Object.keys(angron));