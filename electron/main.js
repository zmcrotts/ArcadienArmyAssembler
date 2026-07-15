"use strict";

const path = require("path");
const fs = require("fs");
const http = require("http");
const crypto = require("crypto");
const { app, BrowserWindow, ipcMain, safeStorage, shell } = require("electron");
const { CLIENT_ID, SCOPE, createOneDriveRosterSync } = require("./onedrive-roster-sync");

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

function oneDriveTokenPath() {
  return path.join(app.getPath("userData"), "onedrive-sync-token.bin");
}

function readOneDriveTokens() {
  try {
    if (!safeStorage.isEncryptionAvailable()) return null;
    return JSON.parse(safeStorage.decryptString(fs.readFileSync(oneDriveTokenPath())));
  } catch {
    return null;
  }
}

function writeOneDriveTokens(tokens) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error("Windows secure storage is unavailable, so OneDrive cannot be connected safely.");
  fs.writeFileSync(oneDriveTokenPath(), safeStorage.encryptString(JSON.stringify(tokens)));
}

function clearOneDriveTokens() {
  try { fs.rmSync(oneDriveTokenPath(), { force: true }); } catch {}
}

function oneDriveClient() {
  return createOneDriveRosterSync({
    crypto,
    fetch,
    readTokens: readOneDriveTokens,
    saveTokens: writeOneDriveTokens,
    clearTokens: clearOneDriveTokens
  });
}

function base64Url(bytes) {
  return Buffer.from(bytes).toString("base64url");
}

function sha256Base64Url(value) {
  return crypto.createHash("sha256").update(value).digest("base64url");
}

function waitForOneDriveCallback(state) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((request, response) => {
      const url = new URL(request.url || "/", "http://localhost:4173");
      const code = url.searchParams.get("code");
      const returnedState = url.searchParams.get("state");
      const error = url.searchParams.get("error");
      const finish = (result, failure) => {
        response.writeHead(failure ? 400 : 200, { "Content-Type": "text/html; charset=utf-8" });
        response.end(failure
          ? "<h2>OneDrive connection did not finish.</h2><p>You can close this tab and return to Arcadien.</p>"
          : "<h2>OneDrive connected.</h2><p>You can close this tab and return to Arcadien.</p>");
        clearTimeout(timeout);
        server.close();
        failure ? reject(failure) : resolve(result);
      };
      if (request.method !== "GET" || url.pathname !== "/") {
        response.writeHead(404).end();
        return;
      }
      if (error) return finish(null, new Error(url.searchParams.get("error_description") || "OneDrive connection was cancelled."));
      if (!code || returnedState !== state) return finish(null, new Error("OneDrive sign-in could not be verified. Please try Sync again."));
      finish(code);
    });
    const timeout = setTimeout(() => {
      server.close();
      reject(new Error("OneDrive sign-in timed out. Press Sync to try again."));
    }, 5 * 60 * 1000);
    server.once("error", error => {
      clearTimeout(timeout);
      reject(error.code === "EADDRINUSE"
        ? new Error("OneDrive sign-in needs localhost:4173, but another app is using it. Close that app and press Sync again.")
        : error);
    });
    server.listen(4173, "localhost");
  });
}

async function connectOneDrive() {
  const state = base64Url(crypto.randomBytes(24));
  const verifier = base64Url(crypto.randomBytes(32));
  const callback = waitForOneDriveCallback(state);
  const query = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: "code",
    redirect_uri: "http://localhost:4173/",
    response_mode: "query",
    scope: SCOPE,
    state,
    code_challenge: sha256Base64Url(verifier),
    code_challenge_method: "S256"
  });
  await shell.openExternal(`https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize?${query}`);
  const code = await callback;
  const tokens = await oneDriveClient().tokenRequest({
    client_id: CLIENT_ID,
    grant_type: "authorization_code",
    code,
    redirect_uri: "http://localhost:4173/",
    code_verifier: verifier,
    scope: SCOPE
  });
  writeOneDriveTokens({
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: Date.now() + Number(tokens.expires_in || 3600) * 1000 - 60000
  });
}

async function syncStatus() {
  try {
    return { available: true, connected: Boolean(await oneDriveClient().accessToken()) };
  } catch {
    return { available: true, connected: false };
  }
}

async function ensureOneDriveConnected() {
  if (await oneDriveClient().accessToken()) return;
  await connectOneDrive();
}

function registerRosterSyncHandlers() {
  ipcMain.handle("roster-sync:get-status", () => syncStatus());
  ipcMain.handle("roster-sync:disconnect", async () => {
    clearOneDriveTokens();
    return syncStatus();
  });
  ipcMain.handle("roster-sync:sync", async (event, saves) => {
    await ensureOneDriveConnected();
    return { canceled: false, ...(await syncStatus()), ...(await oneDriveClient().sync(saves)) };
  });
  ipcMain.handle("roster-sync:clean-duplicates", async (event, saves) => {
    await ensureOneDriveConnected();
    return { ...(await syncStatus()), ...(await oneDriveClient().cleanDuplicates(saves)) };
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
