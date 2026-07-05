const fs = require("fs");
const path = require("path");

const fileName = process.argv[2];
const target = process.argv.slice(3).join(" ");

if (!fileName || !target) {
  console.log("Usage:");
  console.log('node scripts/inspect-raw-entry.js "Catalogue File.cat" "Entry Name"');
  process.exit(1);
}

const root = path.join(
  process.cwd(),
  "data",
  "wh40K",
  "wh40k-10e-main",
  "wh40k-10e-main"
);

const filePath = path.join(root, fileName);
const text = fs.readFileSync(filePath, "utf8");

const needle = `name="${target}"`;
const index = text.indexOf(needle);

if (index === -1) {
  console.log(`Not found: ${target}`);
  process.exit(1);
}

const start = Math.max(0, index - 1000);
const end = Math.min(text.length, index + 5000);

console.log(text.substring(start, end));