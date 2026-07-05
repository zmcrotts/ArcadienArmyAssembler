const fs = require("fs");

const file =
  process.argv[2];

if (!file) {
  console.log("Usage:");
  console.log('node .\\scripts\\check-empty-weapons.js ".\\data\\json\\t-au-empire-datasheets.json"');
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(file, "utf8"));

console.log(`Checking ${data.faction}`);
console.log("");

for (const ds of data.datasheets) {
  if (!ds.weapons || ds.weapons.length === 0) {
    console.log(`${ds.name}: NO WEAPONS`);
  }
}