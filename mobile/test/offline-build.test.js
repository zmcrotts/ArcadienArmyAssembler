"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");

const MOBILE_ROOT = path.resolve(__dirname, "..");
const DIST = path.join(MOBILE_ROOT, "dist-user");

test("mobile build produces a complete installable offline package", async () => {
  execFileSync(process.execPath, ["scripts/build-sites-runtime.js"], {
    cwd: MOBILE_ROOT,
    stdio: "pipe"
  });

  const index = fs.readFileSync(path.join(DIST, "index.html"), "utf8");
  const manifest = JSON.parse(fs.readFileSync(path.join(DIST, "app.webmanifest"), "utf8"));
  const worker = fs.readFileSync(path.join(DIST, "service-worker.js"), "utf8");
  const fileMatch = worker.match(/const OFFLINE_FILES = (\[[\s\S]*?\]);\nconst TOTAL_BYTES = (\d+);/);

  assert.match(index, /rel="manifest" href="app\.webmanifest"/);
  assert.match(index, /rel="apple-touch-icon" href="app-icon\.png"/);
  assert.match(index, /src="offline-app\.js\?v=offline1"/);
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.start_url, "./");
  assert.ok(fs.statSync(path.join(DIST, "app-icon.png")).size > 0);
  assert.ok(fileMatch, "generated service worker should expose its complete asset list");

  const generatedUrls = JSON.parse(fileMatch[1]);
  const expectedFiles = listFiles(DIST)
    .filter(relative => !["README.txt", "service-worker.js"].includes(relative));
  const expectedUrls = ["./", ...expectedFiles.map(relative => `./${relative}`)];
  assert.deepEqual(generatedUrls, expectedUrls);

  const expectedBytes = expectedFiles.reduce((sum, relative) => sum + fs.statSync(path.join(DIST, relative)).size, 0);
  assert.equal(Number(fileMatch[2]), expectedBytes);
  assert.match(worker, /await cache\.put\(READY_KEY/);
  assert.match(worker, /name\.startsWith\(CACHE_PREFIX\) && name !== CACHE_NAME/);

  const siteWorker = fs.readFileSync(path.join(MOBILE_ROOT, "dist", "server", "index.js"), "utf8");
  assert.match(siteWorker, /env\.ASSETS\.fetch/);
  assert.match(siteWorker, /service-worker-allowed/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(MOBILE_ROOT, "dist", "server", "package.json"), "utf8")).type, "module");
  assert.ok(fs.statSync(path.join(MOBILE_ROOT, "dist", "client", "service-worker.js")).size > 0);

  const serverUrl = pathToFileURL(path.join(MOBILE_ROOT, "dist", "server", "index.js"));
  serverUrl.searchParams.set("test", String(Date.now()));
  const { default: server } = await import(serverUrl.href);
  const assets = {
    async fetch(request) {
      const pathname = new URL(request.url).pathname.replace(/^\/+/, "");
      const file = path.join(MOBILE_ROOT, "dist", "client", pathname);
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return new Response("Not found", { status: 404 });
      return new Response(fs.readFileSync(file), { status: 200 });
    }
  };
  const home = await server.fetch(new Request("https://example.test/", { headers: { accept: "text/html" } }), { ASSETS: assets });
  assert.equal(home.status, 200);
  assert.match(await home.text(), /Arcadien Army Assembler/);
  const serviceWorker = await server.fetch(new Request("https://example.test/service-worker.js"), { ASSETS: assets });
  assert.equal(serviceWorker.status, 200);
  assert.equal(serviceWorker.headers.get("cache-control"), "no-cache, no-store, must-revalidate");
  assert.equal(serviceWorker.headers.get("service-worker-allowed"), "/");
});

function listFiles(directory, prefix = "") {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const relative = path.posix.join(prefix, entry.name);
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(absolute, relative));
    else files.push(relative);
  }
  return files.sort();
}
