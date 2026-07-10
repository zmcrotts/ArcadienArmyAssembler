"use strict";

const path = require("path");
const fs = require("fs");
const { app, BrowserWindow, shell } = require("electron");

const APP_NAME = "Arcadien Army Assembler";
let isQuitting = false;

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
      sandbox: true
    }
  });

  mainWindow.removeMenu();
  mainWindow.loadFile(path.join(__dirname, "..", "dist-user", "index.html"));

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("blob:") || url.startsWith("file:")) return { action: "allow" };
    shell.openExternal(url);
    return { action: "deny" };
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
