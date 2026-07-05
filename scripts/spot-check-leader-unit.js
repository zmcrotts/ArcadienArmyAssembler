const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const FILES = [
  "data\\builder-units\\imperium-space-marines-builder-units.json",
  "data\\builder-units\\imperium-dark-angels-builder-units.json",
  "data\\builder-units\\xenos-tyranids-builder-units.json",
  "data\\builder-units\\aeldari-drukhari-builder-units.json",
  "data\\builder-units\\aeldari-aeldari-builder-units.json"
];

const TARGETS = [
  "Captain",
  "Azrael",
  "Broodlord",
  "Archon",
  "Hive Tyrant"
];

function getUnits(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.units)) return data.units;
  if (Array.isArray(data.builderUnits)) return data.builderUnits;
  return [];
}

for (const relFile of FILES) {
  const fullPath = path.join(ROOT, relFile);

  if (!fs.existsSync(fullPath)) {
    console.log(`Missing: ${relFile}`);
    continue;
  }

  const data = JSON.parse(fs.readFileSync(fullPath, "utf8"));
  const units = getUnits(data);

  console.log("\n##################################################");
  console.log(relFile);
  console.log(`Units found: ${units.length}`);
  console.log("##################################################");

  for (const unit of units) {
    if (!TARGETS.includes(unit.name)) continue;

    console.log("\n==================================================");
    console.log(unit.name);
    console.log("==================================================");
    console.log(JSON.stringify(unit, null, 2));
  }
}