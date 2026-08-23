"use strict";

// This is a public OAuth client ID, not a secret. The app never requests profile or email data.
const ONEDRIVE_CLIENT_ID = "30500f7e-c454-428c-8f16-c0318ae6174b";
const ONEDRIVE_SCOPE = "offline_access https://graph.microsoft.com/Files.ReadWrite.AppFolder";
const ONEDRIVE_TOKEN_KEY = "arcadienOneDriveTokens";
const ONEDRIVE_PKCE_KEY = "arcadienOneDrivePkce";
const GRAPH_ROOT = "https://graph.microsoft.com/v1.0";
const RECORD_KIND = "arcadien-roster-sync-record";
const ROSTER_TOMBSTONE_KIND = "arcadien-roster-sync-tombstone";
const GAME_RECORD_KIND = "arcadien-game-sync-record";
const ANDROID_NATIVE = Boolean(window.AndroidOneDrive);
let pendingAndroidToken = null;
let nativeGraphRequestCounter = 0;
const pendingNativeGraphRequests = new Map();

function usableHere() {
  return /^https?:$/.test(window.location.protocol) || ANDROID_NATIVE;
}

function redirectUri() {
  // Keep a project-hosted PWA on its own path after Microsoft returns it.
  // This is still simply http://localhost:4173/ for the local desktop test site.
  return new URL(".", window.location.href).href;
}

function readTokens() {
  try {
    const tokens = JSON.parse(localStorage.getItem(ONEDRIVE_TOKEN_KEY) || "null");
    return tokens?.refresh_token || tokens?.access_token ? tokens : null;
  } catch {
    return null;
  }
}

function hasStoredConnection() {
  // Opening the Lists screen must never start an OAuth flow or make a network
  // request. A saved (even expired) browser token is enough to show Sync; the
  // token is refreshed only inside the user's explicit Sync request.
  if (ANDROID_NATIVE) {
    try {
      return Boolean(window.AndroidOneDrive.hasCachedConnection());
    } catch {
      return false;
    }
  }
  return Boolean(readTokens());
}

function clearStoredConnection() {
  if (ANDROID_NATIVE) {
    try {
      window.AndroidOneDrive.disconnect();
    } catch {
      // The native token cache may already be unavailable during teardown.
    }
  } else {
    localStorage.removeItem(ONEDRIVE_TOKEN_KEY);
  }
}

function saveTokens(tokens) {
  localStorage.setItem(ONEDRIVE_TOKEN_KEY, JSON.stringify({
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: Date.now() + (Number(tokens.expires_in || 3600) * 1000) - 60000
  }));
}

function base64Url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function sha256(value) {
  return base64Url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

async function tokenRequest(body) {
  const response = await fetch("https://login.microsoftonline.com/consumers/oauth2/v2.0/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body)
  });
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error_description || "Microsoft sign-in could not finish.");
    if (["invalid_grant", "interaction_required"].includes(data.error)) error.code = "ONEDRIVE_REAUTH_REQUIRED";
    throw error;
  }
  return data;
}

async function accessToken() {
  if (ANDROID_NATIVE) {
    if (hasStoredConnection()) return "native";
    if (pendingAndroidToken) return pendingAndroidToken.promise;
    let resolveConnection;
    let rejectConnection;
    const promise = new Promise((resolve, reject) => {
      resolveConnection = resolve;
      rejectConnection = reject;
    });
    pendingAndroidToken = { promise, resolve: resolveConnection, reject: rejectConnection };
    try {
      window.AndroidOneDrive.beginSignIn();
    } catch (error) {
      pendingAndroidToken = null;
      rejectConnection(error);
    }
    return promise;
  }
  const tokens = readTokens();
  if (!tokens) return null;
  if (tokens.access_token && Number(tokens.expires_at || 0) > Date.now()) return tokens.access_token;
  if (!tokens.refresh_token) return null;
  let refreshed;
  try {
    refreshed = await tokenRequest({
      client_id: ONEDRIVE_CLIENT_ID,
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
      scope: ONEDRIVE_SCOPE
    });
  } catch (error) {
    if (error?.code === "ONEDRIVE_REAUTH_REQUIRED") clearStoredConnection();
    throw error;
  }
  saveTokens({ ...refreshed, refresh_token: refreshed.refresh_token || tokens.refresh_token });
  return refreshed.access_token;
}

