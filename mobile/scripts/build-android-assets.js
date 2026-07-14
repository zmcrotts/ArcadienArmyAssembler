"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SOURCE = path.join(ROOT, "dist-user");
const TARGET = path.join(ROOT, "android", "app", "src", "main", "assets", "www");

if (!fs.existsSync(path.join(SOURCE, "index.html"))) {
  throw new Error("Missing mobile runtime. Run npm.cmd run build first.");
}

fs.rmSync(TARGET, { recursive: true, force: true });
fs.mkdirSync(path.dirname(TARGET), { recursive: true });
fs.cpSync(SOURCE, TARGET, { recursive: true });

console.log(`Bundled Android web assets in ${TARGET}`);
