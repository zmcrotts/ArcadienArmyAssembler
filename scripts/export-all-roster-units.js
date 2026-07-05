const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const DATA_DIR = path.join(
  __dirname,
  "..",
  "data",
  "wh40K",
  "wh40k-10e-main",
  "wh40k-10e-main"
);

const EXPORTER = path.join(__dirname, "export-faction-roster-units.js");

function getFactionNames() {
  return fs
    .readdirSync(DATA_DIR)
    .filter((file) => file.endsWith(".cat"))
    .map((file) => path.basename(file, ".cat"))
    .sort((a, b) => a.localeCompare(b));
}

const factions = getFactionNames();

console.log(`Found ${factions.length} faction catalogues`);
console.log("");

let successCount = 0;
let failCount = 0;

for (const faction of factions) {
  console.log(`Exporting: ${faction}`);

  const result = spawnSync(
    process.execPath,
    [EXPORTER, faction],
    {
      encoding: "utf8",
      stdio: "pipe",
    }
  );

  if (result.status === 0) {
    successCount++;
    process.stdout.write(result.stdout);
  } else {
    failCount++;
    console.log(`FAILED: ${faction}`);
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
  }

  console.log("");
}

console.log("DONE");
console.log(`Successful: ${successCount}`);
console.log(`Failed: ${failCount}`);

if (failCount > 0) {
  process.exit(1);
}