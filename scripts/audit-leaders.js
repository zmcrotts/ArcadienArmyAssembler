const fs = require("fs");
const path = require("path");

const rulesDir = path.join(
  process.cwd(),
  "data",
  "builder-rules"
);

for (const file of fs.readdirSync(rulesDir)) {
  if (!file.endsWith(".json")) continue;

  const data = JSON.parse(
    fs.readFileSync(path.join(rulesDir, file), "utf8")
  );

  for (const unit of data.units ?? []) {
    if (unit.leader) {
      console.log(
        `${file} | ${unit.name}`
      );
    }
  }
}