"use strict";

const path = require("path");
const fs = require("fs");
const http = require("http");
const crypto = require("crypto");
const { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } = require("electron");
const { CLIENT_ID, SCOPE, createOneDriveRosterSync } = require("./onedrive-roster-sync");

const APP_NAME = "Arcadien Army Assembler";
let allowAppQuit = false;

app.setName(APP_NAME);

function userDataRoot() {
  if (app.isPackaged && process.platform === "win32") {
    const executableRoot = path.dirname(app.getPath("exe"));
    if (
      fs.existsSync(path.join(executableRoot, ".roster-builder-install"))
      || fs.existsSync(path.join(executableRoot, "user-data"))
    ) return executableRoot;
    return null;
  }
  return path.join(app.getPath("documents"), APP_NAME);
}

function ensureLocalDataFolders() {
  const root = userDataRoot();
  if (!root) {
    fs.mkdirSync(app.getPath("userData"), { recursive: true });
    return;
  }
  const folders = [
    root,
    path.join(root, "user-data"),
    path.join(root, "rosters"),
    path.join(root, "exports")
  ];
  for (const folder of folders) fs.mkdirSync(folder, { recursive: true });
  app.setPath("userData", path.join(root, "user-data"));
}

const EXTERNAL_HOSTS = new Set([
  "ko-fi.com",
  "www.ko-fi.com",
  "login.microsoftonline.com"
]);

function trustedExternalUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && EXTERNAL_HOSTS.has(url.hostname.toLowerCase()) ? url.href : null;
  } catch {
    return null;
  }
}

function openTrustedExternal(value) {
  const url = trustedExternalUrl(value);
  if (!url) return false;
  void shell.openExternal(url);
  return true;
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

let oneDriveClientInstance = null;

function oneDriveClient() {
  if (!oneDriveClientInstance) oneDriveClientInstance = createOneDriveRosterSync({
    crypto,
    fetch,
    readTokens: readOneDriveTokens,
    saveTokens: writeOneDriveTokens,
    clearTokens: clearOneDriveTokens
  });
  return oneDriveClientInstance;
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
    prompt: "select_account",
    state,
    code_challenge: sha256Base64Url(verifier),
    code_challenge_method: "S256"
  });
  if (!openTrustedExternal(`https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize?${query}`)) {
    throw new Error("The Microsoft sign-in URL could not be opened safely.");
  }
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
  // Merely opening Lists must never contact Microsoft. A stored connection is
  // enough to present Sync; validation/refresh happens only after its button
  // is explicitly pressed.
  return { available: true, connected: Boolean(readOneDriveTokens()) };
}

let oneDriveConnectionInFlight = null;

async function ensureOneDriveConnected() {
  if (oneDriveConnectionInFlight) return oneDriveConnectionInFlight;
  oneDriveConnectionInFlight = (async () => {
    try {
      if (await oneDriveClient().accessToken()) return;
    } catch (error) {
      // Microsoft can revoke/rotate a refresh grant when the same account is
      // re-authorized on another device. Recover within this manual Sync press
      // by discarding only the stale local token and opening the normal browser
      // sign-in; do not make a background retry.
      if (!/AADSTS70000|invalid_grant|grant is expired/i.test(error.message || "")) throw error;
      clearOneDriveTokens();
    }
    await connectOneDrive();
  })();
  try {
    await oneDriveConnectionInFlight;
  } finally {
    oneDriveConnectionInFlight = null;
  }
}

let rosterSyncQueue = Promise.resolve();

function runRosterSyncOperation(operation) {
  const result = rosterSyncQueue.then(operation, operation);
  rosterSyncQueue = result.catch(() => {});
  return result;
}

function registerRosterSyncHandlers() {
  ipcMain.handle("roster-sync:get-status", () => syncStatus());
  ipcMain.handle("roster-sync:disconnect", () => runRosterSyncOperation(async () => {
    clearOneDriveTokens();
    return syncStatus();
  }));
  ipcMain.handle("roster-sync:sync", (event, saves) => runRosterSyncOperation(async () => {
    await ensureOneDriveConnected();
    return { canceled: false, ...(await syncStatus()), ...(await oneDriveClient().sync(saves)) };
  }));
  ipcMain.handle("roster-sync:clean-duplicates", (event, saves) => runRosterSyncOperation(async () => {
    await ensureOneDriveConnected();
    return { ...(await syncStatus()), ...(await oneDriveClient().cleanDuplicates(saves)) };
  }));
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

  let closeRequestPending = false;
  let forceClose = false;
  let closeFallbackTimer = null;

  const clearCloseFallback = () => {
    if (closeFallbackTimer) clearTimeout(closeFallbackTimer);
    closeFallbackTimer = null;
  };

  const finishClose = () => {
    clearCloseFallback();
    forceClose = true;
    allowAppQuit = true;
    app.quit();
  };

  const requestRendererCloseDecision = () => {
    if (closeRequestPending || mainWindow.isDestroyed()) return;
    closeRequestPending = true;
    mainWindow.webContents.send("app:close-requested");
    closeFallbackTimer = setTimeout(async () => {
      if (!closeRequestPending || mainWindow.isDestroyed()) return;
      const result = await dialog.showMessageBox(mainWindow, {
        type: "warning",
        buttons: ["Keep app open", "Close anyway"],
        defaultId: 0,
        cancelId: 0,
        title: APP_NAME,
        message: "The roster editor did not answer the close request.",
        detail: "Keep the app open if you may have unsaved changes."
      });
      closeRequestPending = false;
      if (result.response === 1) finishClose();
    }, 5000);
  };

  const handleCloseResponse = (event, allow) => {
    if (event.sender !== mainWindow.webContents || !closeRequestPending) return;
    clearCloseFallback();
    closeRequestPending = false;
    if (allow === true) finishClose();
  };
  ipcMain.on("app:close-response", handleCloseResponse);

  mainWindow.removeMenu();

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("blob:")) return { action: "allow" };
    openTrustedExternal(url);
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    event.preventDefault();
    openTrustedExternal(url);
  });

  mainWindow.loadFile(path.join(__dirname, "..", "dist-user", "index.html"));

  mainWindow.on("close", event => {
    if (forceClose || allowAppQuit) return;
    event.preventDefault();
    requestRendererCloseDecision();
  });

  mainWindow.on("closed", () => {
    clearCloseFallback();
    ipcMain.removeListener("app:close-response", handleCloseResponse);
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

app.on("before-quit", event => {
  if (allowAppQuit) return;
  const window = BrowserWindow.getAllWindows().find(candidate => !candidate.isDestroyed());
  if (!window) {
    allowAppQuit = true;
    return;
  }
  event.preventDefault();
  window.close();
});

app.on("window-all-closed", () => {
  allowAppQuit = true;
  app.quit();
});
