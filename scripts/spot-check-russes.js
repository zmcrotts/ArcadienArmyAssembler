const fs = require("fs");
const path = require("path");

const files = [
  "imperium-astra-militarum-roster-units.json",
  "genestealer-cults-roster-units.json",
];

const DATA_DIR = path.join(__dirname, "..", "data", "roster-rules");

for (const file of files) {
  const json = JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), "utf8"));

  console.log("");
  console.log("==================================================");
  console.log(file);
  console.log("==================================================");

  const russes = json.units.filter((u) => u.name.includes("Leman Russ"));

  for (const unit of russes) {
    console.log(`${unit.name}`);
    console.log(`  Points: ${unit.points}`);
    console.log(`  Entry Type: ${unit.entryType}`);
    console.log(`  Kind: ${unit.rosterUnitKind}`);
    console.log(`  Source: ${unit.source.definitionFile}`);
    console.log(`  Categories: ${unit.categories.map((c) => c.name).join(", ")}`);
    console.log(`  Profiles: ${unit.profiles.map((p) => `${p.name} [${p.typeName}]${p.linked ? " linked" : ""}`).join(", ")}`);
    console.log("");
  }
}