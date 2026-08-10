"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const MOBILE_ROOT = path.resolve(__dirname, "..");
const PROJECT_ROOT = path.resolve(MOBILE_ROOT, "..");
const DIST = path.join(MOBILE_ROOT, "dist-user");

test("mobile build produces a complete installable offline package", () => {
  const index = fs.readFileSync(path.join(DIST, "index.html"), "utf8");
  const manifest = JSON.parse(fs.readFileSync(path.join(DIST, "app.webmanifest"), "utf8"));
  const worker = fs.readFileSync(path.join(DIST, "service-worker.js"), "utf8");
  const offlineApp = fs.readFileSync(path.join(DIST, "offline-app.js"), "utf8");
  const engineApp = fs.readFileSync(path.join(DIST, "engine-app.js"), "utf8");
  const styles = fs.readFileSync(path.join(DIST, "styles.css"), "utf8");
  const downloadPage = fs.readFileSync(path.join(DIST, "download.html"), "utf8");
  const downloadStyles = fs.readFileSync(path.join(DIST, "download.css"), "utf8");
  const release = JSON.parse(fs.readFileSync(path.join(MOBILE_ROOT, "public-release.json"), "utf8"));
  const desktopPackage = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, "package.json"), "utf8"));
  const mobilePackage = JSON.parse(fs.readFileSync(path.join(MOBILE_ROOT, "package.json"), "utf8"));
  const fileMatch = worker.match(/const OFFLINE_FILES = (\[[\s\S]*?\]);\nconst TOTAL_BYTES = (\d+);/);

  assert.match(index, /rel="manifest" href="app\.webmanifest"/);
  assert.match(index, /rel="apple-touch-icon" href="app-icon-192\.png"/);
  assert.match(index, /name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"/);
  assert.match(index, /name="apple-mobile-web-app-capable" content="yes"/);
  assert.match(index, /name="apple-mobile-web-app-status-bar-style" content="black-translucent"/);
  assert.match(index, /src="bootstrap-app\.js"/);
  assert.match(downloadPage, /New version\. Who dis\?/);
  assert.match(downloadPage, /releases\/latest\/download\/Arcadien-Army-Assembler-Windows\.exe/);
  assert.match(downloadPage, /releases\/latest\/download\/Arcadien-Army-Assembler-Android\.apk/);
  assert.match(downloadPage, /Open the iPhone\/iPad app/);
  assert.equal(release.windows.version, desktopPackage.version, "public Windows version must match package.json");
  assert.equal(release.android.version, mobilePackage.version, "public Android version must match mobile/package.json");
  assert.equal(release.ios.version, mobilePackage.version, "public iOS version must match mobile/package.json");
  for (const platform of ["windows", "android", "ios"]) {
    assert.match(release[platform].sha256, /^[A-F0-9]{64}$/, `${platform} release hash must be SHA-256`);
    assert.match(downloadPage, new RegExp(release[platform].sha256));
  }
  assert.match(downloadPage, new RegExp(`Windows ${release.windows.version.replaceAll(".", "\\.")}`));
  assert.match(downloadPage, new RegExp(`Android ${release.android.version.replaceAll(".", "\\.")}`));
  assert.match(downloadPage, new RegExp(`web app ${release.ios.version.replaceAll(".", "\\.")}`));
  assert.doesNotMatch(downloadPage, /\{\{[A-Z0-9_]+\}\}/);
  assert.match(downloadStyles, /\.platformGrid \{/);
  assert.match(index, /src="offline-app\.js\?v=offline2"/);
  assert.match(index, /<div id="mobileSheetBackdrop"[^>]+aria-hidden="true" hidden><\/div>/);
  assert.match(offlineApp, /navigator\.standalone === true/);
  assert.match(offlineApp, /panel\.hidden = state === "ready" && installedApp/);
  assert.match(engineApp, /mobileSheetBackdrop\.onclick = closeMobileSheets/);
  assert.match(engineApp, /class="mobileRosterSectionLabel"/);
  assert.match(engineApp, /<small>— \$\{section\.groups\.length\}/);
  assert.match(engineApp, />De-duplicate<\/button>/);
  assert.match(engineApp, />Un-sync<\/button>/);
  assert.match(engineApp, /class="startNewRoster" id="startNewRoster">New Roster<\/button>/);
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
  assert.match(engineApp, /function renderOptionNamePreview\(name, node = null\)/);
  assert.match(engineApp, /function collectRulesForOptionNode\(node\)/);
  assert.match(engineApp, /function autosaveCurrentRoster\(options = \{\}\)/);
  assert.match(engineApp, /document\.addEventListener\("visibilitychange"/);
  assert.match(engineApp, /const openBelow = availableBelow >= Math\.min\(naturalHeight, 260\) \|\| availableBelow >= availableAbove/);
  assert.match(engineApp, /detailsPanel\?\.addEventListener\("scroll", \(\) => closeOpenWeaponPreview\(\)/);
  assert.match(engineApp, /startHeaderLead/);
  assert.match(engineApp, /startIntro/);
  assert.match(engineApp, /syncProvider\?\.cleanDuplicates \? `<button id="startCleanSync"/);
  assert.match(engineApp, /if \(syncButton\) syncButton\.onclick = syncSavedRosters/);
  assert.match(styles, /\.mobileSheetBackdrop \{[\s\S]*?position: fixed;[\s\S]*?z-index: 60;/);
  assert.match(styles, /html\[data-mobile-ui="false"\] \.startScreen \{[\s\S]*?height: calc\(100vh - 32px\);[\s\S]*?overflow: hidden;/);
  assert.match(styles, /html\[data-mobile-ui="false"\] \.savedRosterCards \{[\s\S]*?flex: 1 1 auto;[\s\S]*?max-height: none;/);
  assert.match(styles, /\.startHeaderActions\.hasDisconnect \{[\s\S]*?repeat\(4, minmax\(0, 1fr\)\)/);
  assert.match(styles, /\.startNewRoster \{[\s\S]*?box-sizing: border-box;[\s\S]*?margin-left: 0;[\s\S]*?width: 100%;/);
  assert.match(styles, /body\.mobileAddOpen \.availablePanel #availableUnitsBody \{[\s\S]*?overflow-y: auto;/);
  assert.match(styles, /\.mobileUnitAddList \{\s*display: none;\s*\}/, "desktop build must hide the mobile-only unit picker");
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
  assert.match(worker, /const publicDownloadPage = requestUrl\.pathname\.endsWith\("\/download\.html"\)/);
  assert.match(worker, /fetch\(new Request\(request, \{ cache: "reload" \}\)\)/);
  assert.ok(worker.indexOf("if (publicDownloadPage)") < worker.indexOf("if (offlineReady)"), "the public download page must bypass cache-first app handling");

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
