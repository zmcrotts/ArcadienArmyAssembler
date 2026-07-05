const fs = require("fs");
const { XMLParser } = require("fast-xml-parser");

const file =
  "E:/my own rosterbuilder/data/wh40K/wh40k-10e-main/wh40k-10e-main/Chaos - World Eaters.cat";

const xml = fs.readFileSync(file, "utf8");

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
});

const data = parser.parse(xml);
const catalogue = data.catalogue;

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function getCosts(entry) {
  const costs = asArray(entry.costs?.cost);

  return costs.map((cost) => ({
    name: cost["@_name"],
    value: cost["@_value"],
    typeId: cost["@_typeId"],
  }));
}

const entries = asArray(catalogue.sharedSelectionEntries?.selectionEntry);

const unitsAndModels = entries.filter((entry) => {
  const type = entry["@_type"];
  return type === "unit" || type === "model";
});

for (const entry of unitsAndModels) {
  const name = entry["@_name"];
  const type = entry["@_type"];
  const costs = getCosts(entry);

  const pointsCost = costs.find((cost) =>
    String(cost.name).toLowerCase().includes("pts")
  );

  console.log(
    `${name} | ${type} | ${pointsCost ? pointsCost.value + " pts" : "no direct points"}`
  );
}