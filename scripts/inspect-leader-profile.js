const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "data", "roster-rules");

const TARGETS = [
  "Broodlord",
  "Hive Tyrant",
  "Captain",
  "Archon"
];

function walk(obj, callback) {
  if (!obj) return;

  callback(obj);

  if (Array.isArray(obj)) {
    obj.forEach(x => walk(x, callback));
    return;
  }

  if (typeof obj === "object") {
    Object.values(obj).forEach(x => walk(x, callback));
  }
}

for (const file of fs.readdirSync(DATA_DIR)) {
  if (!file.endsWith(".json")) continue;

  const data = JSON.parse(
    fs.readFileSync(path.join(DATA_DIR, file), "utf8")
  );

  walk(data, node => {
    if (
      node &&
      typeof node === "object" &&
      TARGETS.includes(node.name)
    ) {
      console.log("\n====================================================");
      console.log(`${node.name} (${file})`);
      console.log("====================================================");

      const text = JSON.stringify(node, null, 2);

      if (
        text.includes("Leader") ||
        text.includes("leader")
      ) {
        console.log(text.slice(0, 15000));
      }
    }
  });
}