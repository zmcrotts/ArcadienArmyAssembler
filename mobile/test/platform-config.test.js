"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..", "..");
const read = relative => fs.readFileSync(path.join(ROOT, relative), "utf8");

test("OneDrive sync loads alongside the roster document browser script", () => {
  const context = vm.createContext({ window: { location: { protocol: "https:" } } });
  vm.runInContext(read("src/domain/roster-document.js"), context);
  vm.runInContext(read("ui/onedrive-roster-sync.js"), context);
  assert.equal(context.window.OneDriveRosterSync?.available, true);
  assert.match(read("mobile/ui/index.html"), /onedrive-roster-sync\.js\?v=[^"]+/);
});

test("browser policy permits Microsoft OneDrive content redirects", () => {
  const index = read("mobile/ui/index.html");
  assert.match(index, /connect-src[^;]*https:\/\/graph\.microsoft\.com/);
  assert.match(index, /connect-src[^;]*https:\/\/\*\.1drv\.com/);
  assert.match(index, /connect-src[^;]*https:\/\/\*\.sharepoint\.com/);
  assert.match(index, /connect-src[^;]*https:\/\/\*\.microsoftpersonalcontent\.com/);
});

test("supported release targets exclude Linux", () => {
  const packageJson = JSON.parse(read("package.json"));
  assert.equal(Object.keys(packageJson.scripts).some(name => name.includes("linux")), false);
  assert.equal("linux" in packageJson.build, false);
  assert.equal(fs.existsSync(path.join(ROOT, ".github", "workflows", "linux-packages.yml")), false);
});

test("manual Android distribution is non-debuggable and requires release signing", () => {
  const gradle = read("mobile/android/app/build.gradle");
  assert.match(gradle, /sideload\s*\{[\s\S]*?debuggable false/);
  assert.match(gradle, /ARCADIEN_KEYSTORE_FILE/);
  assert.match(gradle, /Sideload signing is required/);
  assert.doesNotMatch(gradle, /sideload\s*\{[\s\S]*?signingConfig signingConfigs\.debug/);
});

test("Android WebView keeps credentials native and restricts file-origin privileges", () => {
  const activity = read("mobile/android/app/src/main/java/com/zmcrotts/arcadienarmyassembler/MainActivity.java");
  assert.match(activity, /setAllowContentAccess\(false\)/);
  assert.match(activity, /setAllowFileAccessFromFileURLs\(false\)/);
  assert.match(activity, /setAllowUniversalAccessFromFileURLs\(false\)/);
  assert.doesNotMatch(activity, /getCachedAccessToken/);
  assert.match(activity, /void graphRequest\(/);
  assert.match(activity, /path\.startsWith\("\/android_asset\/www\/"\)/);
});

test("desktop close and navigation protections are wired through preload", () => {
  const main = read("electron/main.js");
  const preload = read("electron/preload.js");
  assert.match(main, /fs\.existsSync\(path\.join\(executableRoot, "user-data"\)\)/);
  assert.match(main, /app:close-requested/);
  assert.match(main, /app:close-response/);
  assert.match(main, /will-navigate/);
  assert.match(preload, /desktopLifecycle/);
  assert.match(preload, /respondToClose/);
});

test("local installer rollback restores metadata and cleanup cannot mask the original failure", () => {
  const installer = read("scripts/build-local-installer.js");
  assert.match(installer, /CaptureRegistryKey\(RegistryKeyPath\)/);
  assert.match(installer, /LegacyAppExeName/);
  assert.match(installer, /IsRosterBuilderInstall\(installRoot\)/);
  assert.match(installer, /RestoreRegistryKey\(RegistryKeyPath, registrySnapshot\)/);
  assert.match(installer, /RestoreFile\(startMenuShortcut, startMenuShortcutSnapshot\)/);
  assert.match(installer, /DeleteDirectoryIfNewAndEmpty\(installRoot, installRootExisted\)/);
  assert.match(installer, /TryDeletePath\(stagingRoot\)/);
});

test("PWA manifest declares generated install icons", () => {
  const manifest = JSON.parse(read("mobile/ui/app.webmanifest"));
  assert.ok(manifest.icons.some(icon => icon.sizes === "192x192" && icon.purpose === "any"));
  assert.ok(manifest.icons.some(icon => icon.sizes === "512x512" && icon.purpose === "any"));
  assert.ok(manifest.icons.some(icon => icon.sizes === "512x512" && icon.purpose === "maskable"));
  const builder = read("mobile/scripts/build-user-runtime.js");
  assert.match(builder, /createCrosshairPng\(size\)/);
});

test("wide browser layout keeps the desktop shell visible", () => {
  const app = read("mobile/ui/engine-app.js");
  assert.match(app, /mobileShell\.hidden = !mobileLayout/);
  assert.match(app, /if \(!mobileLayout\) return/);
});

test("production UI does not render source-quality audit banners", () => {
  for (const relative of ["ui/engine-app.js", "mobile/ui/engine-app.js"]) {
    const app = read(relative);
    assert.doesNotMatch(app, /sourceIssueWarning/);
    assert.doesNotMatch(app, /Rules reference data reports/);
  }
});

test("Leader and Support render once as collapsed abilities", () => {
  for (const relative of ["ui/engine-app.js", "mobile/ui/engine-app.js"]) {
    const source = read(relative);
    const start = source.indexOf("function renderAbilities(");
    const end = source.indexOf("\nfunction renderTransportProfiles(", start);
    assert.ok(start >= 0 && end > start, `${relative} should expose renderAbilities`);
    const renderAbilities = new Function(
      "escapeHtml",
      "formatDescription",
      `${source.slice(start, end)}; return renderAbilities;`
    )(String, String);

    const supportHtml = renderAbilities([
      { name: "Other Ability", characteristics: { Description: "Other text" } },
      { name: "Leader", characteristics: { Description: "Duplicate leader text" } },
      { name: "Support", characteristics: { Description: "Actual support text" } }
    ], {
      roles: { leader: true, support: true },
      rosterRules: { leaderTargetNames: ["Bodyguard Squad"] }
    });
    assert.equal((supportHtml.match(/<summary>Support<\/summary>/g) || []).length, 1);
    assert.doesNotMatch(supportHtml, /<summary>Leader<\/summary>/);
    assert.ok(supportHtml.indexOf("Other Ability") < supportHtml.indexOf("Support"));
    assert.doesNotMatch(supportHtml, /<details class="card ruleDisclosure" open>\s*<summary>Support<\/summary>/);

    const leaderHtml = renderAbilities([
      { name: "Other Ability", characteristics: { Description: "Other text" } }
    ], {
      roles: { leader: true, support: false },
      rosterRules: { leaderTargetNames: ["Bodyguard Squad"] }
    });
    assert.equal((leaderHtml.match(/<summary>Leader<\/summary>/g) || []).length, 1);
    assert.doesNotMatch(leaderHtml, /<summary>Support<\/summary>/);
    assert.ok(leaderHtml.indexOf("Other Ability") < leaderHtml.indexOf("Leader"));
    assert.doesNotMatch(leaderHtml, /<details class="card ruleDisclosure" open>\s*<summary>Leader<\/summary>/);

    const rulesStart = source.indexOf("function renderRules(");
    const rulesEnd = source.indexOf("\nfunction entryPoints(", rulesStart);
    assert.ok(rulesStart >= 0 && rulesEnd > rulesStart, `${relative} should expose renderRules`);
    const renderRules = new Function(
      "escapeHtml",
      "formatDescription",
      `${source.slice(rulesStart, rulesEnd)}; return renderRules;`
    )(String, String);
    const supportRulesHtml = renderRules([
      { name: "Acts of Faith", description: "Army rule" },
      { name: "Support", description: "" }
    ], {
      roles: { leader: true, support: true }
    });
    assert.match(supportRulesHtml, /Acts of Faith/);
    assert.doesNotMatch(supportRulesHtml, />Support</);
    const leaderRulesHtml = renderRules([
      { name: "Leader", description: "Meaningful core Leader rule" }
    ], {
      roles: { leader: true, support: false }
    });
    assert.match(leaderRulesHtml, /Meaningful core Leader rule/);
  }
});

test("sheet previews keep executable code outside CSP-restricted blob documents", () => {
  for (const relative of ["ui/engine-app.js", "mobile/ui/engine-app.js"]) {
    const app = read(relative);
    assert.match(app, /function initializeSheetPreview\(preview\)/);
    assert.match(app, /id="printSheets" type="button"/);
    assert.doesNotMatch(app, /onclick="window\.print\(\)"/);
    assert.doesNotMatch(app, /<script>\s*function fitSheetsToA4/);
  }
});
