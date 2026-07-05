const fs = require("fs");
const { XMLParser } = require("fast-xml-parser");

const sourceFile =
  "E:/my own rosterbuilder/data/wh40K/wh40k-10e-main/wh40k-10e-main/Chaos - World Eaters.cat";

const outputFile =
  "E:/my own rosterbuilder/data/json/world-eaters.json";

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function getPoints(entry) {
  const costs = asArray(entry.costs?.cost);

  const pts = costs.find(
    (cost) =>
      cost["@_name"] &&
      cost["@_name"].toLowerCase().includes("pts")
  );

  return pts ? Number(pts["@_value"]) : null;
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

const units = entries
  .filter((entry) => {
    const type = entry["@_type"];
    return type === "unit" || type === "model";
  })
  .map((entry) => ({
    id: entry["@_id"],
    name: entry["@_name"],
    type: entry["@_type"],
    points: getPoints(entry),
  }));

const exportData = {
  faction: "World Eaters",
  sourceRevision: data.catalogue["@_revision"],
  generatedAt: new Date().toISOString(),
  units,
};

fs.writeFileSync(
  outputFile,
  JSON.stringify(exportData, null, 2)
);

console.log(`Exported ${units.length} units`);
console.log(outputFile);