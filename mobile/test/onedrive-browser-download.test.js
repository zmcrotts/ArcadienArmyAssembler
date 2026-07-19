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

test("Android sync uses the current native connection and Graph bridge", async () => {
  const requests = [];
  const record = {
    id: "android-remote",
    savedAt: "2026-07-18T13:00:00.000Z",
    document: { name: "Android remote", rosterEntries: [] }
  };
  const window = { location: { protocol: "file:", href: "file:///android_asset/www/index.html" } };
  window.AndroidOneDrive = {
    hasCachedConnection: () => true,
    graphRequest: (requestId, method, requestPath, body, ifMatch) => {
      requests.push({ method, path: requestPath, body, ifMatch });
      let status = 200;
      let responseBody;
      if (requestPath === "/me/drive/special/approot") responseBody = { id: "app-root" };
      else if (requestPath === "/me/drive/items/app-root:/rosters") responseBody = { id: "rosters" };
      else if (requestPath.includes("/me/drive/items/rosters/children")) {
        responseBody = { value: [{ id: "android-item", name: "android-item.json", file: {} }] };
      } else if (requestPath === "/me/drive/items/android-item/content") {
        responseBody = { kind: "arcadien-roster-sync-record", version: 1, record };
      } else {
        status = 404;
        responseBody = { error: { message: `Unexpected native request ${requestPath}` } };
      }
      queueMicrotask(() => window.OneDriveRosterSync.androidGraphResponseReceived(
        requestId,
        status,
        JSON.stringify(responseBody),
        null
      ));
    },
    beginSignIn: () => { throw new Error("Sign-in should not start for a cached connection."); },
    disconnect: () => {}
  };
  const storage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  const context = vm.createContext({
    window,
    localStorage: storage,
    sessionStorage: storage,
    fetch: async () => { throw new Error("Android must not expose its token to browser fetch."); },
    crypto: webcrypto,
    TextEncoder,
    URL,
    URLSearchParams,
    structuredClone,
    btoa: value => Buffer.from(value, "binary").toString("base64"),
    queueMicrotask,
    console
  });
  vm.runInContext(source, context);

  const result = await window.OneDriveRosterSync.sync([]);

  assert.deepEqual(JSON.parse(JSON.stringify(result.saves)), [record]);
  assert.equal(result.summary.downloaded, 1);
  assert.equal(requests.some(request => request.path === "/me/drive/items/android-item/content"), true);
});
