"use strict";

const path = require("path");
const fs = require("fs");
const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const { syncRosterLibrary } = require("./manual-roster-sync");

const APP_NAME = "Arcadien Army Assembler";
let isQuitting = false;

app.setName(APP_NAME);

function userDataRoot() {
  if (app.isPackaged) return path.dirname(app.getPath("exe"));
  return path.join(app.getPath("documents"), APP_NAME);
}

function ensureLocalDataFolders() {
  const root = userDataRoot();
  const folders = [
    root,
    path.join(root, "user-data"),
    path.join(root, "rosters"),
    path.join(root, "exports")
  ];
  for (const folder of folders) fs.mkdirSync(folder, { recursive: true });
  app.setPath("userData", path.join(root, "user-data"));
}

function syncSettingsPath() {
  return path.join(app.getPath("userData"), "manual-roster-sync.json");
}

function readSyncSettings() {
  try {
    const settings = JSON.parse(fs.readFileSync(syncSettingsPath(), "utf8"));
    return typeof settings?.folder === "string" ? settings : null;
  } catch {
    return null;
  }
}

function writeSyncSettings(settings) {
  fs.writeFileSync(syncSettingsPath(), JSON.stringify(settings, null, 2), "utf8");
}

function syncStatus() {
  const settings = readSyncSettings();
  return {
    available: true,
    connected: Boolean(settings?.folder && fs.existsSync(settings.folder)),
    folderName: settings?.folder ? path.basename(settings.folder) : null
  };
}

async function chooseSyncFolder(window) {
  const chosen = await dialog.showOpenDialog(window, {
    title: "Choose a cloud-synced folder for roster sync",
    message: "Choose a folder already synced by OneDrive, Dropbox, iCloud Drive, or another service. Arcadien will create its own folder inside it.",
    properties: ["openDirectory", "createDirectory"]
  });
  if (chosen.canceled || !chosen.filePaths[0]) return null;
  const folder = path.join(chosen.filePaths[0], "Arcadien Army Assembler Sync");
  fs.mkdirSync(folder, { recursive: true });
  writeSyncSettings({ folder });
  return folder;
}

function registerRosterSyncHandlers() {
  ipcMain.handle("roster-sync:get-status", () => syncStatus());
  ipcMain.handle("roster-sync:change-folder", async event => {
    const folder = await chooseSyncFolder(BrowserWindow.fromWebContents(event.sender));
    return { canceled: !folder, ...syncStatus() };
  });
  ipcMain.handle("roster-sync:disconnect", () => {
    try { fs.rmSync(syncSettingsPath(), { force: true }); } catch {}
    return syncStatus();
  });
  ipcMain.handle("roster-sync:sync", async (event, saves) => {
    let settings = readSyncSettings();
    if (!settings?.folder || !fs.existsSync(settings.folder)) {
      const folder = await chooseSyncFolder(BrowserWindow.fromWebContents(event.sender));
      if (!folder) return { canceled: true, ...syncStatus() };
      settings = { folder };
    }
    const result = syncRosterLibrary(settings.folder, saves);
    return { canceled: false, ...syncStatus(), ...result };
  });
}

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1100,
    minHeight: 720,
    title: APP_NAME,
    backgroundColor: "#e9ecef",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, "preload.js")
    }
  });

  mainWindow.removeMenu();
  mainWindow.loadFile(path.join(__dirname, "..", "dist-user", "index.html"));

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("blob:") || url.startsWith("file:")) return { action: "allow" };
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.on("close", event => {
    if (process.platform === "darwin" || isQuitting) return;
    isQuitting = true;
    event.preventDefault();
    app.exit(0);
  });

  mainWindow.on("closed", () => {
    if (process.platform === "darwin" || isQuitting) return;
    isQuitting = true;
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.destroy();
    }
    app.quit();
  });
}

app.whenReady().then(() => {
  ensureLocalDataFolders();
  registerRosterSyncHandlers();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("before-quit", () => {
  isQuitting = true;
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
