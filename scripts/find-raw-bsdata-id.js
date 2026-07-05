const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const TARGET_ID = "b4dd-3e1f-41cb-218f";

const SEARCH_ROOTS = [
  path.join(ROOT, "bsdata"),
  path.join(ROOT, "data"),
  ROOT
];

const EXTENSIONS = new Set([
  ".cat",
  ".gst",
  ".xml",
  ".json"
]);

function walkDir(dir, files = []) {
  if (!fs.existsSync(dir)) return files;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (
        entry.name === "node_modules" ||
        entry.name === ".git"
      ) {
        continue;
      }

      walkDir(fullPath, files);
      continue;
    }

    if (EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      files.push(fullPath);
    }
  }

  return files;
}

const seen = new Set();
const files = [];

for (const root of SEARCH_ROOTS) {
  for (const file of walkDir(root)) {
    if (!seen.has(file)) {
      seen.add(file);
      files.push(file);
    }
  }
}

let found = 0;

for (const file of files) {
  const text = fs.readFileSync(file, "utf8");

  if (!text.includes(TARGET_ID)) continue;

  found++;

  console.log("\n================================================");
  console.log(path.relative(ROOT, file));
  console.log("================================================");

  const index = text.indexOf(TARGET_ID);
  const start = Math.max(0, index - 3000);
  const end = Math.min(text.length, index + 3000);

  console.log(text.slice(start, end));
}

console.log("\n================================================");
console.log(`Files containing ${TARGET_ID}: ${found}`);
console.log("================================================");