const fs = require("fs");

const data = JSON.parse(
  fs.readFileSync(
    "data/roster-rules/tyranids-roster-units.json",
    "utf8"
  )
);

console.log("Top-level keys:");
console.log(Object.keys(data));

const units = Array.isArray(data) ? data : data.units;

if (!Array.isArray(units)) {
  console.log("Could not find units array.");
  process.exit(1);
}

const targets = [
  "Biovores",
  "Carnifexes"
];

for (const unit of units) {
  if (targets.includes(unit.name)) {
    console.log("\n========================================");
    console.log(unit.name);
    console.log("========================================");
    console.log(JSON.stringify(unit, null, 2));
  }
}