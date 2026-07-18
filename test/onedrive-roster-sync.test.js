"use strict";

const assert = require("node:assert/strict");
const crypto = require("crypto");
const test = require("node:test");
const { createOneDriveRosterSync } = require("../electron/onedrive-roster-sync");

function record(id, name, savedAt) {
  return {
    id,
    savedAt,
    document: { name, faction: "test", armyState: {}, rosterEntries: [] }
  };
}

function response(status, body = {}, headerValues = {}) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  const normalizedHeaders = Object.fromEntries(Object.entries(headerValues).map(([name, value]) => [name.toLowerCase(), String(value)]));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: name => normalizedHeaders[String(name).toLowerCase()] || null },
    json: async () => text ? JSON.parse(text) : {},
    text: async () => text
  };
}

function syncedFileName(id) {
  return `${crypto.createHash("sha256").update(id).digest("base64url").slice(0, 43)}.json`;
}

function fakeGraph(remotePages = [[]], behavior = {}) {
  const requests = [];
  const items = new Map();
  for (const page of remotePages) {
    for (const entry of page) items.set(entry.itemId, entry);
  }
  const listedItem = entry => {
    const wrapper = entry.wrapper || { kind: "arcadien-roster-sync-record", version: entry.version ?? 1, record: entry.record };
    return {
      id: entry.itemId,
      name: entry.name || `${entry.itemId}.json`,
      file: {},
      size: entry.size ?? Buffer.byteLength(JSON.stringify(wrapper), "utf8"),
      eTag: entry.eTag || `\"${entry.itemId}-etag\"`
    };
  };
  const fetch = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    if (String(url).includes("/special/approot")) return response(200, { id: "app-root" });
    if (String(url).includes("/items/app-root:/rosters")) return response(200, { id: "rosters" });
    if (String(url).includes("/children?")) {
      const page = remotePages[0] || [];
      return response(200, {
        value: page.map(listedItem),
        "@odata.nextLink": remotePages.length > 1 ? "https://graph.microsoft.com/v1.0/me/drive/items/rosters/children-page-2" : null
      });
    }
    if (String(url).endsWith("/children-page-2")) {
      const page = remotePages[1] || [];
      return response(200, { value: page.map(listedItem) });
    }
    const contentItem = String(url).match(/\/items\/([^/]+)\/content$/);
    if (contentItem && String(options.method || "GET").toUpperCase() === "GET") {
      const entry = items.get(contentItem[1]);
      const wrapper = entry?.wrapper || (entry ? { kind: "arcadien-roster-sync-record", version: entry.version ?? 1, record: entry.record } : {});
      return response(entry ? 200 : 404, wrapper, entry?.contentLength ? { "content-length": entry.contentLength } : {});
    }
    if (String(options.method || "GET").toUpperCase() === "PUT") {
      if (behavior.rejectConditionalPut && options.headers?.["If-Match"]) {
        return response(412, { error: { message: "The cloud item changed during sync." } });
      }
      if (behavior.rejectCreateConflict && String(url).includes("@microsoft.graph.conflictBehavior=fail")) {
        return response(409, { error: { message: "Another device created this cloud item during sync." } });
      }
      return response(200, {});
    }
    if (String(options.method || "GET").toUpperCase() === "DELETE") return response(204, "");
    throw new Error(`Unhandled fake request: ${options.method || "GET"} ${url}`);
  };
  return { fetch, requests };
}

function clientWithGraph(graph, overrides = {}) {
  return createOneDriveRosterSync({
    crypto,
    fetch: graph.fetch,
    readTokens: () => ({ access_token: "token", expires_at: Date.now() + 60000 }),
    saveTokens: () => {},
    clearTokens: () => {},
    ...overrides
  });
}

test("OneDrive sync follows paging and consolidates same-named cross-device records", async () => {
  const graph = fakeGraph([[], [{ itemId: "remote-item", record: record("remote", "Same name", "2026-07-15T12:00:00.000Z") }]]);
  const client = clientWithGraph(graph);

  const result = await client.sync([record("local", "Same name", "2026-07-15T13:00:00.000Z")]);

  assert.deepEqual(result.saves.map(item => item.id), ["local"]);
  assert.equal(result.summary.conflicts, 0);
  assert.equal(result.summary.uploaded, 1);
  assert.equal(result.summary.downloaded, 0);
  assert.equal(graph.requests.some(item => item.url.endsWith("children-page-2")), true);
  assert.equal(graph.requests.some(item => item.options.method === "DELETE"), true);
});

