const fs = require("fs");
const path = require("path");

const root = path.join(
  process.cwd(),
  "data",
  "wh40K",
  "wh40k-10e-main",
  "wh40k-10e-main"
);

for (const file of fs.readdirSync(root)) {
  if (
    file.toLowerCase().includes("tyranid") ||
    file.toLowerCase().includes("tyranids")
  ) {
    console.log(file);
  }
}