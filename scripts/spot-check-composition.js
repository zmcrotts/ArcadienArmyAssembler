const fs = require("fs");

const data = JSON.parse(
  fs.readFileSync(
    "data/builder-units/tyranids-builder-units.json",
    "utf8"
  )
);

const targets = [
  "Termagants",
  "Hormagaunts",
  "Carnifexes",
  "Biovores",
  "Hive Tyrant"
];

for (const unit of data.units) {
  if (targets.includes(unit.name)) {
    console.log("\n========================================");
    console.log(unit.name);
    console.log("========================================");
    console.log(JSON.stringify(unit.composition, null, 2));
  }
}