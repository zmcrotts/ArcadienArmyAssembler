"use strict";

// This is a public OAuth client ID, not a secret. The app never requests profile or email data.
const ONEDRIVE_CLIENT_ID = "30500f7e-c454-428c-8f16-c0318ae6174b";
const ONEDRIVE_SCOPE = "offline_access https://graph.microsoft.com/Files.ReadWrite.AppFolder";
const ONEDRIVE_TOKEN_KEY = "arcadienOneDriveTokens";
const ONEDRIVE_PKCE_KEY = "arcadienOneDrivePkce";
const GRAPH_ROOT = "https://graph.microsoft.com/v1.0";
const RECORD_KIND = "arcadien-roster-sync-record";
const ROSTER_DOCUMENT_KIND = "roster-engine.savedRoster";
const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;
const MAX_RECORD_BYTES = 9 * 1024 * 1024;
const MAX_RECORDS = 500;
const MAX_ROSTER_ENTRIES = 2000;
const ANDROID_NATIVE = Boolean(window.AndroidOneDrive);
let pendingAndroidToken = null;
let operationQueue = Promise.resolve();
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
    try {
      localStorage.removeItem(ONEDRIVE_TOKEN_KEY);
    } catch {
      // A blocked browser store is equivalent to having no reusable connection.
    }
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
  const response = boundedResponse(await fetch("https://login.microsoftonline.com/consumers/oauth2/v2.0/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body)
  }));
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error_description || "Microsoft sign-in could not finish.");
    error.code = data.error || "oauth_error";
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
    if (error.code === "invalid_grant" || /AADSTS70000|invalid_grant|grant is expired|grant has been revoked/i.test(error.message || "")) {
      clearStoredConnection();
    }
    throw error;
  }
  saveTokens({ ...refreshed, refresh_token: refreshed.refresh_token || tokens.refresh_token });
  return refreshed.access_token;
}

async function nativeGraph(path, options = {}) {
  await accessToken();
  let relativePath = String(path || "");
  if (/^https:\/\//i.test(relativePath)) {
    const url = new URL(relativePath);
    if (url.origin !== "https://graph.microsoft.com" || !url.pathname.startsWith("/v1.0/")) {
      throw new Error("OneDrive returned an unexpected paging address.");
    }
    relativePath = `${url.pathname.slice("/v1.0".length)}${url.search}`;
  }
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
  const { allowStatuses = [], ...fetchOptions } = options;
  let response;
  if (ANDROID_NATIVE) {
    response = boundedResponse(await nativeGraph(path, fetchOptions));
  } else {
    const token = await accessToken();
    if (!token) throw new Error("Connect OneDrive first.");
    let url = `${GRAPH_ROOT}${path}`;
    if (/^https:\/\//i.test(path)) {
      const parsed = new URL(path);
      if (parsed.origin !== "https://graph.microsoft.com" || !parsed.pathname.startsWith("/v1.0/")) {
        throw new Error("OneDrive returned an unexpected paging address.");
      }
      url = parsed.href;
    }
    response = boundedResponse(await fetch(url, {
      ...fetchOptions,
      headers: { Authorization: `Bearer ${token}`, ...(fetchOptions.headers || {}) }
    }));
  }
  if (response.status === 401) {
    clearStoredConnection();
    const error = new Error("Your OneDrive connection expired. Connect it again to sync.");
    error.code = "ONEDRIVE_AUTH_REQUIRED";
    throw error;
  }
  if (!response.ok && !allowStatuses.includes(response.status)) {
    const data = await response.json().catch(() => ({}));
    const error = new Error(data?.error?.message || "OneDrive could not complete that sync.");
    error.code = "ONEDRIVE_GRAPH_FAILED";
    error.status = response.status;
    throw error;
  }
  return response;
}

function recordError(message) {
  const error = new Error(`A synced roster was rejected: ${message}`);
  error.code = "ONEDRIVE_INVALID_RECORD";
  return error;
}

function savedRosterEntries(document) {
  for (const key of ["rosterEntries", "units", "roster"]) {
    if (document[key] == null) continue;
    if (!Array.isArray(document[key])) throw recordError(`${key} must be an array.`);
    return document[key];
  }
  return [];
}

