"use strict";

// Public OAuth client ID: this is intentionally not a secret.
const CLIENT_ID = "30500f7e-c454-428c-8f16-c0318ae6174b";
const SCOPE = "offline_access https://graph.microsoft.com/Files.ReadWrite.AppFolder";
const GRAPH_ROOT = "https://graph.microsoft.com/v1.0";
const RECORD_KIND = "arcadien-roster-sync-record";
const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;
const MAX_RECORD_BYTES = 9 * 1024 * 1024;
const MAX_RECORDS = 500;
const MAX_ROSTER_ENTRIES = 2000;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
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
  if (document.name != null && (typeof document.name !== "string" || document.name.length > 240)) throw recordError("the roster name is invalid.");
  // Sync preserves roster documents across app and rules-data versions. Domain
  // compatibility (schema, faction, army state, and points limits) is checked
  // only when a user opens/imports a roster, never while transporting it.
  const entries = savedRosterEntries(document);
  if (entries.length > MAX_ROSTER_ENTRIES) throw recordError("the roster contains too many entries.");
  if (entries.some(entry => !entry || typeof entry !== "object" || Array.isArray(entry))) throw recordError("a roster entry is invalid.");
  let serialized;
  try {
    serialized = JSON.stringify(record);
  } catch {
    throw recordError("the record cannot be serialized safely.");
  }
  if (Buffer.byteLength(serialized, "utf8") > MAX_RECORD_BYTES) throw recordError("the record is too large to sync safely.");
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
    if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) throw responseTooLargeError();
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

function rosterCandidateGroups(local, remote) {
  const candidates = [
    ...local.map(record => ({ record, source: "local" })),
    ...remote.map(entry => ({ ...entry, source: "remote" }))
  ];
  const parents = candidates.map((_, index) => index);
  const find = index => parents[index] === index ? index : (parents[index] = find(parents[index]));
  const join = (left, right) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parents[rightRoot] = leftRoot;
  };
  const byId = new Map();
  const byName = new Map();
  candidates.forEach((candidate, index) => {
    const id = candidate.record.id;
    const name = String(candidate.record?.document?.name || "").trim().replace(/\s+/g, " ").toLocaleLowerCase();
    if (byId.has(id)) join(index, byId.get(id));
    else byId.set(id, index);
    if (name) {
      if (byName.has(name)) join(index, byName.get(name));
      else byName.set(name, index);
    }
  });
  const groups = new Map();
  candidates.forEach((candidate, index) => {
    const root = find(index);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(candidate);
  });
  return [...groups.values()];
}

function encodedFileName(crypto, id) {
  return `${crypto.createHash("sha256").update(id).digest("base64url").slice(0, 43)}.json`;
}

