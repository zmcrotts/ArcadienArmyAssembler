"use strict";

// This is a public OAuth client ID, not a secret. The app never requests profile or email data.
const ONEDRIVE_CLIENT_ID = "30500f7e-c454-428c-8f16-c0318ae6174b";
const ONEDRIVE_SCOPE = "offline_access https://graph.microsoft.com/Files.ReadWrite.AppFolder";
const ONEDRIVE_TOKEN_KEY = "arcadienOneDriveTokens";
const ONEDRIVE_PKCE_KEY = "arcadienOneDrivePkce";
const GRAPH_ROOT = "https://graph.microsoft.com/v1.0";
const RECORD_KIND = "arcadien-roster-sync-record";
const ANDROID_NATIVE = Boolean(window.AndroidOneDrive);
let pendingAndroidToken = null;

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
  if (!response.ok) throw new Error(data.error_description || "Microsoft sign-in could not finish.");
  return data;
}

async function accessToken() {
  if (ANDROID_NATIVE) {
    const cached = window.AndroidOneDrive.getCachedAccessToken();
    if (cached) return cached;
    return new Promise((resolve, reject) => {
      pendingAndroidToken = { resolve, reject };
      window.AndroidOneDrive.beginSignIn();
    });
  }
  const tokens = readTokens();
  if (!tokens) return null;
  if (tokens.access_token && Number(tokens.expires_at || 0) > Date.now()) return tokens.access_token;
  if (!tokens.refresh_token) return null;
  const refreshed = await tokenRequest({
    client_id: ONEDRIVE_CLIENT_ID,
    grant_type: "refresh_token",
    refresh_token: tokens.refresh_token,
    scope: ONEDRIVE_SCOPE
  });
  saveTokens({ ...refreshed, refresh_token: refreshed.refresh_token || tokens.refresh_token });
  return refreshed.access_token;
}

