const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const SEARCH_DIRS = [
  path.join(ROOT, "data", "roster-rules"),
  path.join(ROOT, "data", "builder-rules"),
  path.join(ROOT, "data", "builder-units")
];

const TARGET_ID = "b4dd-3e1f-41cb-218f";

function walk(obj, callback) {
  if (!obj) return;

  callback(obj);

  if (Array.isArray(obj)) {
    for (const item of obj) {
      walk(item, callback);
    }
    return;
  }

  if (typeof obj === "object") {
    for (const value of Object.values(obj)) {
      walk(value, callback);
    }
  }
}

for (const dir of SEARCH_DIRS) {
  if (!fs.existsSync(dir)) continue;

  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith(".json")) continue;

    const fullPath = path.join(dir, file);
    const data = JSON.parse(fs.readFileSync(fullPath, "utf8"));

    walk(data, node => {
      if (
        node &&
        typeof node === "object" &&
        (
          node.id === TARGET_ID ||
          node.targetId === TARGET_ID
        )
      ) {
        console.log("\n================================================");
        console.log(file);
        console.log("================================================");
        console.log(JSON.stringify(node, null, 2));
      }
    });
  }
}