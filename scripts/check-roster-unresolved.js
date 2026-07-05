const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(
  __dirname,
  "..",
  "data",
  "roster-rules"
);

const files = fs
  .readdirSync(DATA_DIR)
  .filter((file) => file.endsWith("-roster-units.json"))
  .sort();

let totalProblems = 0;

for (const file of files) {
  const fullPath = path.join(DATA_DIR, file);
  const json = JSON.parse(fs.readFileSync(fullPath, "utf8"));

  const unresolved = json.unresolved || [];

  if (unresolved.length === 0) {
    continue;
  }

  totalProblems += unresolved.length;

  console.log("");
  console.log("==================================================");
  console.log(file);
  console.log(`Unresolved Count: ${unresolved.length}`);
  console.log("==================================================");

  for (const item of unresolved) {
    console.log(`- ${item.name}`);
    console.log(`  Target ID: ${item.id}`);

    if (item.sourceLink?.targetId) {
      console.log(`  Link Target: ${item.sourceLink.targetId}`);
    }

    console.log("");
  }
}

console.log("");
console.log("==================================================");
console.log(`Total Unresolved: ${totalProblems}`);
console.log("==================================================");