"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.resolve(__dirname, "..");
const PROJECT_ROOT = path.resolve(ROOT, "..");
const OUT_DIR = path.join(ROOT, "dist-user");

const FILES = [
  ["ui/styles.css", "styles.css"],
  ["ui/engine-app.js", "engine-app.js"],
  ["ui/engine-runtime.js", "engine-runtime.js"],
  ["ui/catalogue-sections.js", "catalogue-sections.js"],
  ["ui/offline-app.js", "offline-app.js"],
  ["ui/app.webmanifest", "app.webmanifest"],
  ["android/app/src/main/res/drawable/crosshair.png", "app-icon.png"],
  ["src/domain/army.js", "domain/army.js"],
  ["src/domain/roster-document.js", "domain/roster-document.js"],
  ["src/domain/sheets.js", "domain/sheets.js"]
];

const PROJECT_FILES = [
  ["ui/engine-data-manifest.js", "engine-data-manifest.js"],
  ["data/manual-rules/40k-compactor-skippable-wargear.json", "data/40k-compactor-skippable-wargear.json"]
];

function copyFile(source, target) {
  const from = path.join(ROOT, source);
  const to = path.join(OUT_DIR, target);
  if (!fs.existsSync(from)) throw new Error(`Missing runtime file: ${source}`);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

function copyProjectFile(source, target) {
  const from = path.join(PROJECT_ROOT, source);
  const to = path.join(OUT_DIR, target);
  if (!fs.existsSync(from)) throw new Error(`Missing shared project file: ${source}`);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

function copyDirectory(source, target) {
  const from = path.join(ROOT, source);
  const to = path.join(OUT_DIR, target);
  if (!fs.existsSync(from)) throw new Error(`Missing runtime directory: ${source}`);
  fs.cpSync(from, to, { recursive: true });
}

function copyProjectDirectory(source, target) {
  const from = path.join(PROJECT_ROOT, source);
  const to = path.join(OUT_DIR, target);
  if (!fs.existsSync(from)) throw new Error(`Missing shared project directory: ${source}`);
  fs.cpSync(from, to, { recursive: true });
}

function buildIndex() {
  const source = path.join(ROOT, "ui", "index.html");
  let html = fs.readFileSync(source, "utf8");

  html = html
    .replace(/<script(?:\s+defer)? src="engine-data-milestone15\.js"><\/script>/, '<script defer src="engine-data-manifest.js"></script>')
    .replace(/<script(?:\s+defer)? src="engine-data-manifest\.js"><\/script>/, '<script defer src="engine-data-manifest.js"></script>')
    .replace(/<script(?:\s+defer)? src="engine-runtime\.js\?v=([^"]+)"><\/script>/, '<script defer src="engine-runtime.js?v=$1"></script>')
    .replace(/<script(?:\s+defer)? src="\.\.\/src\/domain\/army\.js\?v=([^"]+)"><\/script>/, '<script defer src="domain/army.js?v=$1"></script>')
    .replace(/<script(?:\s+defer)? src="\.\.\/src\/domain\/roster-document\.js\?v=([^"]+)"><\/script>/, '<script defer src="domain/roster-document.js?v=$1"></script>')
    .replace(/<script(?:\s+defer)? src="\.\.\/src\/domain\/sheets\.js\?v=([^"]+)"><\/script>/, '<script defer src="domain/sheets.js?v=$1"></script>')
    .replace(/<script(?:\s+defer)? src="catalogue-sections\.js\?v=([^"]+)"><\/script>/, '<script defer src="catalogue-sections.js?v=$1"></script>')
    .replace(/<script(?:\s+defer)? src="engine-app\.js\?v=([^"]+)"><\/script>/, '<script defer src="engine-app.js?v=$1"></script>');

  fs.writeFileSync(path.join(OUT_DIR, "index.html"), html, "utf8");
}

function writeReadme() {
  const readme = [
    "Roster Builder",
    "",
    "This folder is the offline runtime build of the roster builder.",
    "",
    "Use:",
    "- In the desktop app, run Roster Builder from the installed shortcut.",
    "- For a plain browser check, open index.html from this folder.",
    "",
    "Saved rosters:",
    "- In the desktop app, saves live in the app's local Windows data folder.",
    "- The rules data is bundled in engine-data-manifest.js plus engine-data/*.js and does not require internet access.",
    "",
    "Generated files in this folder should not be edited by hand. Rebuild from the project source instead."
  ].join("\r\n");

  fs.writeFileSync(path.join(OUT_DIR, "README.txt"), readme, "utf8");
}

function runtimeFiles(directory, prefix = "") {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relative = path.posix.join(prefix, entry.name);
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...runtimeFiles(absolute, relative));
    else if (!["service-worker.js", "README.txt"].includes(relative)) files.push(relative);
  }
  return files.sort();
}