function createOneDriveRosterSync({ crypto, fetch, readTokens, saveTokens, clearTokens }) {
  async function tokenRequest(body) {
    const response = boundedResponse(await fetch("https://login.microsoftonline.com/consumers/oauth2/v2.0/token", {
      method: "POST",
      // The existing registration uses the localhost redirect as a browser app.
      // Supplying its registered origin keeps this public PKCE handoff compatible
      // while the token request still happens only after a manual Sync press.
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: "http://localhost:4173"
      },
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
    const tokens = readTokens();
    if (!tokens) return null;
    if (tokens.access_token && Number(tokens.expires_at || 0) > Date.now()) return tokens.access_token;
    if (!tokens.refresh_token) return null;
    let refreshed;
    try {
      refreshed = await tokenRequest({
        client_id: CLIENT_ID,
        grant_type: "refresh_token",
        refresh_token: tokens.refresh_token,
        scope: SCOPE
      });
    } catch (error) {
      if (error.code === "invalid_grant" || /AADSTS70000|invalid_grant|grant is expired|grant has been revoked/i.test(error.message || "")) {
        clearTokens();
      }
      throw error;
    }
    saveTokens({
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token || tokens.refresh_token,
      expires_at: Date.now() + Number(refreshed.expires_in || 3600) * 1000 - 60000
    });
    return refreshed.access_token;
  }

  async function graph(resource, options = {}) {
    const { allowStatuses = [], ...fetchOptions } = options;
    const token = await accessToken();
    if (!token) throw new Error("Connect OneDrive first.");
    let url = `${GRAPH_ROOT}${resource}`;
    if (/^https:\/\//i.test(resource)) {
      const parsed = new URL(resource);
      if (parsed.origin !== "https://graph.microsoft.com" || !parsed.pathname.startsWith("/v1.0/")) {
        throw new Error("OneDrive returned an unexpected paging address.");
      }
      url = parsed.href;
    }
    const response = boundedResponse(await fetch(url, {
      ...fetchOptions,
      headers: { Authorization: `Bearer ${token}`, ...(fetchOptions.headers || {}) }
    }));
    if (response.status === 401) {
      clearTokens();
      const error = new Error("Your OneDrive connection expired. Press Sync to connect it again.");
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
          // An unrelated or incomplete file cannot block the rest of a manual sync.
        }
      }
      nextPage = listing["@odata.nextLink"] || null;
    }
    return records;
  }

  async function uploadRecord(folder, record, expectedRemote = null) {
    assertValidRecord(record);
    const conditionalHeaders = expectedRemote?.eTag ? { "If-Match": expectedRemote.eTag } : {};
    const createCondition = expectedRemote ? "" : "?@microsoft.graph.conflictBehavior=fail";
    await graph(`/me/drive/items/${folder.id}:/${encodedFileName(crypto, record.id)}:/content${createCondition}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...conditionalHeaders },
      body: JSON.stringify({ kind: RECORD_KIND, version: 1, record }, null, 2)
    });
  }

  async function reconcileById(saves, options = {}) {
    let local = assertValidCollection(saves).map(clone);
    const folder = await rosterFolder();
    let remote = await remoteEntries(folder);
    const cloudFolder = crypto.createHash("sha256").update(String(folder.id || "")).digest("hex").slice(0, 8).toUpperCase();
    const summary = { uploaded: 0, downloaded: 0, conflicts: 0, cloudRecords: remote.length, localRecords: local.length, cloudFolder };
    const cleanup = { localRemoved: 0, remoteRemoved: 0, conflictCopiesRemoved: 0 };
    if (options.removeGeneratedConflictCopies) {
      const canonicalIds = new Set([...local, ...remote.map(entry => entry.record)]
        .filter(record => !record.conflictOf)
        .map(record => record.id));
      const generatedLocal = local.filter(record => record.conflictOf && canonicalIds.has(record.conflictOf));
      const generatedRemote = remote.filter(entry => entry.record.conflictOf && canonicalIds.has(entry.record.conflictOf));
      cleanup.conflictCopiesRemoved = new Set([...generatedLocal.map(record => record.id), ...generatedRemote.map(entry => entry.record.id)]).size;
      local = local.filter(record => !generatedLocal.includes(record));
      remote = remote.filter(entry => !generatedRemote.includes(entry));
      cleanup.localRemoved += generatedLocal.length;
      for (const entry of generatedRemote) {
        await graph(`/me/drive/items/${entry.itemId}`, {
          method: "DELETE",
          headers: entry.eTag ? { "If-Match": entry.eTag } : {}
        });
        cleanup.remoteRemoved += 1;
      }
    }
    const result = [];
    for (const candidates of rosterCandidateGroups(local, remote)) {
      const localCandidates = candidates.filter(candidate => candidate.source === "local");
      const remoteCandidates = candidates.filter(candidate => candidate.source === "remote");
      cleanup.localRemoved += Math.max(0, localCandidates.length - 1);
      const canonical = [...candidates].sort((left, right) => compareVersions(right.record, left.record))[0];
      if (!canonical) continue;
      const winner = clone(canonical.record);
      result.push(winner);
      if (!localCandidates.some(candidate => sameRecord(candidate.record, winner))) summary.downloaded += 1;
      const remoteMatches = remoteCandidates.filter(entry => sameRecord(entry.record, winner));
      let keptRemote = remoteMatches[0] || null;
      if (!remoteMatches.length) {
        const expectedFileName = encodedFileName(crypto, winner.id);
        const expectedRemote = remoteCandidates.find(entry => entry.record.id === winner.id && entry.name === expectedFileName) || null;
        await uploadRecord(folder, winner, expectedRemote);
        keptRemote = expectedRemote;
        summary.uploaded += 1;
      }
      for (const obsolete of remoteCandidates) {
        if (keptRemote && obsolete.itemId === keptRemote.itemId) continue;
        await graph(`/me/drive/items/${obsolete.itemId}`, {
            method: "DELETE",
            headers: obsolete.eTag ? { "If-Match": obsolete.eTag } : {}
        });
        cleanup.remoteRemoved += 1;
      }
    }
    return { saves: result, summary, cleanup };
  }

  let operationQueue = Promise.resolve();
  function runExclusive(operation) {
    const result = operationQueue.then(operation, operation);
    operationQueue = result.catch(() => {});
    return result;
  }

  async function sync(saves) { return runExclusive(() => reconcileById(saves)); }
  async function cleanDuplicates(saves) {
    return runExclusive(() => reconcileById(saves, { removeExactRemoteDuplicates: true, removeGeneratedConflictCopies: true }));
  }

  return { accessToken, tokenRequest, sync, cleanDuplicates };
}

module.exports = { CLIENT_ID, SCOPE, createOneDriveRosterSync };
