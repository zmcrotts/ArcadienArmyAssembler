const fs = require("fs");
const path = require("path");

const filePath = path.join(
  process.cwd(),
  "data",
  "wh40K",
  "wh40k-10e-main",
  "wh40k-10e-main",
  "Tyranids.cat"
);

const text = fs.readFileSync(filePath, "utf8");

const targets = [
  "Biovores",
  "Biovore",
  "Carnifexes",
  "Carnifex"
];

for (const target of targets) {
  const index = text.indexOf(`name="${target}"`);

  if (index === -1) {
    console.log(`\n${target}: NOT FOUND`);
    continue;
  }

  console.log("\n==================================================");
  console.log(target);
  console.log("==================================================");

  const start = Math.max(0, index - 500);
  const end = Math.min(text.length, index + 3000);

  console.log(text.substring(start, end));
}