test("OneDrive sync keeps the newest same-ID version without manufacturing a conflict copy", async () => {
  const remote = record("shared", "Desktop version", "2026-07-15T12:00:00.000Z");
  const graph = fakeGraph([[{
    itemId: "remote-item",
    name: syncedFileName("shared"),
    eTag: "\"shared-old\"",
    record: remote
  }]]);
  const client = clientWithGraph(graph);

  const result = await client.sync([record("shared", "Phone version", "2026-07-15T13:00:00.000Z")]);

  assert.equal(result.summary.conflicts, 0);
  assert.equal(result.saves.length, 1);
  assert.equal(result.saves.some(item => item.id === "shared" && item.document.name === "Phone version"), true);
  const uploads = graph.requests.filter(item => item.options.method === "PUT")
    .map(item => JSON.parse(item.options.body).record);
  assert.equal(uploads.length, 1);
  assert.equal(uploads[0].id, "shared");
  const canonicalUpload = graph.requests.find(item => item.options.method === "PUT" && JSON.parse(item.options.body).record.id === "shared");
  assert.equal(canonicalUpload.options.headers["If-Match"], "\"shared-old\"");
  assert.equal(graph.requests.some(item => item.options.method === "DELETE"), false);
});

test("OneDrive repair removes generated conflict copies when their canonical roster exists", async () => {
  const canonical = record("shared", "Current version", "2026-07-15T13:00:00.000Z");
  const generatedConflict = {
    ...record("roster-conflict-old", "Old version (conflict copy 2026-07-15)", "2026-07-15T12:00:00.000Z"),
    conflictOf: "shared"
  };
  const graph = fakeGraph([[
    { itemId: "canonical-item", record: canonical },
    { itemId: "conflict-item", record: generatedConflict }
  ]]);
  const client = clientWithGraph(graph);

  const result = await client.cleanDuplicates([canonical, generatedConflict]);

  assert.deepEqual(result.saves, [canonical]);
  assert.equal(result.cleanup.localRemoved, 1);
  assert.equal(result.cleanup.remoteRemoved, 1);
  assert.equal(result.cleanup.conflictCopiesRemoved, 1);
  assert.equal(graph.requests.some(item => item.options.method === "DELETE" && item.url.endsWith("/items/conflict-item")), true);
});

test("OneDrive repair removes only redundant exact cloud copies", async () => {
  const duplicate = record("same", "Identical", "2026-07-15T12:00:00.000Z");
  const graph = fakeGraph([[
    { itemId: "copy-a", eTag: "\"copy-a-version\"", record: duplicate },
    { itemId: "copy-b", eTag: "\"copy-b-version\"", record: duplicate }
  ]]);
  const client = clientWithGraph(graph);

  const result = await client.cleanDuplicates([duplicate]);

  assert.equal(result.cleanup.remoteRemoved, 1);
  assert.equal(result.summary.conflicts, 0);
  const deletes = graph.requests.filter(item => item.options.method === "DELETE");
  assert.equal(deletes.length, 1);
  assert.equal(deletes[0].options.headers["If-Match"], "\"copy-b-version\"");
});

test("stale cloud versions abort a canonical overwrite instead of losing a concurrent edit", async () => {
  const remote = record("shared", "Earlier cloud version", "2026-07-15T12:00:00.000Z");
  const graph = fakeGraph([[{
    itemId: "remote-item",
    name: syncedFileName("shared"),
    eTag: "\"stale-version\"",
    record: remote
  }]], { rejectConditionalPut: true });
  const client = clientWithGraph(graph);

  await assert.rejects(
    client.sync([record("shared", "New local version", "2026-07-15T13:00:00.000Z")]),
    /changed during sync/
  );

  const canonicalUpload = graph.requests.find(item => item.options.method === "PUT" && JSON.parse(item.options.body).record.id === "shared");
  assert.equal(canonicalUpload.options.headers["If-Match"], "\"stale-version\"");
});

test("new cloud records use fail-on-conflict creation instead of replacing a concurrent create", async () => {
  const graph = fakeGraph([[]], { rejectCreateConflict: true });
  const client = clientWithGraph(graph);

  await assert.rejects(
    client.sync([record("new-record", "First local version", "2026-07-15T13:00:00.000Z")]),
    /Another device created this cloud item/
  );

  const upload = graph.requests.find(item => item.options.method === "PUT");
  assert.match(upload.url, /@microsoft\.graph\.conflictBehavior=fail$/);
  assert.equal(upload.options.headers["If-Match"], undefined);
});