async function nativeGraph(path, options = {}) {
  await accessToken();
  const relativePath = String(path || "");
  if (!relativePath.startsWith("/me/drive/")) throw new Error("OneDrive requested an unsupported resource.");
  const requestId = `graph-${Date.now()}-${++nativeGraphRequestCounter}`;
  const method = String(options.method || "GET").toUpperCase();
  const body = options.body == null ? null : String(options.body);
  const ifMatch = options.headers?.["If-Match"] || options.headers?.["if-match"] || null;
  return new Promise((resolve, reject) => {
    pendingNativeGraphRequests.set(requestId, { resolve, reject });
    try {
      window.AndroidOneDrive.graphRequest(requestId, method, relativePath, body, ifMatch);
    } catch (error) {
      pendingNativeGraphRequests.delete(requestId);
      reject(error);
    }
  });
}

async function graph(path, options = {}) {
  const { allowStatuses = [], ...requestOptions } = options;
  let response;
  if (ANDROID_NATIVE) {
    response = await nativeGraph(path, requestOptions);
  } else {
    const token = await accessToken();
    if (!token) throw new Error("Connect OneDrive first.");
    response = await fetch(`${GRAPH_ROOT}${path}`, {
      ...requestOptions,
      headers: { Authorization: `Bearer ${token}`, ...(requestOptions.headers || {}) }
    });
  }
  if (response.status === 401) {
    clearStoredConnection();
    const error = new Error("Your OneDrive connection expired. Sign in again to sync.");
    error.code = "ONEDRIVE_REAUTH_REQUIRED";
    throw error;
  }
  if (!response.ok && !allowStatuses.includes(response.status)) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data?.error?.message || "OneDrive could not complete that sync.");
  }
  return response;
}

function validRecord(record) {
  return record && typeof record === "object" && typeof record.id === "string" && record.document && typeof record.document === "object";
}

function documentHash(record) {
  return JSON.stringify(record.document);
}

function recordTime(record) {
  const lastEditedAt = Date.parse(record.lastEditedAt || "");
  if (Number.isFinite(lastEditedAt)) return lastEditedAt;
  const savedAt = Date.parse(record.savedAt || "");
  return Number.isFinite(savedAt) ? savedAt : 0;
}

function syncKey(record) {
  const name = String(record?.document?.name || "").trim().replace(/\s+/g, " ").toLocaleLowerCase();
  return name ? `name:${name}` : `id:${record.id}`;
}

async function fileName(id) {
  return `${(await sha256(id)).slice(0, 43)}.json`;
}

async function rosterFolder() {
  const root = await (await graph("/me/drive/special/approot")).json();
  const existing = await graph(`/me/drive/items/${root.id}:/rosters`, { allowStatuses: [404] });
  if (existing.status !== 404) return existing.json();
  const created = await graph(`/me/drive/items/${root.id}/children`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "rosters", folder: {}, "@microsoft.graph.conflictBehavior": "fail" })
  });
  return created.json();
}

async function gameFolder() {
  const root = await (await graph("/me/drive/special/approot")).json();
  const existing = await graph(`/me/drive/items/${root.id}:/games`, { allowStatuses: [404] });
  if (existing.status !== 404) return existing.json();
  const created = await graph(`/me/drive/items/${root.id}/children`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "games", folder: {}, "@microsoft.graph.conflictBehavior": "fail" })
  });
  return created.json();
}

function cloudDownloadError(message) {
  const error = new Error(message);
  error.code = "ONEDRIVE_DOWNLOAD_FAILED";
  return error;
}

function downloadWithBrowserRequest(downloadUrl) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("GET", downloadUrl.href, true);
    request.responseType = "text";
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        resolve({
          ok: true,
          status: request.status,
          text: async () => request.responseText
        });
        return;
      }
      reject(cloudDownloadError(`OneDrive could not download a synced roster (HTTP ${request.status}).`));
    };
    request.onerror = () => reject(cloudDownloadError(`Safari blocked the OneDrive file download from ${downloadUrl.hostname}.`));
    request.onabort = () => reject(cloudDownloadError("The OneDrive file download was cancelled."));
    request.send();
  });
}

