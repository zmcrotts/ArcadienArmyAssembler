"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

global.qrcode = require("qrcode-generator");
const rosterQr = require("../src/domain/roster-qr");

test("roster QR links preserve an exact share code", () => {
  const code = "AAA2-AbCd_0123-safe";
  const url = rosterQr.buildImportUrl(code);
  assert.equal(url, "arcadien://import?code=AAA2-AbCd_0123-safe");
  assert.equal(rosterQr.parseImportUrl(url), code);
});

test("roster QR links reject the wrong protocol, host, missing code, and oversized payloads", () => {
  assert.throws(() => rosterQr.parseImportUrl("https://example.com/?code=AAA2-test"), /not an Arcadien roster link/);
  assert.throws(() => rosterQr.parseImportUrl("arcadien://other?code=AAA2-test"), /not an Arcadien roster link/);
  assert.throws(() => rosterQr.parseImportUrl("arcadien://import"), /does not contain/);
  assert.throws(() => rosterQr.buildImportUrl("x".repeat(rosterQr.MAX_QR_SHARE_CODE_LENGTH + 1)), /too large/);
});

test("roster QR generator produces a scalable standard QR image", () => {
  const svg = rosterQr.createQrSvg(rosterQr.buildImportUrl("AAA2-test-payload"));
  assert.match(svg, /^<svg /);
  assert.match(svg, /viewBox="0 0 \d+ \d+"/);
  assert.match(svg, /shape-rendering="crispEdges"/);
});

test("desktop and Android builds hand roster links to the confirmation-gated UI", () => {
  const ui = fs.readFileSync(require.resolve("../mobile/ui/engine-app.js"), "utf8");
  const html = fs.readFileSync(require.resolve("../mobile/ui/index.html"), "utf8");
  const desktopMain = fs.readFileSync(require.resolve("../electron/main.js"), "utf8");
  const desktopPreload = fs.readFileSync(require.resolve("../electron/preload.js"), "utf8");
  const manifest = fs.readFileSync(require.resolve("../mobile/android/app/src/main/AndroidManifest.xml"), "utf8");
  const android = fs.readFileSync(require.resolve("../mobile/android/app/src/main/java/com/zmcrotts/arcadienarmyassembler/MainActivity.java"), "utf8");

  assert.match(html, /id="openQrShare"/);
  assert.match(html, /id="confirmQrImport"[^>]*>Yes</);
  assert.match(html, /id="rejectQrImport"[^>]*>No</);
  assert.match(ui, /pendingQrImport = imported;[\s\S]*qrImportModal\.hidden = false/);
  assert.doesNotMatch(ui, /class="exportQrShare"|class="exportCopyShareCode"/);
  assert.match(html, /id="copyShareCode">Share Code<\/button>[\s\S]*id="openQrShare">QR<\/button>[\s\S]*id="openDiscordExport">Text<\/button>/);
  assert.doesNotMatch(ui, /class="startShareRoster"/);
  assert.match(ui, /async function confirmPendingQrImport\(\)[\s\S]*commitImportedRoster\(imported\)/);
  assert.match(ui, /function rejectPendingQrImport\(\)[\s\S]*pendingQrImport = null/);
  assert.match(desktopMain, /second-instance[\s\S]*deliverRosterImportUrl/);
  assert.match(desktopPreload, /roster-import-url/);
  assert.match(manifest, /android:scheme="arcadien" android:host="import"/);
  assert.match(android, /onNewIntent[\s\S]*deliverPendingRosterImport/);
  assert.match(android, /void shareText\(String title, String text\)/);
});

test("mobile autosave preserves a blank roster name while explicit save still supplies a fallback", () => {
  const ui = fs.readFileSync(require.resolve("../mobile/ui/engine-app.js"), "utf8");
  const autosave = ui.match(/function autosaveCurrentRoster\(options = \{\}\) \{[\s\S]*?\n\}/)?.[0] || "";

  assert.doesNotMatch(autosave, /document\.name = document\.name \|\|/);
  assert.doesNotMatch(autosave, /rosterNameInput\.value = document\.name/);
  assert.match(ui, /async function saveRoster\(\) \{[\s\S]*document\.name = document\.name \|\| `\$\{currentSubfaction \|\| currentFaction\} roster`/);
});
