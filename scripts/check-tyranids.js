const fs = require("fs");

const data = JSON.parse(
  fs.readFileSync(
    "data/builder-units/tyranids-builder-units.json",
    "utf8"
  )
);

const units = Array.isArray(data) ? data : data.units;

if (!Array.isArray(units)) {
  console.log("Could not find units array.");
  console.log("Top-level keys:");
  console.log(Object.keys(data));
  process.exit(1);
}

const targets = [
  "Hive Tyrant",
  "Old One Eye",
  "Deathleaper",
  "Hormagaunts",
  "Biovores",
  "Carnifexes",
  "Spore Mines (Biovore)"
];

for (const unit of units) {
  if (targets.includes(unit.name)) {
    console.log("\n========================================");
    console.log(unit.name);
    console.log("========================================");
    console.log(JSON.stringify(unit, null, 2));
  }
}