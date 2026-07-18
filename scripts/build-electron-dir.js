"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const BUILDER_CACHE = path.join(ROOT, "release", ".cache", "electron-builder");
const BUILDER_LOCAL_APPDATA = path.join(ROOT, "release", ".cache", "local-appdata");
const ELECTRON_CACHE = process.env.ELECTRON_CACHE
  || path.join(process.env.USERPROFILE || "", "AppData", "Local", "electron", "Cache");

const REQUIRED_OUTPUTS = [
  "Arcadien Army Assembler.exe",
  "chrome_100_percent.pak",
  "chrome_200_percent.pak",
  "icudtl.dat",
  "resources.pak",
  "snapshot_blob.bin",
  "v8_context_snapshot.bin",
  "resources/app.asar"
];

function verifyUnpackedApp(unpackedDir) {
  const missing = REQUIRED_OUTPUTS.filter(relative => {
    const target = path.join(unpackedDir, relative);
    return !fs.existsSync(target) || !fs.statSync(target).isFile() || fs.statSync(target).size === 0;
  });
  if (missing.length) throw new Error(`electron-builder output is incomplete: ${missing.join(", ")}`);
}

function runElectronBuilderDir() {
  if (process.platform !== "win32") {
    throw new Error("Windows desktop packaging is supported only on Windows.");
  }
  const unpackedDir = path.join(ROOT, "release", "win-unpacked");
  fs.rmSync(unpackedDir, { recursive: true, force: true });
  const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", "npm.cmd exec electron-builder -- --win dir"], {
    cwd: ROOT,
    env: {
      ...process.env,
      CSC_IDENTITY_AUTO_DISCOVERY: "false",
      ELECTRON_BUILDER_CACHE: BUILDER_CACHE,
      ELECTRON_CACHE,
      LOCALAPPDATA: BUILDER_LOCAL_APPDATA
    },
    stdio: "inherit"
  });

  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`electron-builder failed with status ${result.status ?? "unknown"}.`);
  verifyUnpackedApp(unpackedDir);
}

if (require.main === module) runElectronBuilderDir();

module.exports = { REQUIRED_OUTPUTS, verifyUnpackedApp };