test("oversized cloud files are rejected before their content is downloaded", async () => {
  const graph = fakeGraph([[{
    itemId: "oversized",
    size: (10 * 1024 * 1024) + 1,
    record: record("oversized", "Too large", "2026-07-15T12:00:00.000Z")
  }]]);
  const client = clientWithGraph(graph);

  await assert.rejects(client.sync([]), /10 MB safety limit/);
  assert.equal(graph.requests.some(item => item.url.endsWith("/items/oversized/content")), false);
  assert.equal(graph.requests.some(item => item.options.method === "PUT"), false);
});

test("declared oversized Graph responses are rejected before parsing", async () => {
  const requests = [];
  const fetch = async url => {
    requests.push(String(url));
    return response(200, { id: "app-root" }, { "content-length": (10 * 1024 * 1024) + 1 });
  };
  const client = clientWithGraph({ fetch });

  await assert.rejects(client.sync([]), /10 MB safety limit/);
  assert.equal(requests.length, 1);
});

test("sync preserves roster data from other rules and app versions", async () => {
  const future = record("future", "Future schema", "2026-07-15T12:00:00.000Z");
  future.document.schemaVersion = 99;
  future.document.faction = "rules-not-installed-here";
  future.document.armyState = null;
  future.document.pointsLimit = 0;
  const graph = fakeGraph([[{ itemId: "future", record: future }]]);
  const client = clientWithGraph(graph);

  const result = await client.sync([]);

  assert.deepEqual(result.saves, [future]);
  assert.equal(result.summary.downloaded, 1);
});

test("invalid local records are rejected before any cloud request", async () => {
  const requests = [];
  const client = clientWithGraph({ fetch: async (...args) => {
    requests.push(args);
    return response(500, {});
  } });

  await assert.rejects(client.sync([{ id: "bad", savedAt: "not-a-date", document: {} }]), /timestamp is invalid/);
  assert.equal(requests.length, 0);
});

test("concurrent sync and repair requests run in order and both execute", async () => {
  const duplicate = record("same", "Identical", "2026-07-15T12:00:00.000Z");
  const graph = fakeGraph([[
    { itemId: "copy-a", record: duplicate },
    { itemId: "copy-b", record: duplicate }
  ]]);
  const client = clientWithGraph(graph);

  const [syncResult, repairResult] = await Promise.all([
    client.sync([duplicate]),
    client.cleanDuplicates([duplicate])
  ]);

  assert.equal(syncResult.cleanup.remoteRemoved, 1);
  assert.equal(repairResult.cleanup.remoteRemoved, 1);
  assert.equal(graph.requests.filter(item => item.url.includes("/special/approot")).length, 2);
});

test("terminal refresh-token failures clear the stored connection", async () => {
  let cleared = 0;
  const fetch = async url => {
    assert.match(String(url), /login\.microsoftonline\.com/);
    return response(400, { error: "invalid_grant", error_description: "The grant has been revoked." });
  };
  const client = createOneDriveRosterSync({
    crypto,
    fetch,
    readTokens: () => ({ refresh_token: "expired" }),
    saveTokens: () => {},
    clearTokens: () => { cleared += 1; }
  });

  await assert.rejects(client.accessToken(), /revoked/);
  assert.equal(cleared, 1);
});

test("OneDrive paging never forwards authorization to a non-Graph origin", async () => {
  const requested = [];
  const fetch = async url => {
    requested.push(String(url));
    if (String(url).includes("/special/approot")) return response(200, { id: "app-root" });
    if (String(url).includes("/items/app-root:/rosters")) return response(200, { id: "rosters" });
    if (String(url).includes("/children?")) return response(200, { value: [], "@odata.nextLink": "https://example.com/steal" });
    throw new Error(`Unexpected request ${url}`);
  };
  const client = clientWithGraph({ fetch });

  await assert.rejects(client.sync([]), /unexpected paging address/);
  assert.equal(requested.some(url => url.startsWith("https://example.com")), false);
});

test("a cloud-content 401 is surfaced instead of being mistaken for an unrelated file", async () => {
  let cleared = 0;
  const fetch = async url => {
    if (String(url).includes("/special/approot")) return response(200, { id: "app-root" });
    if (String(url).includes("/items/app-root:/rosters")) return response(200, { id: "rosters" });
    if (String(url).includes("/children?")) return response(200, { value: [{ id: "item", name: "item.json", file: {} }] });
    if (String(url).endsWith("/items/item/content")) return response(401, {});
    throw new Error(`Unexpected request ${url}`);
  };
  const client = clientWithGraph({ fetch }, { clearTokens: () => { cleared += 1; } });

  await assert.rejects(client.sync([]), /connection expired/);
  assert.equal(cleared, 1);
});
