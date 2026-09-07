"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");
const { createOneDriveRosterSync } = require("../electron/onedrive-roster-sync");

function response(status, body) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => JSON.parse(text),
    text: async () => text
  };
}

function record(name, lastEditedAt) {
  return {
    id: "shared-roster-id",
    savedAt: "2026-09-01T12:00:00.000Z",
    lastEditedAt,
    document: { name, faction: "test", rosterEntries: [] }
  };
}

test("a renamed roster reconciles by stable ID without duplicate results or automatic cloud deletion", async () => {
  let cloudRecord = record("Old list name", "2026-09-01T12:00:00.000Z");
  const requests = [];
  const fetch = async (url, options = {}) => {
    const target = String(url);
    requests.push({ target, method: options.method || "GET" });
    if (target.endsWith("/me/drive/special/approot")) return response(200, { id: "app-root" });
    if (target.includes("/items/app-root:/rosters")) return response(200, { id: "rosters" });
    if (target.includes("/items/rosters/children")) return response(200, { value: [{ id: "cloud-item", name: "cloud.json", file: {} }] });
    if (target.endsWith("/items/cloud-item/content")) return response(200, { kind: "arcadien-roster-sync-record", version: 1, record: cloudRecord });
    if (options.method === "PUT" && target.includes("/items/rosters:")) {
      cloudRecord = JSON.parse(options.body).record;
      return response(200, { id: "cloud-item" });
    }
    if (options.method === "DELETE") return response(204, "");
    throw new Error(`Unexpected request: ${target}`);
  };
  const service = createOneDriveRosterSync({
    crypto,
    fetch,
    readTokens: () => ({ access_token: "test-token", expires_at: Date.now() + 60_000 }),
    saveTokens: () => {},
    clearTokens: () => {}
  });
  const renamed = record("New list name", "2026-09-02T12:00:00.000Z");

  const first = await service.sync([renamed]);
  assert.equal(first.saves.length, 1);
  assert.equal(first.saves[0].document.name, "New list name");
  assert.equal(cloudRecord.document.name, "New list name");
  assert.equal(first.summary.uploaded, 1);
  assert.equal(first.summary.cloudIdentity, crypto.createHash("sha256").update("rosters").digest("base64url").slice(0, 10));
  assert.equal(requests.some(request => request.method === "DELETE"), false);

  const second = await service.sync([record("Old list name", "2026-09-01T12:00:00.000Z")]);
  assert.equal(second.saves.length, 1);
  assert.equal(second.saves[0].document.name, "New list name");
  assert.equal(second.summary.downloaded, 1);
  assert.equal(requests.some(request => request.method === "DELETE"), false);
});
