const fs = require("fs");

const file = process.argv[2];
const targetName = process.argv.slice(3).join(" ");

if (!file || !targetName) {
  console.log("Usage:");
  console.log('node scripts/inspect-roster-unit.js data/roster-rules/FILE.json "Unit Name"');
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(file, "utf8"));
const units = Array.isArray(data) ? data : data.units;

if (!Array.isArray(units)) {
  console.log("No units array found.");
  process.exit(1);
}

const unit = units.find((u) => u.name === targetName);

if (!unit) {
  console.log(`Unit not found: ${targetName}`);
  process.exit(1);
}

console.log(JSON.stringify(unit, null, 2));