const fs = require("fs");

const text = fs.readFileSync(
  "scripts/export-faction-roster-units.js",
  "utf8"
);

const start = text.indexOf("function getPoints");
const end = text.indexOf("function", start + 1);

console.log(text.slice(start, end));