function assertValidRecord(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) throw recordError("the record is not an object.");
  if (typeof record.id !== "string" || !record.id || record.id.length > 240) throw recordError("the saved-record ID is invalid.");
  if (!Number.isFinite(Date.parse(record.savedAt || ""))) throw recordError("the save timestamp is invalid.");
  const document = record.document;
  if (!document || typeof document !== "object" || Array.isArray(document)) throw recordError("the roster document is invalid.");
  if (document.kind != null && document.kind !== ROSTER_DOCUMENT_KIND) throw recordError("the roster document kind is unsupported.");
  if (document.schemaVersion != null) {
    const schemaVersion = Number(document.schemaVersion);
    if (!Number.isInteger(schemaVersion) || schemaVersion < 1 || schemaVersion > 2) throw recordError("the roster schema version is unsupported.");
  }
  if (typeof document.faction !== "string" || !document.faction.trim() || document.faction.length > 240) throw recordError("the faction is invalid.");
  if (!document.armyState || typeof document.armyState !== "object" || Array.isArray(document.armyState)) throw recordError("the army configuration is invalid.");
  if (document.name != null && (typeof document.name !== "string" || document.name.length > 240)) throw recordError("the roster name is invalid.");
  if (document.pointsLimit != null) {
    const pointsLimit = Number(document.pointsLimit);
    if (!Number.isFinite(pointsLimit) || pointsLimit <= 0 || pointsLimit > 100000) throw recordError("the points limit is invalid.");
  }
  const entries = savedRosterEntries(document);
  if (entries.length > MAX_ROSTER_ENTRIES) throw recordError("the roster contains too many entries.");
  if (entries.some(entry => !entry || typeof entry !== "object" || Array.isArray(entry))) throw recordError("a roster entry is invalid.");
  let serialized;
  try {
    serialized = JSON.stringify(record);
  } catch {
    throw recordError("the record cannot be serialized safely.");
  }
  if (new TextEncoder().encode(serialized).byteLength > MAX_RECORD_BYTES) throw recordError("the record is too large to sync safely.");
  return record;
}

function assertValidCollection(records) {
  if (!Array.isArray(records)) throw recordError("the local roster library is invalid.");
  if (records.length > MAX_RECORDS) throw recordError(`the roster library exceeds ${MAX_RECORDS} records.`);
  for (const record of records) assertValidRecord(record);
  return records;
}

function responseTooLargeError() {
  const error = new Error("OneDrive returned more than the 10 MB safety limit.");
  error.code = "ONEDRIVE_RESPONSE_TOO_LARGE";
  return error;
}

