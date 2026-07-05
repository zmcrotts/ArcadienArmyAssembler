const fs = require("fs");
const path = require("path");

const dir = path.join(process.cwd(), "data", "builder-units");

for (const file of fs.readdirSync(dir)) {
  if (!file.endsWith(".json")) continue;

  const data = JSON.parse(
    fs.readFileSync(path.join(dir, file), "utf8")
  );

  const units = data.units ?? [];

  for (const unit of units) {
    if (unit.points === 0) {
      console.log(
        `${file} | ${unit.name} | ${unit.entryType} | ${unit.rosterKind}`
      );
    }
  }
}