function writeServiceWorker() {
  const files = runtimeFiles(OUT_DIR);
  const hash = crypto.createHash("sha256");
  let totalBytes = 0;
  for (const relative of files) {
    const contents = fs.readFileSync(path.join(OUT_DIR, relative));
    totalBytes += contents.length;
    hash.update(relative);
    hash.update(contents);
  }
  const version = hash.digest("hex").slice(0, 16);
  const urls = files.map(relative => `./${relative.replaceAll("\\", "/")}`);
  urls.unshift("./");

  const source = `"use strict";

const OFFLINE_VERSION = ${JSON.stringify(version)};
const CACHE_PREFIX = "arcadien-offline-";
const CACHE_NAME = CACHE_PREFIX + OFFLINE_VERSION;
const READY_KEY = "./__offline-ready-" + OFFLINE_VERSION;
const OFFLINE_FILES = ${JSON.stringify(urls, null, 2)};
const TOTAL_BYTES = ${totalBytes};
let offlineReady = false;

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    offlineReady = await currentCacheIsReady();
    await self.clients.claim();
  })());
});

self.addEventListener("message", event => {
  const type = event.data?.type;
  if (type === "GET_OFFLINE_STATUS") event.waitUntil(sendStatus(event.source));
  if (type === "DOWNLOAD_OFFLINE") event.waitUntil(downloadOfflineCopy(event.source));
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(serveRequest(request));
});

async function currentCacheIsReady() {
  const cache = await caches.open(CACHE_NAME);
  return Boolean(await cache.match(READY_KEY));
}

async function sendStatus(client) {
  offlineReady = await currentCacheIsReady();
  client?.postMessage({
    type: "OFFLINE_STATUS",
    ready: offlineReady,
    version: OFFLINE_VERSION,
    completed: offlineReady ? OFFLINE_FILES.length : 0,
    total: OFFLINE_FILES.length,
    totalBytes: TOTAL_BYTES
  });
}

async function downloadOfflineCopy(client) {
  if (await currentCacheIsReady()) {
    offlineReady = true;
    client?.postMessage({
      type: "OFFLINE_READY",
      ready: true,
      version: OFFLINE_VERSION,
      completed: OFFLINE_FILES.length,
      total: OFFLINE_FILES.length,
      totalBytes: TOTAL_BYTES
    });
    return;
  }
  const cache = await caches.open(CACHE_NAME);
  offlineReady = false;
  try {
    for (let index = 0; index < OFFLINE_FILES.length; index += 1) {
      const url = OFFLINE_FILES[index];
      const request = new Request(url, { cache: "reload", credentials: "same-origin" });
      const response = await fetch(request);
      if (!response.ok) throw new Error(\`Could not download \${url} (\${response.status})\`);
      await cache.put(request, response);
      client?.postMessage({
        type: "OFFLINE_PROGRESS",
        completed: index + 1,
        total: OFFLINE_FILES.length,
        totalBytes: TOTAL_BYTES
      });
    }

    await cache.put(READY_KEY, new Response(JSON.stringify({ version: OFFLINE_VERSION, totalBytes: TOTAL_BYTES }), {
      headers: { "content-type": "application/json" }
    }));
    offlineReady = true;
    const names = await caches.keys();
    await Promise.all(names
      .filter(name => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
      .map(name => caches.delete(name)));
    client?.postMessage({
      type: "OFFLINE_READY",
      ready: true,
      version: OFFLINE_VERSION,
      completed: OFFLINE_FILES.length,
      total: OFFLINE_FILES.length,
      totalBytes: TOTAL_BYTES
    });
  } catch (error) {
    await caches.delete(CACHE_NAME);
    offlineReady = false;
    client?.postMessage({ type: "OFFLINE_ERROR", message: error?.message || "Offline download failed." });
  }
}

async function serveRequest(request) {
  const currentCache = await caches.open(CACHE_NAME);
  if (offlineReady) {
    const current = await currentCache.match(request, { ignoreSearch: true });
    if (current) return current;
  }

  try {
    const network = await fetch(request);
    if (network.ok) return network;
  } catch {
    // Fall through to the newest complete or partial offline copy.
  }

  const cached = await caches.match(request, { ignoreSearch: true });
  if (cached) return cached;
  if (request.mode === "navigate") {
    const index = await caches.match("./index.html", { ignoreSearch: true });
    if (index) return index;
  }
  return new Response("Arcadien Army Assembler is not fully available offline yet.", {
    status: 503,
    headers: { "content-type": "text/plain; charset=utf-8" }
  });
}
`;

  fs.writeFileSync(path.join(OUT_DIR, "service-worker.js"), source, "utf8");
  console.log(`Offline package: ${files.length + 1} requests, ${(totalBytes / 1024 / 1024).toFixed(2)} MB, version ${version}`);
}

function main() {
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const [source, target] of FILES) copyFile(source, target);
  for (const [source, target] of PROJECT_FILES) copyProjectFile(source, target);
  copyProjectDirectory("ui/engine-data", "engine-data");
  copyProjectDirectory("ui/assets", "assets");
  buildIndex();
  writeReadme();
  writeServiceWorker();

  const bundle = fs.statSync(path.join(OUT_DIR, "engine-data-manifest.js"));
  console.log(`Built ${OUT_DIR}`);
  console.log(`Runtime manifest: ${(bundle.size / 1024 / 1024).toFixed(2)} MB`);
}

if (require.main === module) main();

module.exports = { main };
