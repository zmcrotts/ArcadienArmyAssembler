const fs = require("fs");
const path = require("path");

const jsonDir = "E:/my own rosterbuilder/data/json";

const files = fs
  .readdirSync(jsonDir)
  .filter((file) => file.endsWith("-datasheets.json"))
  .sort();

let totalFiles = 0;
let totalDatasheets = 0;
let totalNoWeapons = 0;

for (const file of files) {
  const fullPath = path.join(jsonDir, file);
  const data = JSON.parse(fs.readFileSync(fullPath, "utf8"));

  const noWeapons = data.datasheets.filter(
    (ds) => !ds.weapons || ds.weapons.length === 0
  );

  totalFiles++;
  totalDatasheets += data.datasheets.length;
  totalNoWeapons += noWeapons.length;

  if (noWeapons.length > 0) {
    console.log("");
    console.log(`${data.faction} (${file})`);
    console.log("-".repeat(60));

    for (const ds of noWeapons) {
      console.log(`${ds.name}`);
    }
  }
}

console.log("");
console.log("DONE");
console.log(`Files checked: ${totalFiles}`);
console.log(`Datasheets checked: ${totalDatasheets}`);
console.log(`Datasheets with no weapons: ${totalNoWeapons}`);