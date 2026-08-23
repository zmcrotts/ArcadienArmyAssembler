"use strict";

// Public OAuth client ID: this is intentionally not a secret.
const CLIENT_ID = "30500f7e-c454-428c-8f16-c0318ae6174b";
const SCOPE = "offline_access https://graph.microsoft.com/Files.ReadWrite.AppFolder";
const GRAPH_ROOT = "https://graph.microsoft.com/v1.0";
const RECORD_KIND = "arcadien-roster-sync-record";
const ROSTER_TOMBSTONE_KIND = "arcadien-roster-sync-tombstone";
const GAME_RECORD_KIND = "arcadien-game-sync-record";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function validRecord(record) {
  return Boolean(record)
    && typeof record === "object"
    && typeof record.id === "string"
    && record.id.length > 0
    && record.document
    && typeof record.document === "object";
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

function encodedFileName(crypto, id) {
  return `${crypto.createHash("sha256").update(id).digest("base64url").slice(0, 43)}.json`;
}

function createOneDriveRosterSync({ crypto, fetch, readTokens, saveTokens, clearTokens }) {
  async function tokenRequest(body) {
    const response = await fetch("https://login.microsoftonline.com/consumers/oauth2/v2.0/token", {
      method: "POST",
      // The existing registration uses the localhost redirect as a browser app.
      // Supplying its registered origin keeps this public PKCE handoff compatible
      // while the token request still happens only after a manual Sync press.
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: "http://localhost:4173"
      },
      body: new URLSearchParams(body)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error_description || "Microsoft sign-in could not finish.");
    return data;
  }

  async function accessToken() {
    const tokens = readTokens();
    if (!tokens) return null;
    if (tokens.access_token && Number(tokens.expires_at || 0) > Date.now()) return tokens.access_token;
    if (!tokens.refresh_token) return null;
    const refreshed = await tokenRequest({
      client_id: CLIENT_ID,
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
      scope: SCOPE
    });
    saveTokens({
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token || tokens.refresh_token,
      expires_at: Date.now() + Number(refreshed.expires_in || 3600) * 1000 - 60000
    });
    return refreshed.access_token;
  }

  async function graph(resource, options = {}) {
    const token = await accessToken();
    if (!token) throw new Error("Connect OneDrive first.");
    const response = await fetch(`${GRAPH_ROOT}${resource}`, {
      ...options,
      headers: { Authorization: `Bearer ${token}`, ...(options.headers || {}) }
    });
    if (response.status === 401) {
      clearTokens();
      throw new Error("Your OneDrive connection expired. Press Sync to connect it again.");
    }
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data?.error?.message || "OneDrive could not complete that sync.");
    }
    return response;
  }

  async function rosterFolder() {
    const root = await (await graph("/me/drive/special/approot")).json();
    const existing = await graph(`/me/drive/items/${root.id}:/rosters`).catch(error => {
      if (/item.*not.*found|not.*found/i.test(error.message)) return null;
      throw error;
    });
    if (existing) return existing.json();
    const created = await graph(`/me/drive/items/${root.id}/children`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "rosters", folder: {}, "@microsoft.graph.conflictBehavior": "fail" })
    });
    return created.json();
  }

  async function childFolder(name) {
    const root = await (await graph("/me/drive/special/approot")).json();
    const existing = await graph(`/me/drive/items/${root.id}:/${name}`).catch(error => {
      if (/item.*not.*found|not.*found/i.test(error.message)) return null;
      throw error;
    });
    if (existing) return existing.json();
    const created = await graph(`/me/drive/items/${root.id}/children`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, folder: {}, "@microsoft.graph.conflictBehavior": "fail" })
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
        // An unrelated or incomplete file cannot block the rest of a manual sync.
      }
    }
    return records;
  }

  async function uploadRecord(folder, record) {
    await graph(`/me/drive/items/${folder.id}:/${encodedFileName(crypto, record.id)}:/content`, {
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
      const response = await graph(`/me/drive/items/${item.id}/content`);
      try {
        const parsed = JSON.parse(await response.text());
        if (parsed?.kind === ROSTER_TOMBSTONE_KIND && validRosterTombstone(parsed.tombstone)) tombstones.push(parsed.tombstone);
      } catch {}
    }
    return tombstones;
  }

  async function uploadRosterTombstone(folder, tombstone) {
    await graph(`/me/drive/items/${folder.id}:/${encodedFileName(crypto, tombstone.id)}:/content`, {
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
      if (validGameSyncEntry(entry)) entries.push(clone(entry));
    }
    for (const tombstone of Array.isArray(state.tombstones) ? state.tombstones : []) {
      const entry = { type: "tombstone", ...tombstone };
      if (validGameSyncEntry(entry)) entries.push(clone(entry));
    }
    return entries;
  }

  async function remoteGameEntries(folder) {
    const listing = await (await graph(`/me/drive/items/${folder.id}/children?$select=id,name,file`)).json();
    const entries = [];
    for (const item of listing.value || []) {
      if (!item.file || !item.name.endsWith(".json")) continue;
      const response = await graph(`/me/drive/items/${item.id}/content`);
      try {
        const parsed = JSON.parse(await response.text());
        if (parsed?.kind === GAME_RECORD_KIND && validGameSyncEntry(parsed.entry)) entries.push(parsed.entry);
      } catch {}
    }
    return entries;
  }

  async function uploadGameEntry(folder, entry) {
    await graph(`/me/drive/items/${folder.id}:/${encodedFileName(crypto, entry.resultId)}:/content`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: GAME_RECORD_KIND, version: 1, entry }, null, 2)
    });
  }

  async function reconcileGames(state = {}) {
    const folder = await childFolder("games");
    const local = new Map(localGameEntries(state).map(entry => [entry.resultId, entry]));
    const remote = new Map((await remoteGameEntries(folder)).map(entry => [entry.resultId, entry]));
    const games = [], tombstones = [];
    const summary = { uploaded: 0, downloaded: 0, conflicts: 0 };
    for (const id of new Set([...local.keys(), ...remote.keys()])) {
      const localEntry = local.get(id) || null;
      const remoteEntry = remote.get(id) || null;
      let winner = localEntry || remoteEntry;
      if (localEntry?.type === "tombstone" || remoteEntry?.type === "tombstone") winner = localEntry?.type === "tombstone" ? localEntry : remoteEntry;
      else if (localEntry && remoteEntry && JSON.stringify(localEntry) !== JSON.stringify(remoteEntry)) {
        winner = localEntry;
        summary.conflicts += 1;
      }
      if (!remoteEntry || JSON.stringify(remoteEntry) !== JSON.stringify(winner)) {
        await uploadGameEntry(folder, winner);
        summary.uploaded += 1;
      }
      if (!localEntry && remoteEntry) summary.downloaded += 1;
      if (winner.type === "tombstone") tombstones.push({ resultId: winner.resultId, gameHash: winner.gameHash, deletedAt: winner.deletedAt });
      else games.push(clone(winner.game));
    }
    return { games, tombstones, summary };
  }

  async function reconcileByName(saves, rosterTombstones = []) {
    const folder = await rosterFolder();
    const localTombstones = (Array.isArray(rosterTombstones) ? rosterTombstones : []).filter(validRosterTombstone);
    const remoteTombstones = await remoteRosterTombstones(folder);
    const tombstonesById = new Map([...remoteTombstones, ...localTombstones].map(item => [item.id, item]));
    const deletedIds = new Set(tombstonesById.keys());
    const local = Array.isArray(saves) ? saves.filter(validRecord).filter(record => !deletedIds.has(record.id)).map(clone) : [];
    const remote = (await remoteEntries(folder)).filter(entry => !deletedIds.has(entry.record.id));
    const remoteTombstoneIds = new Set(remoteTombstones.map(item => item.id));
    const summary = { uploaded: 0, downloaded: 0, conflicts: 0, deletionsUploaded: 0 };
    for (const tombstone of localTombstones) if (!remoteTombstoneIds.has(tombstone.id)) {
      await uploadRosterTombstone(folder, tombstone);
      summary.deletionsUploaded += 1;
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
      result.push(clone(winner));
    }
    return { saves: result, rosterTombstones: [...tombstonesById.values()].map(clone), summary, cleanup };
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

  return { accessToken, tokenRequest, sync, cleanDuplicates };
}

module.exports = { CLIENT_ID, SCOPE, createOneDriveRosterSync };