async function graph(path, options = {}) {
  const token = await accessToken();
  if (!token) throw new Error("Connect OneDrive first.");
  const response = await fetch(`${GRAPH_ROOT}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, ...(options.headers || {}) }
  });
  if (response.status === 401) {
    localStorage.removeItem(ONEDRIVE_TOKEN_KEY);
    throw new Error("Your OneDrive connection expired. Connect it again to sync.");
  }
  if (!response.ok) {
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
  const value = Date.parse(record.savedAt || "");
  return Number.isFinite(value) ? value : 0;
}

async function fileName(id) {
  return `${(await sha256(id)).slice(0, 43)}.json`;
}

async function rosterFolder() {
  const root = await (await graph("/me/drive/special/approot")).json();
  const existing = await fetch(`${GRAPH_ROOT}/me/drive/items/${root.id}:/rosters`, {
    headers: { Authorization: `Bearer ${await accessToken()}` }
  });
  if (existing.ok) return existing.json();
  if (existing.status !== 404) throw new Error("OneDrive could not open the Arcadien sync folder.");
  const created = await graph(`/me/drive/items/${root.id}/children`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "rosters", folder: {}, "@microsoft.graph.conflictBehavior": "fail" })
  });
  return created.json();
}

async function remoteEntries(folder) {
  const listing = await (await graph(`/me/drive/items/${folder.id}/children?$select=id,name,file`)).json();
  const records = [];
  for (const item of listing.value || []) {
    if (!item.file || !item.name.endsWith(".json")) continue;
    try {
      const response = await graph(`/me/drive/items/${item.id}/content`);
      const parsed = JSON.parse(await response.text());
      if (parsed?.kind === RECORD_KIND && validRecord(parsed.record)) records.push({ record: parsed.record, itemId: item.id });
    } catch {
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

async function sync(saves) {
  const folder = await rosterFolder();
  const local = Array.isArray(saves) ? saves.filter(validRecord).map(record => structuredClone(record)) : [];
  const remote = (await remoteEntries(folder)).map(entry => entry.record);
  const remoteById = new Map(remote.map(record => [record.id, record]));
  const allIds = new Set(local.map(record => record.id));
  const result = local.map(record => structuredClone(record));
  const resultById = new Map(result.map(record => [record.id, record]));
  const summary = { uploaded: 0, downloaded: 0, conflicts: 0 };

  for (let index = 0; index < result.length; index += 1) {
    const current = result[index];
    const other = remoteById.get(current.id);
    if (!other) {
      await uploadRecord(folder, current);
      summary.uploaded += 1;
      continue;
    }
    if (documentHash(current) === documentHash(other)) continue;
    const keepLocal = recordTime(current) >= recordTime(other);
    const preserved = structuredClone(keepLocal ? other : current);
    let conflictId = `${preserved.id}-conflict-${(await sha256(documentHash(preserved))).slice(0, 8)}`;
    let suffix = 2;
    while (allIds.has(conflictId)) conflictId = `${preserved.id}-conflict-${suffix++}`;
    allIds.add(conflictId);
    preserved.id = conflictId;
    preserved.document.name = `${preserved.document.name || "Unnamed roster"} (sync conflict)`;
    if (keepLocal) await uploadRecord(folder, current);
    else {
      result[index] = structuredClone(other);
      resultById.set(other.id, result[index]);
      summary.downloaded += 1;
    }
    result.push(preserved);
    resultById.set(preserved.id, preserved);
    summary.conflicts += 1;
  }

  for (const record of remote) {
    if (resultById.has(record.id)) continue;
    result.push(structuredClone(record));
    resultById.set(record.id, record);
    summary.downloaded += 1;
  }
  return { saves: result, summary };
}

async function cleanDuplicates(saves) {
  const folder = await rosterFolder();
  const remote = await remoteEntries(folder);
  const source = Array.isArray(saves) ? saves.filter(validRecord) : [];
  const newestByContent = new Map();
  for (const record of source) {
    const key = documentHash(record);
    if (!newestByContent.has(key) || recordTime(record) > recordTime(newestByContent.get(key))) newestByContent.set(key, record);
  }
  const cleanLocal = [...newestByContent.values()].map(record => structuredClone(record));
  const keptIds = new Set(cleanLocal.map(record => record.id));
  const remoteByContent = new Map();
  for (const entry of remote) {
    const key = documentHash(entry.record);
    if (!remoteByContent.has(key)) remoteByContent.set(key, []);
    remoteByContent.get(key).push(entry);
  }
  let remoteRemoved = 0;
  for (const entries of remoteByContent.values()) {
    const matchingLocal = entries.find(entry => keptIds.has(entry.record.id));
    const keep = matchingLocal || entries.sort((a, b) => recordTime(b.record) - recordTime(a.record))[0];
    for (const entry of entries) {
      if (entry === keep) continue;
      await graph(`/me/drive/items/${entry.itemId}`, { method: "DELETE" });
      remoteRemoved += 1;
    }
    if (!matchingLocal && cleanLocal.some(record => documentHash(record) === documentHash(keep.record))) {
      await graph(`/me/drive/items/${keep.itemId}`, { method: "DELETE" });
      remoteRemoved += 1;
    }
  }
  const synced = await sync(cleanLocal);
  return { ...synced, cleanup: { localRemoved: source.length - cleanLocal.length, remoteRemoved } };
}

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
    connected: ANDROID_NATIVE ? Boolean(window.AndroidOneDrive.getCachedAccessToken()) : Boolean(await accessToken())
  }),
  beginSignIn,
  completeSignIn,
  sync,
  cleanDuplicates,
  disconnect: () => {
    if (ANDROID_NATIVE) window.AndroidOneDrive.disconnect();
    else localStorage.removeItem(ONEDRIVE_TOKEN_KEY);
  },
  androidAccessTokenReceived: (token, error) => {
    const pending = pendingAndroidToken;
    pendingAndroidToken = null;
    if (!pending) return;
    if (token) pending.resolve(token);
    else pending.reject(new Error(error || "Microsoft sign-in did not finish."));
  }
};
