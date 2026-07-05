const fs = require("fs");

const data = JSON.parse(
  fs.readFileSync(
    "data/builder-units/tyranids-builder-units.json",
    "utf8"
  )
);

const units = data.units;

const targets = [
  "Hive Tyrant",
  "Hormagaunts",
  "Carnifexes",
  "Termagants"
];

for (const unit of units) {
  if (targets.includes(unit.name)) {
    console.log("\n=================================");
    console.log(unit.name);
    console.log("=================================");

    for (const category of unit.categories ?? []) {
      console.log(category.name ?? category);
    }
  }
}