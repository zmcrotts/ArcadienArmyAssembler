"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const APP_EXE = path.join(ROOT, "release", "win-unpacked", "Arcadien Army Assembler.exe");
const BUILDER_CACHE = path.join(ROOT, "release", ".cache", "electron-builder");
const BUILDER_LOCAL_APPDATA = path.join(ROOT, "release", ".cache", "local-appdata");
const ELECTRON_CACHE = process.env.ELECTRON_CACHE
  || path.join(process.env.USERPROFILE || "", "AppData", "Local", "electron", "Cache");

function newestMtime(filePath) {
  if (!fs.existsSync(filePath)) return 0;
  const stat = fs.statSync(filePath);
  if (!stat.isDirectory()) return stat.mtimeMs;
  return Math.max(
    stat.mtimeMs,
    ...fs.readdirSync(filePath).map(item => newestMtime(path.join(filePath, item)))
  );
}

function runElectronBuilderDir() {
  const unpackedDir = path.join(ROOT, "release", "win-unpacked");
  fs.rmSync(unpackedDir, { recursive: true, force: true });
  const command = process.platform === "win32" ? "powershell.exe" : path.join(ROOT, "node_modules", ".bin", "electron-builder");
  const commandForSpawn = command;
  const argsForSpawn = process.platform === "win32"
    ? ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", "npm.cmd exec electron-builder -- --win dir"]
    : ["--win", "dir"];
  const result = spawnSync(commandForSpawn, argsForSpawn, {
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

  if (result.status === 0) return;
  const appAsar = path.join(unpackedDir, "resources", "app.asar");
  const distMtime = newestMtime(path.join(ROOT, "dist-user"));
  const asarMtime = newestMtime(appAsar);
  if (fs.existsSync(APP_EXE) && asarMtime >= distMtime) {
    console.warn("electron-builder returned a non-zero exit after creating release/win-unpacked. Continuing with the local installer build.");
    return;
  }

  process.exit(result.status || 1);
}

runElectronBuilderDir();
