"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");

const ROOT = path.resolve(__dirname, "..", "..");
const source = fs.readFileSync(path.join(ROOT, "ui", "onedrive-roster-sync.js"), "utf8");

function response(status, body) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => JSON.parse(text),
    text: async () => text
  };
}

function browserSync(fetch) {
  const storage = new Map([["arcadienOneDriveTokens", JSON.stringify({
    access_token: "browser-token",
    expires_at: Date.now() + 60_000
  })]]);
  const localStorage = {
    getItem: key => storage.get(key) || null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: key => storage.delete(key)
  };
  const window = { location: { protocol: "https:", href: "https://example.test/app/" } };
  class XMLHttpRequest {
    open(method, url) {
      this.method = method;
      this.url = url;
    }
    send() {
      Promise.resolve(fetch(this.url)).then(async result => {
        this.status = result.status;
        this.responseText = await result.text();
        this.onload?.();
      }).catch(() => this.onerror?.());
    }
  }
  const context = vm.createContext({
    window,
    localStorage,
    sessionStorage: localStorage,
    fetch,
    crypto: webcrypto,
    TextEncoder,
    URL,
    URLSearchParams,
    XMLHttpRequest,
    structuredClone,
    btoa: value => Buffer.from(value, "binary").toString("base64"),
    console
  });
  vm.runInContext(source, context);
  return window.OneDriveRosterSync;
}

function graphFixture(directDownload) {
  const requests = [];
  const record = {
    id: "remote-roster",
    savedAt: "2026-07-18T12:00:00.000Z",
    document: { name: "Remote roster", rosterEntries: [] }
  };
  const downloadUrl = "https://public.dm.files.1drv.com/preauthenticated-roster";
  const fetch = async (url, options) => {
    requests.push({ url: String(url), options });
    if (String(url).endsWith("/me/drive/special/approot")) return response(200, { id: "app-root" });
    if (String(url).includes("/items/app-root:/rosters")) return response(200, { id: "rosters" });
    if (String(url).includes("/items/rosters/children")) {
      return response(200, { value: [{ id: "cloud-item", name: "cloud-item.json", file: {} }] });
    }
    if (String(url).includes("/items/cloud-item?select=id,@microsoft.graph.downloadUrl")) {
      return response(200, { id: "cloud-item", "@microsoft.graph.downloadUrl": downloadUrl });
    }
    if (String(url) === downloadUrl) return directDownload(record);
    throw new Error(`Unexpected request: ${url}`);
  };
  return { fetch, requests, record, downloadUrl };
}

test("Safari sync downloads through Graph's preauthenticated URL without OAuth headers", async () => {
  const fixture = graphFixture(record => response(200, {
    kind: "arcadien-roster-sync-record",
    version: 1,
    record
  }));
  const result = await browserSync(fixture.fetch).sync([]);

  assert.deepEqual(JSON.parse(JSON.stringify(result.saves)), [fixture.record]);
  assert.equal(result.summary.downloaded, 1);
  assert.equal(fixture.requests.some(request => request.url.endsWith("/content")), false);
  const download = fixture.requests.find(request => request.url === fixture.downloadUrl);
  assert.ok(download);
  assert.equal(download.options, undefined);
});

test("a blocked Safari download is reported instead of pretending OneDrive is empty", async () => {
  const fixture = graphFixture(() => { throw new TypeError("Failed to fetch"); });

  await assert.rejects(
    browserSync(fixture.fetch).sync([]),
    /Safari blocked the OneDrive file download/
  );
});
