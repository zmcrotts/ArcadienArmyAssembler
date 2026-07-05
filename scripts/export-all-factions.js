const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const bsDataDir =
  "E:/my own rosterbuilder/data/wh40K/wh40k-10e-main/wh40k-10e-main";

const exporterScript =
  "E:/my own rosterbuilder/scripts/export-faction-datasheets.js";

const files = fs
  .readdirSync(bsDataDir)
  .filter((file) => file.toLowerCase().endsWith(".cat"))
  .sort();

console.log(`Found ${files.length} catalogue files`);
console.log("");

let success = 0;
let failed = 0;

for (const file of files) {
  try {
    console.log(`Exporting ${file}...`);

    execFileSync("node", [exporterScript, file], {
      stdio: "inherit",
    });

    success++;
    console.log("");
  } catch (err) {
    failed++;
    console.error(`FAILED: ${file}`);
    console.error(err.message);
    console.log("");
  }
}

console.log("Done.");
console.log(`Successful: ${success}`);
console.log(`Failed: ${failed}`);