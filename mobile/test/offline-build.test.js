"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const MOBILE_ROOT = path.resolve(__dirname, "..");
const DIST = path.join(MOBILE_ROOT, "dist-user");

test("mobile build produces a complete installable offline package", () => {
  const index = fs.readFileSync(path.join(DIST, "index.html"), "utf8");
  const manifest = JSON.parse(fs.readFileSync(path.join(DIST, "app.webmanifest"), "utf8"));
  const worker = fs.readFileSync(path.join(DIST, "service-worker.js"), "utf8");
  const offlineApp = fs.readFileSync(path.join(DIST, "offline-app.js"), "utf8");
  const engineApp = fs.readFileSync(path.join(DIST, "engine-app.js"), "utf8");
  const styles = fs.readFileSync(path.join(DIST, "styles.css"), "utf8");
  const fileMatch = worker.match(/const OFFLINE_FILES = (\[[\s\S]*?\]);\nconst TOTAL_BYTES = (\d+);/);

  assert.match(index, /rel="manifest" href="app\.webmanifest"/);
  assert.match(index, /rel="apple-touch-icon" href="app-icon-192\.png"/);
  assert.match(index, /src="bootstrap-app\.js"/);
  assert.match(index, /src="offline-app\.js\?v=offline2"/);
  assert.match(index, /<div id="mobileSheetBackdrop"[^>]+aria-hidden="true" hidden><\/div>/);
  assert.match(offlineApp, /navigator\.standalone === true/);
  assert.match(offlineApp, /panel\.hidden = state === "ready" && installedApp/);
  assert.match(engineApp, /mobileSheetBackdrop\.onclick = closeMobileSheets/);
  assert.match(engineApp, /mobileSheetBackdrop\.hidden = mobileSheet !== "details"/);
  assert.match(engineApp, /class="loadoutStepper"/);
  assert.match(engineApp, /quantity" readonly/);
  assert.match(engineApp, /class="loadoutStep"[^>]+data-delta="-1"/);
  assert.match(engineApp, /applySelection\(input, Math\.max\(minimum, Math\.min\(maximum, requested\)\)\)/);
  assert.match(engineApp, /function renderTransportProfiles\(profiles\)/);
  assert.match(engineApp, /function renderAbilities\(abilities, definition = null\)/);
  assert.match(engineApp, /const attachmentName = definition\.roles\.support \? "Support" : "Leader"/);
  assert.match(engineApp, /standardAbilities\.filter\(ability => !isAttachmentProfile\(ability\) \|\| ability === matchingProfile\)/);
  assert.doesNotMatch(engineApp, /function renderLeaderAttachmentRule/);
  assert.match(engineApp, /function renderSheetTransportProfiles\(abilities\)/);
  assert.doesNotMatch(engineApp, /sourceIssueWarning|Rules reference data reports/);
  assert.match(engineApp, /function positionWeaponPreview\(wrap, popover, token\)/);
  assert.match(engineApp, /const openBelow = availableBelow >= Math\.min\(naturalHeight, 260\) \|\| availableBelow >= availableAbove/);
  assert.match(engineApp, /detailsPanel\?\.addEventListener\("scroll", \(\) => closeOpenWeaponPreview\(\)/);
  assert.match(styles, /\.mobileSheetBackdrop \{[\s\S]*?position: fixed;[\s\S]*?z-index: 60;/);
  assert.match(styles, /\.loadoutStepper \.loadoutStep \{[\s\S]*?min-height: 44px;/);
  assert.match(offlineApp, /registration\?\.update\(\)\.catch/);
  assert.match(offlineApp, /addEventListener\("controllerchange"/);
  assert.doesNotMatch(styles, /\.weaponPreviewWrap\.active \.weaponPreviewPopover \{[\s\S]{0,700}?top: 72px;/);
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.start_url, "./");
  assert.deepEqual(pngDimensions(path.join(DIST, "app-icon-192.png")), [192, 192]);
  assert.deepEqual(pngDimensions(path.join(DIST, "app-icon-512.png")), [512, 512]);
  assert.deepEqual(pngDimensions(path.join(DIST, "app-icon-maskable-512.png")), [512, 512]);
  assert.ok(manifest.icons.some(icon => icon.sizes === "192x192" && icon.purpose === "any"));
  assert.ok(manifest.icons.some(icon => icon.sizes === "512x512" && icon.purpose === "any"));
  assert.ok(manifest.icons.some(icon => icon.sizes === "512x512" && icon.purpose === "maskable"));
  assert.ok(fileMatch, "generated service worker should expose its complete asset list");

  const generatedUrls = JSON.parse(fileMatch[1]);
  const expectedFiles = listFiles(DIST)
    .filter(relative => !["README.txt", "service-worker.js"].includes(relative));
  const expectedUrls = ["./", ...expectedFiles.map(relative => `./${relative}`)];
  assert.deepEqual(generatedUrls, expectedUrls);

  const expectedBytes = expectedFiles.reduce((sum, relative) => sum + fs.statSync(path.join(DIST, relative)).size, 0);
  assert.equal(Number(fileMatch[2]), expectedBytes);
  assert.match(worker, /await cache\.put\(READY_KEY/);
  assert.match(worker, /const existing = await cache\.match/);
  assert.match(worker, /type === "SKIP_WAITING"/);
  assert.doesNotMatch(worker, /addEventListener\("install", \(\) => self\.skipWaiting\(\)\)/);
  assert.match(worker, /name\.startsWith\(CACHE_PREFIX\) && name !== CACHE_NAME/);

});

function pngDimensions(file) {
  const png = fs.readFileSync(file);
  assert.equal(png.subarray(1, 4).toString("ascii"), "PNG");
  return [png.readUInt32BE(16), png.readUInt32BE(20)];
}

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
