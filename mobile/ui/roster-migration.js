"use strict";
(function(global) {
  const MAX_BYTES = 50 * 1024 * 1024;
  function createPayload(rosters, games) {
    const version = games === undefined ? 1 : 2;
    const value = {kind:"arcadien.roster-migration",version,rosters};
    if (version === 2) value.games = games;
    const payload = JSON.stringify(value);
    readTransfer(payload);
    return payload;
  }
  function readTransfer(text) {
    if (typeof text !== "string" || new TextEncoder().encode(text).byteLength > MAX_BYTES) throw Error("The transfer exceeds the 50 MB limit.");
    const value = JSON.parse(text);
    if (!value || value.kind !== "arcadien.roster-migration" || ![1,2].includes(value.version) || !Array.isArray(value.rosters) || value.rosters.length > 500 || (value.version === 2 && (!Array.isArray(value.games) || value.games.length > 500))) throw Error("This is not a supported list and game-history transfer.");
    const games = value.version === 2 ? value.games : [];
    if (!value.rosters.length && !games.length) throw Error("There are no saved rosters or completed games to move.");
    return {rosters:value.rosters,games};
  }
  function readPayload(text) { return readTransfer(text).rosters; }
  function merge(existing, incoming) {
    const rosters = structuredClone(existing);
    let added = 0, skipped = 0;
    const idMap = new Map();
    for (const record of incoming) {
      const same = other => JSON.stringify(other.document) === JSON.stringify(record.document);
      let id = record.id, candidate = rosters.find(other => other.id === id), suffix = 0;
      while (candidate && !same(candidate)) {
        id = record.id.slice(0, 210) + "-moved-" + (++suffix);
        candidate = rosters.find(other => other.id === id);
      }
      idMap.set(record.id, id);
      if (candidate) { skipped++; continue; }
      rosters.push({...structuredClone(record),id}); added++;
    }
    return {rosters,added,skipped,idMap};
  }
  const api = {MAX_BYTES,createPayload,readPayload,readTransfer,merge};
  global.ArcadienRosterMigration = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