async function downloadCloudItem(item) {
  if (ANDROID_NATIVE) return graph(`/me/drive/items/${item.id}/content`);

  // Graph's /content endpoint redirects to another Microsoft origin. Microsoft
  // documents that browser JavaScript must instead request this temporary,
  // preauthenticated URL and download it without an Authorization header.
  const metadata = await (await graph(
    `/me/drive/items/${encodeURIComponent(item.id)}?select=id,@microsoft.graph.downloadUrl`
  )).json();
  const rawDownloadUrl = metadata?.["@microsoft.graph.downloadUrl"];
  if (!rawDownloadUrl) throw cloudDownloadError("OneDrive did not provide a browser download address for a synced roster.");

  let downloadUrl;
  try {
    downloadUrl = new URL(rawDownloadUrl);
  } catch {
    throw cloudDownloadError("OneDrive provided an invalid browser download address.");
  }
  if (downloadUrl.protocol !== "https:") throw cloudDownloadError("OneDrive provided an unsafe browser download address.");

  // Intentionally no OAuth or other custom headers. Microsoft specifically
  // documents XMLHttpRequest for this preauthenticated browser download.
  return downloadWithBrowserRequest(downloadUrl);
}

async function remoteEntries(folder) {
  const listing = await (await graph(`/me/drive/items/${folder.id}/children?$select=id,name,file`)).json();
  const records = [];
  for (const item of listing.value || []) {
    if (!item.file || !item.name.endsWith(".json")) continue;
    try {
      const response = await downloadCloudItem(item);
      const parsed = JSON.parse(await response.text());
      if (parsed?.kind === RECORD_KIND && validRecord(parsed.record)) records.push({ record: parsed.record, itemId: item.id });
    } catch (error) {
      if (error.code === "ONEDRIVE_DOWNLOAD_FAILED") throw error;
      // Ignore an unrelated or partially synced file; it must not block a library sync.
    }
  }
  return records;
}

async function uploadRecord(folder, record) {
  await graph(`/me/drive/items/${folder.id}:/${await fileName(record.id)}:/content`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: RECORD_KIND, version: 1, record }, null, 2)
  });
}

function validRosterTombstone(value) {
  return value && typeof value.id === "string" && value.id.length > 0 && Number.isFinite(Date.parse(value.deletedAt || ""));
}

async function remoteRosterTombstones(folder) {
  const listing = await (await graph(`/me/drive/items/${folder.id}/children?$select=id,name,file`)).json();
  const tombstones = [];
  for (const item of listing.value || []) {
    if (!item.file || !item.name.endsWith(".json")) continue;
    try {
      const response = await downloadCloudItem(item);
      const parsed = JSON.parse(await response.text());
      if (parsed?.kind === ROSTER_TOMBSTONE_KIND && validRosterTombstone(parsed.tombstone)) tombstones.push(parsed.tombstone);
    } catch (error) {
      if (error.code === "ONEDRIVE_DOWNLOAD_FAILED") throw error;
    }
  }
  return tombstones;
}

async function uploadRosterTombstone(folder, tombstone) {
  await graph(`/me/drive/items/${folder.id}:/${await fileName(tombstone.id)}:/content`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: ROSTER_TOMBSTONE_KIND, version: 1, tombstone }, null, 2)
  });
}

function validGameSyncEntry(entry) {
  if (!entry || typeof entry.resultId !== "string" || !entry.resultId.startsWith("game-")) return false;
  if (entry.type === "tombstone") return Number.isFinite(Date.parse(entry.deletedAt || ""));
  return entry.type === "game" && entry.game?.status === "final" && entry.game.resultId === entry.resultId && entry.game.gameHash && `game-${entry.game.gameHash}` === entry.resultId;
}

function localGameEntries(state = {}) {
  const entries = [];
  for (const game of Array.isArray(state.games) ? state.games : []) {
    const entry = { type: "game", resultId: game?.resultId, game };
    if (validGameSyncEntry(entry)) entries.push(structuredClone(entry));
  }
  for (const tombstone of Array.isArray(state.tombstones) ? state.tombstones : []) {
    const entry = { type: "tombstone", ...tombstone };
    if (validGameSyncEntry(entry)) entries.push(structuredClone(entry));
  }
  return entries;
}

async function remoteGameEntries(folder) {
  const listing = await (await graph(`/me/drive/items/${folder.id}/children?$select=id,name,file`)).json();
  const entries = [];
  for (const item of listing.value || []) {
    if (!item.file || !item.name.endsWith(".json")) continue;
    try {
      const response = await downloadCloudItem(item);
      const parsed = JSON.parse(await response.text());
      if (parsed?.kind === GAME_RECORD_KIND && validGameSyncEntry(parsed.entry)) entries.push(parsed.entry);
    } catch (error) {
      if (error.code === "ONEDRIVE_DOWNLOAD_FAILED") throw error;
    }
  }
  return entries;
}

async function uploadGameEntry(folder, entry) {
  await graph(`/me/drive/items/${folder.id}:/${await fileName(entry.resultId)}:/content`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: GAME_RECORD_KIND, version: 1, entry }, null, 2)
  });
}

