"use strict";
(function(global) {
  const MAX_BYTES = 50 * 1024 * 1024;
  function createPayload(rosters) {
    if (!Array.isArray(rosters) || !rosters.length) throw Error("There are no saved rosters to move.");
    if (rosters.length > 500) throw Error("Move at most 500 rosters at a time.");
    const payload = JSON.stringify({kind:"arcadien.roster-migration",version:1,rosters});
    if (new TextEncoder().encode(payload).byteLength > MAX_BYTES) throw Error("The saved lists exceed the 50 MB transfer limit. Export smaller groups instead.");
    return payload;
  }
  function readPayload(text) {
    if (typeof text !== "string" || new TextEncoder().encode(text).byteLength > MAX_BYTES) throw Error("The transfer exceeds the 50 MB limit.");
    const value = JSON.parse(text);
    if (value.kind !== "arcadien.roster-migration" || value.version !== 1 || !Array.isArray(value.rosters) || !value.rosters.length || value.rosters.length > 500) throw Error("This is not a supported roster transfer.");
    return value.rosters;
  }
  function merge(existing, incoming) {
    const rosters = structuredClone(existing);
    let added = 0, skipped = 0;
    for (const record of incoming) {
      const same = other => JSON.stringify(other.document) === JSON.stringify(record.document);
      let id = record.id, candidate = rosters.find(other => other.id === id), suffix = 0;
      while (candidate && !same(candidate)) {
        id = record.id.slice(0, 210) + "-moved-" + (++suffix);
        candidate = rosters.find(other => other.id === id);
      }
      if (candidate) { skipped++; continue; }
      rosters.push({...structuredClone(record),id}); added++;
    }
    return {rosters,added,skipped};
  }
  const api = {MAX_BYTES,createPayload,readPayload,merge};
  global.ArcadienRosterMigration = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