async function readBoundedResponseText(response) {
  const declaredLength = Number(response.headers?.get?.("content-length") || 0);
  if (declaredLength > MAX_RESPONSE_BYTES) throw responseTooLargeError();
  if (!response.body?.getReader) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) throw responseTooLargeError();
    return text;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_RESPONSE_BYTES) {
      await reader.cancel().catch(() => {});
      throw responseTooLargeError();
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

function boundedResponse(response) {
  let textPromise = null;
  const text = () => {
    if (!textPromise) textPromise = readBoundedResponseText(response);
    return textPromise;
  };
  return {
    ok: response.ok,
    status: response.status,
    headers: response.headers,
    text,
    json: async () => {
      const body = await text();
      return body ? JSON.parse(body) : {};
    }
  };
}

function documentHash(record) {
  return JSON.stringify(record.document);
}

function sameRecord(left, right) {
  return Boolean(left && right)
    && left.id === right.id
    && String(left.savedAt || "") === String(right.savedAt || "")
    && documentHash(left) === documentHash(right);
}

function recordTime(record) {
  const value = Date.parse(record.savedAt || "");
  return Number.isFinite(value) ? value : 0;
}

function compareVersions(left, right) {
  const timeDifference = recordTime(left) - recordTime(right);
  if (timeDifference) return timeDifference;
  return documentHash(left).localeCompare(documentHash(right));
}

async function conflictRecord(record, originalId) {
  const hash = (await sha256(`${originalId}\n${documentHash(record)}`)).slice(0, 24);
  const timestamp = record.savedAt && Number.isFinite(Date.parse(record.savedAt))
    ? new Date(record.savedAt).toISOString().slice(0, 10)
    : "undated";
  const result = structuredClone(record);
  const originalName = String(result.document.name || "Unnamed roster").replace(/\s+\(conflict copy[^)]*\)$/i, "");
  result.id = `roster-conflict-${hash}`;
  result.conflictOf = originalId;
  result.document.name = `${originalName} (conflict copy ${timestamp})`;
  return result;
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

async function remoteEntries(folder) {
  const records = [];
  let inspectedJsonFiles = 0;
  let nextPage = `/me/drive/items/${folder.id}/children?$select=id,name,file,size,eTag`;
  while (nextPage) {
    const listing = await (await graph(nextPage)).json();
    for (const item of listing.value || []) {
      if (!item.file || !item.name.endsWith(".json")) continue;
      inspectedJsonFiles += 1;
      if (inspectedJsonFiles > MAX_RECORDS) throw recordError(`the cloud folder exceeds ${MAX_RECORDS} JSON records.`);
      if (Number(item.size || 0) > MAX_RESPONSE_BYTES) throw responseTooLargeError();
      try {
        const response = await graph(`/me/drive/items/${item.id}/content`);
        const parsed = JSON.parse(await response.text());
        if (parsed?.kind !== RECORD_KIND) continue;
        if (parsed.version !== 1) throw recordError("the cloud record version is unsupported.");
        assertValidRecord(parsed.record);
        records.push({ record: parsed.record, itemId: item.id, eTag: item.eTag || null, name: item.name });
      } catch (error) {
        if (["ONEDRIVE_AUTH_REQUIRED", "ONEDRIVE_GRAPH_FAILED", "ONEDRIVE_INVALID_RECORD", "ONEDRIVE_RESPONSE_TOO_LARGE"].includes(error.code)) throw error;
        // Ignore an unrelated or partially synced file; it must not block a library sync.
      }
    }
    nextPage = listing["@odata.nextLink"] || null;
  }
  return records;
}

async function uploadRecord(folder, record, expectedRemote = null) {
  assertValidRecord(record);
  const createCondition = expectedRemote ? "" : "?@microsoft.graph.conflictBehavior=fail";
  await graph(`/me/drive/items/${folder.id}:/${await fileName(record.id)}:/content${createCondition}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      ...(expectedRemote?.eTag ? { "If-Match": expectedRemote.eTag } : {})
    },
    body: JSON.stringify({ kind: RECORD_KIND, version: 1, record }, null, 2)
  });
}

async function reconcileById(saves, options = {}) {
  const local = assertValidCollection(saves).map(record => structuredClone(record));
  const folder = await rosterFolder();
  const remote = await remoteEntries(folder);
  const localById = new Map();
  for (const record of local) {
    if (!localById.has(record.id)) localById.set(record.id, []);
    localById.get(record.id).push({ record, source: "local" });
  }
  const remoteById = new Map();
  for (const entry of remote) {
    if (!remoteById.has(entry.record.id)) remoteById.set(entry.record.id, []);
    remoteById.get(entry.record.id).push({ ...entry, source: "remote" });
  }
  const summary = { uploaded: 0, downloaded: 0, conflicts: 0 };
  const cleanup = { localRemoved: 0, remoteRemoved: 0 };
  const result = [];
  const pendingUploads = [];
  const ids = new Set([...localById.keys(), ...remoteById.keys()]);
  for (const id of ids) {
    const candidates = [...(localById.get(id) || []), ...(remoteById.get(id) || [])];
    const distinctByDocument = new Map();
    for (const candidate of candidates) {
      const hash = documentHash(candidate.record);
      const previous = distinctByDocument.get(hash);
      if (!previous || compareVersions(candidate.record, previous.record) > 0 || (candidate.source === "local" && previous.source !== "local")) {
        distinctByDocument.set(hash, candidate);
      }
    }
    const versions = [...distinctByDocument.values()].sort((left, right) => compareVersions(right.record, left.record));
    if (!versions.length) continue;
    const canonical = versions[0];
    const outputs = [{ ...canonical, record: structuredClone(canonical.record) }];
    for (const version of versions.slice(1)) {
      const conflict = await conflictRecord(version.record, id);
      assertValidRecord(conflict);
      outputs.push({ ...version, record: conflict });
      summary.conflicts += 1;
    }
    for (const output of outputs) {
      if (result.some(record => sameRecord(record, output.record))) continue;
      result.push(structuredClone(output.record));
      const localMatch = local.find(record => sameRecord(record, output.record));
      const remoteMatches = remote.filter(entry => sameRecord(entry.record, output.record));
      if (!localMatch && output.source === "remote") summary.downloaded += 1;
      if (!remoteMatches.length) {
        const expectedFileName = await fileName(output.record.id);
        pendingUploads.push({
          record: output.record,
          expectedRemote: remote.find(entry => entry.record.id === output.record.id && entry.name === expectedFileName) || null
        });
      }
      if (options.removeExactRemoteDuplicates && remoteMatches.length > 1) {
        for (const duplicate of remoteMatches.slice(1)) {
          await graph(`/me/drive/items/${duplicate.itemId}`, {
            method: "DELETE",
            headers: duplicate.eTag ? { "If-Match": duplicate.eTag } : {}
          });
          cleanup.remoteRemoved += 1;
        }
      }
    }
  }
  pendingUploads.sort((left, right) => Number(Boolean(left.record.conflictOf)) - Number(Boolean(right.record.conflictOf))).reverse();
  for (const upload of pendingUploads) {
    await uploadRecord(folder, upload.record, upload.expectedRemote);
    summary.uploaded += 1;
  }
  return { saves: result, summary, cleanup };
}

function runExclusive(operation) {
  const result = operationQueue.then(operation, operation);
  operationQueue = result.catch(() => {});
  return result;
}

async function sync(saves) { return runExclusive(() => reconcileById(saves)); }
async function cleanDuplicates(saves) {
  return runExclusive(() => reconcileById(saves, { removeExactRemoteDuplicates: true }));
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
    if (ANDROID_NATIVE && typeof window.AndroidOneDrive.cancelSignIn === "function") {
      window.AndroidOneDrive.cancelSignIn();
    }
  },
  disconnect: () => {
    const pending = pendingAndroidToken;
    pendingAndroidToken = null;
    if (pending) pending.reject(new Error("Microsoft sign-in was cancelled."));
    clearStoredConnection();
  },
  androidAccessTokenReceived: (token, error) => {
    // Compatibility with older sideloaded wrappers during a rolling update.
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
      const requestError = new Error(error);
      requestError.code = "ONEDRIVE_GRAPH_FAILED";
      pending.reject(requestError);
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