async function reconcileGames(state = {}) {
  const folder = await gameFolder();
  const local = new Map(localGameEntries(state).map(entry => [entry.resultId, entry]));
  const remote = new Map((await remoteGameEntries(folder)).map(entry => [entry.resultId, entry]));
  const games = [], tombstones = [];
  const summary = { uploaded: 0, downloaded: 0, conflicts: 0 };
  for (const id of new Set([...local.keys(), ...remote.keys()])) {
    const localEntry = local.get(id) || null;
    const remoteEntry = remote.get(id) || null;
    let winner = localEntry || remoteEntry;
    if (localEntry?.type === "tombstone" || remoteEntry?.type === "tombstone") {
      winner = localEntry?.type === "tombstone" ? localEntry : remoteEntry;
    } else if (localEntry && remoteEntry && JSON.stringify(localEntry) !== JSON.stringify(remoteEntry)) {
      winner = localEntry;
      summary.conflicts += 1;
    }
    if (!remoteEntry || JSON.stringify(remoteEntry) !== JSON.stringify(winner)) {
      await uploadGameEntry(folder, winner);
      summary.uploaded += 1;
    }
    if (!localEntry && remoteEntry) summary.downloaded += 1;
    if (winner.type === "tombstone") tombstones.push({ resultId: winner.resultId, gameHash: winner.gameHash, deletedAt: winner.deletedAt });
    else games.push(structuredClone(winner.game));
  }
  return { games, tombstones, summary };
}

async function reconcileByName(saves, rosterTombstones = []) {
  const folder = await rosterFolder();
  const localTombstones = (Array.isArray(rosterTombstones) ? rosterTombstones : []).filter(validRosterTombstone);
  const remoteTombstones = await remoteRosterTombstones(folder);
  const tombstonesById = new Map([...remoteTombstones, ...localTombstones].map(item => [item.id, item]));
  const deletedIds = new Set(tombstonesById.keys());
  const local = Array.isArray(saves) ? saves.filter(validRecord).filter(record => !deletedIds.has(record.id)).map(record => structuredClone(record)) : [];
  const remote = (await remoteEntries(folder)).filter(entry => !deletedIds.has(entry.record.id));
  const remoteTombstoneIds = new Set(remoteTombstones.map(item => item.id));
  const summary = { uploaded: 0, downloaded: 0, conflicts: 0, deletionsUploaded: 0 };
  for (const tombstone of localTombstones) {
    if (!remoteTombstoneIds.has(tombstone.id)) {
      await uploadRosterTombstone(folder, tombstone);
      summary.deletionsUploaded += 1;
    }
  }
  const localByKey = new Map();
  for (const record of local) {
    const key = syncKey(record);
    const previous = localByKey.get(key);
    if (!previous || recordTime(record) >= recordTime(previous)) localByKey.set(key, record);
  }
  const remoteByKey = new Map();
  for (const entry of remote) {
    const key = syncKey(entry.record);
    if (!remoteByKey.has(key)) remoteByKey.set(key, []);
    remoteByKey.get(key).push(entry);
  }
  const cleanup = { localRemoved: local.length - localByKey.size, remoteRemoved: 0 };
  const result = [];
  const keys = new Set([...localByKey.keys(), ...remoteByKey.keys()]);
  for (const key of keys) {
    const localRecord = localByKey.get(key);
    const remoteEntriesForName = remoteByKey.get(key) || [];
    const newestRemoteEntry = remoteEntriesForName.reduce((newest, entry) => !newest || recordTime(entry.record) >= recordTime(newest.record) ? entry : newest, null);
    const remoteRecord = newestRemoteEntry?.record || null;
    const winner = !remoteRecord || (localRecord && recordTime(localRecord) >= recordTime(remoteRecord)) ? localRecord : remoteRecord;
    const winnerIsLocal = winner === localRecord;
    const matchingRemote = remoteEntriesForName.find(entry => entry.record.id === winner.id) || null;
    if (winnerIsLocal && (!matchingRemote || documentHash(matchingRemote.record) !== documentHash(winner))) {
      await uploadRecord(folder, winner);
      summary.uploaded += 1;
    }
    if (!winnerIsLocal && (!localRecord || localRecord.id !== winner.id || documentHash(localRecord) !== documentHash(winner))) {
      summary.downloaded += 1;
    }
    for (const entry of remoteEntriesForName) {
      if (entry.record.id === winner.id) continue;
      await graph(`/me/drive/items/${entry.itemId}`, { method: "DELETE" });
      cleanup.remoteRemoved += 1;
    }
    result.push(structuredClone(winner));
  }
  return { saves: result, rosterTombstones: [...tombstonesById.values()].map(item => structuredClone(item)), summary, cleanup };
}

