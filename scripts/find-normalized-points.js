const fs = require("fs");

const text = fs.readFileSync(
  "scripts/normalize-roster-units.js",
  "utf8"
);

const lines = text.split("\n");

for (let i = 0; i < lines.length; i++) {
  if (
    lines[i].includes("points") ||
    lines[i].includes("Points")
  ) {
    console.log(`${i + 1}: ${lines[i]}`);
  }
}