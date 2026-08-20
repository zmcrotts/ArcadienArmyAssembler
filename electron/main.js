"use strict";

const path = require("path");
const fs = require("fs");
const http = require("http");
const crypto = require("crypto");
const { app, BrowserWindow, ipcMain, safeStorage, shell } = require("electron");
const { CLIENT_ID, SCOPE, createOneDriveRosterSync } = require("./onedrive-roster-sync");

const BASE_APP_NAME = "Arcadien Army Assembler";
const testProfileArgument = process.argv.find(argument => argument.startsWith("--aaa-test-profile="));
const TEST_PROFILE = String(testProfileArgument?.split("=").slice(1).join("=") || "")
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9-]+/g, "-")
  .replace(/^-+|-+$/g, "")
  .slice(0, 32);
const testSuffixArgument = process.argv.find(argument => argument.startsWith("--aaa-test-name-suffix="));
const TEST_NAME_SUFFIX = String(testSuffixArgument?.split("=").slice(1).join("=") || "").slice(0, 40);
const TEST_PROFILE_LABEL = TEST_PROFILE
  ? TEST_PROFILE.split("-").filter(Boolean).map(part => part[0].toUpperCase() + part.slice(1)).join(" ")
  : "";
const APP_NAME = TEST_PROFILE ? `${BASE_APP_NAME} TEST — ${TEST_PROFILE_LABEL}` : BASE_APP_NAME;
let mainWindow = null;
let pendingRosterImportUrl = null;

app.setName(APP_NAME);

function rosterImportUrlFrom(value) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "arcadien:" || url.hostname.toLowerCase() !== "import" || (url.pathname && url.pathname !== "/")) return null;
    const code = String(url.searchParams.get("code") || "");
    return code && code.length <= 2800 ? url.href : null;
  } catch {
    return null;
  }
}

function rosterImportUrlFromArguments(argumentsList) {
  for (const argument of argumentsList || []) {
    const url = rosterImportUrlFrom(argument);
    if (url) return url;
  }
  return null;
}

function deliverRosterImportUrl(value) {
  const url = rosterImportUrlFrom(value);
  if (!url) return false;
  pendingRosterImportUrl = url;
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isLoading()) {
    mainWindow.webContents.send("roster-import-url", pendingRosterImportUrl);
    pendingRosterImportUrl = null;
  }
  return true;
}

pendingRosterImportUrl = rosterImportUrlFromArguments(process.argv);

function userDataRoot() {
  if (TEST_PROFILE) {
    return app.isPackaged
      ? path.resolve(path.dirname(app.getPath("exe")), "..", "..", ".test-env", TEST_PROFILE)
      : path.join(__dirname, "..", ".test-env", TEST_PROFILE);
  }
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

// Chromium opens the profile database while Electron is starting. Select the
// portable install profile before `ready`, then use that same profile as the
// scope for Electron's single-instance lock. A second process must never open
// the same Local Storage database: Chromium will otherwise expose an empty
// store in that process even though the saved rosters are still on disk.
ensureLocalDataFolders();
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
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
  if (TEST_PROFILE) return { available: false, connected: false, testProfile: TEST_PROFILE };
  return { available: true, connected: Boolean(readOneDriveTokens()) };
}

let oneDriveConnectionInFlight = null;

async function ensureOneDriveConnected() {
  if (TEST_PROFILE) throw new Error("OneDrive sync is disabled in AAA test profiles.");
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
  ipcMain.handle("roster-sync:sync", (event, saves, syncState) => runRosterSyncOperation(async () => {
    await ensureOneDriveConnected();
    return { canceled: false, ...(await syncStatus()), ...(await oneDriveClient().sync(saves, syncState)) };
  }));
  ipcMain.handle("roster-sync:clean-duplicates", (event, saves, syncState) => runRosterSyncOperation(async () => {
    await ensureOneDriveConnected();
    return { ...(await syncStatus()), ...(await oneDriveClient().cleanDuplicates(saves, syncState)) };
  }));
}

async function prepareTestRosterCopies(window) {
  if (!TEST_PROFILE || !TEST_NAME_SUFFIX) return;
  const markerKey = `aaaTestRosterCopy:${TEST_PROFILE}:${TEST_NAME_SUFFIX}`;
  const script = `(() => {
    const markerKey = ${JSON.stringify(markerKey)};
    const suffix = ${JSON.stringify(TEST_NAME_SUFFIX)};
    const raw = localStorage.getItem("engineRosterSaves");
    if (!raw) return { changed: false, records: [] };
    const source = JSON.parse(raw);
    if (!Array.isArray(source)) throw new Error("The copied roster library is invalid.");
    if (localStorage.getItem(markerKey) === "done") return { changed: false, records: source };
    const records = source.map(record => {
      const copy = structuredClone(record);
      copy.id = typeof crypto.randomUUID === "function"
        ? \`roster-\${crypto.randomUUID()}\`
        : \`roster-test-\${Date.now()}-\${Math.random().toString(16).slice(2)}\`;
      const currentName = String(copy.document?.name || "Unnamed roster");
      if (copy.document) copy.document.name = currentName.endsWith(suffix) ? currentName : currentName + suffix;
      return copy;
    });
    localStorage.setItem("engineRosterSaves", JSON.stringify(records));
    localStorage.setItem(markerKey, "done");
    return { changed: true, records };
  })()`;
  const result = await window.webContents.executeJavaScript(script, true);
  const exportPath = path.join(userDataRoot(), "test-roster-library.json");
  fs.writeFileSync(exportPath, JSON.stringify({
    kind: "roster-engine.savedRosterLibrary",
    exportedAt: new Date().toISOString(),
    testProfile: TEST_PROFILE,
    engineRosterSaves: result.records || []
  }, null, 2));
  if (result.changed) window.webContents.reload();
}

function createWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    return mainWindow;
  }

  mainWindow = new BrowserWindow({
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

  mainWindow.webContents.on("did-finish-load", () => {
    if (!pendingRosterImportUrl) return;
    mainWindow.webContents.send("roster-import-url", pendingRosterImportUrl);
    pendingRosterImportUrl = null;
  });

  if (TEST_PROFILE) {
    mainWindow.on("page-title-updated", event => {
      event.preventDefault();
      mainWindow.setTitle(APP_NAME);
    });
    mainWindow.webContents.on("did-finish-load", () => {
      prepareTestRosterCopies(mainWindow).catch(error => {
        console.error(`Could not prepare the AAA test roster library: ${error.message}`);
      });
    });
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("blob:")) return { action: "allow" };
    openTrustedExternal(url);
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    event.preventDefault();
    openTrustedExternal(url);
  });

  mainWindow.loadFile(path.join(__dirname, "..", "dist-user", "index.html"), {
    query: TEST_PROFILE ? { aaaTestProfile: TEST_PROFILE } : {}
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  return mainWindow;
}

if (hasSingleInstanceLock) {
  app.on("second-instance", (_event, argv) => {
    deliverRosterImportUrl(rosterImportUrlFromArguments(argv));
    if (!mainWindow || mainWindow.isDestroyed()) {
      if (app.isReady()) createWindow();
      return;
    }
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    if (app.isPackaged) app.setAsDefaultProtocolClient("arcadien");
    registerRosterSyncHandlers();
    createWindow();

    app.on("activate", () => {
      if (!mainWindow || mainWindow.isDestroyed()) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    app.quit();
  });

  app.on("open-url", (event, url) => {
    event.preventDefault();
    deliverRosterImportUrl(url);
  });
}