async function sync(saves, syncState = null) {
  const rosters = await reconcileByName(saves, syncState?.rosterTombstones);
  if (!syncState) return rosters;
  const games = await reconcileGames(syncState.games);
  return {
    ...rosters,
    games: games.games,
    gameTombstones: games.tombstones,
    summary: {
      ...rosters.summary,
      uploaded: Number(rosters.summary?.uploaded || 0) + games.summary.uploaded,
      downloaded: Number(rosters.summary?.downloaded || 0) + games.summary.downloaded,
      conflicts: Number(rosters.summary?.conflicts || 0) + games.summary.conflicts,
      gamesUploaded: games.summary.uploaded,
      gamesDownloaded: games.summary.downloaded
    }
  };
}
async function cleanDuplicates(saves, syncState) { return sync(saves, syncState); }

async function beginSignIn() {
  if (ANDROID_NATIVE) {
    await accessToken();
    return;
  }
  const verifier = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  sessionStorage.setItem(ONEDRIVE_PKCE_KEY, verifier);
  const query = new URLSearchParams({
    client_id: ONEDRIVE_CLIENT_ID,
    response_type: "code",
    redirect_uri: redirectUri(),
    response_mode: "query",
    scope: ONEDRIVE_SCOPE,
    code_challenge: await sha256(verifier),
    code_challenge_method: "S256"
  });
  window.location.assign(`https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize?${query}`);
}

async function completeSignIn() {
  if (ANDROID_NATIVE) return false;
  if (!usableHere()) return false;
  const url = new URL(window.location.href);
  const error = url.searchParams.get("error");
  const code = url.searchParams.get("code");
  if (!error && !code) return false;
  window.history.replaceState({}, document.title, redirectUri());
  if (error) throw new Error(url.searchParams.get("error_description") || "OneDrive connection was cancelled.");
  const verifier = sessionStorage.getItem(ONEDRIVE_PKCE_KEY);
  sessionStorage.removeItem(ONEDRIVE_PKCE_KEY);
  if (!verifier) throw new Error("OneDrive sign-in expired. Please try Sync again.");
  saveTokens(await tokenRequest({
    client_id: ONEDRIVE_CLIENT_ID,
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri(),
    code_verifier: verifier,
    scope: ONEDRIVE_SCOPE
  }));
  return true;
}

window.OneDriveRosterSync = {
  available: usableHere(),
  getStatus: async () => ({
    available: usableHere(),
    connected: hasStoredConnection()
  }),
  beginSignIn,
  completeSignIn,
  sync,
  cleanDuplicates,
  cancelPendingSignIn: () => {
    const pending = pendingAndroidToken;
    pendingAndroidToken = null;
    if (pending) pending.reject(new Error("Microsoft sign-in was cancelled."));
    if (ANDROID_NATIVE && typeof window.AndroidOneDrive.cancelSignIn === "function") window.AndroidOneDrive.cancelSignIn();
  },
  disconnect: () => {
    const pending = pendingAndroidToken;
    pendingAndroidToken = null;
    if (pending) pending.reject(new Error("Microsoft sign-in was cancelled."));
    clearStoredConnection();
  },
  androidAccessTokenReceived: (token, error) => {
    const pending = pendingAndroidToken;
    pendingAndroidToken = null;
    if (!pending) return;
    if (token) pending.resolve("native");
    else pending.reject(new Error(error || "Microsoft sign-in did not finish."));
  },
  androidSignInCompleted: error => {
    const pending = pendingAndroidToken;
    pendingAndroidToken = null;
    if (!pending) return;
    if (error) pending.reject(new Error(error));
    else pending.resolve("native");
  },
  androidGraphResponseReceived: (requestId, status, body, error) => {
    const pending = pendingNativeGraphRequests.get(requestId);
    pendingNativeGraphRequests.delete(requestId);
    if (!pending) return;
    if (error) {
      pending.reject(new Error(error));
      return;
    }
    const responseBody = String(body || "");
    const responseStatus = Number(status || 0);
    pending.resolve({
      ok: responseStatus >= 200 && responseStatus < 300,
      status: responseStatus,
      text: async () => responseBody,
      json: async () => responseBody ? JSON.parse(responseBody) : {}
    });
  }
};
