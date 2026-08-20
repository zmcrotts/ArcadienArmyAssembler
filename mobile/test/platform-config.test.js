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
  const packageJson = JSON.parse(read("mobile/package.json"));
  const releaseScript = read("mobile/scripts/build-signed-android.ps1");
  assert.match(gradle, /sideload\s*\{[\s\S]*?debuggable false/);
  assert.match(gradle, /ARCADIEN_KEYSTORE_FILE/);
  assert.match(gradle, /Sideload signing is required/);
  assert.doesNotMatch(gradle, /sideload\s*\{[\s\S]*?signingConfig signingConfigs\.debug/);
  assert.match(packageJson.scripts["android:release"], /build-signed-android\.ps1/);
  assert.match(releaseScript, /arcadien-sideload\.password\.dpapi/);
  assert.match(releaseScript, /expectedCertificate/);
  assert.match(releaseScript, /apksigner verify --print-certs/);
});

test("Android WebView keeps credentials native and restricts file-origin privileges", () => {
  const activity = read("mobile/android/app/src/main/java/com/zmcrotts/arcadienarmyassembler/MainActivity.java");
  assert.match(activity, /setAllowContentAccess\(false\)/);
  assert.match(activity, /setAllowFileAccessFromFileURLs\(false\)/);
  assert.match(activity, /setAllowUniversalAccessFromFileURLs\(false\)/);
  assert.doesNotMatch(activity, /getCachedAccessToken/);
  assert.match(activity, /void graphRequest\(/);
  assert.match(activity, /path\.startsWith\("\/android_asset\/www\/"\)/);
  assert.doesNotMatch(activity, /minimumCameraClearance/);
  assert.doesNotMatch(activity, /setPadding\(left, Math\.max\(top/);
  assert.match(activity, /setPadding\(left, top, right, bottom\)/);
});

test("Android OneDrive bridge permits the roster and game sync folders", () => {
  const activity = read("mobile/android/app/src/main/java/com/zmcrotts/arcadienarmyassembler/MainActivity.java");
  assert.ok(activity.includes('^/me/drive/items/[^/?#:]+:/(?:rosters|games)(?:\\\\?.*)?$'));
});

test("desktop closes directly while retaining navigation protections", () => {
  const main = read("electron/main.js");
  const preload = read("electron/preload.js");
  assert.match(main, /fs\.existsSync\(path\.join\(executableRoot, "user-data"\)\)/);
  assert.match(main, /will-navigate/);
  assert.doesNotMatch(main, /app:close-requested|app:close-response|showMessageBox|event\.preventDefault\(\);\s*requestRendererCloseDecision/);
  assert.doesNotMatch(preload, /desktopLifecycle|respondToClose/);
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

test("updates use the published manifest and verified native installer handoff", () => {
  const index = read("mobile/ui/index.html");
  const app = read("mobile/ui/engine-app.js");
  const styles = read("mobile/ui/styles.css");
  const desktopMain = read("electron/main.js");
  const preload = read("electron/preload.js");
  const androidManifest = read("mobile/android/app/src/main/AndroidManifest.xml");
  const androidActivity = read("mobile/android/app/src/main/java/com/zmcrotts/arcadienarmyassembler/MainActivity.java");
  const androidProvider = read("mobile/android/app/src/main/java/com/zmcrotts/arcadienarmyassembler/UpdateFileProvider.java");
  const builder = read("mobile/scripts/build-user-runtime.js");

  assert.match(app, /id="startCheckUpdates"[^>]*>[\s\S]*?updateButtonWide[^>]*>Check for Updates<\/span>[\s\S]*?updateButtonNarrow[^>]*>Updates<\/span>/);
  assert.match(index, /id="updateModal"/);
  assert.match(index, /connect-src[^;]*https:\/\/zmcrotts\.github\.io/);
  assert.match(styles, /@media \(max-width: 520px\) \{[\s\S]*?\.startHeaderActions \{[\s\S]*?grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/);
  assert.match(preload, /desktopUpdates/);
  assert.match(desktopMain, /app-update:download-install/);
  assert.match(desktopMain, /createHash\("sha256"\)/);
  assert.match(desktopMain, /checksum did not match/);
  assert.match(androidManifest, /REQUEST_INSTALL_PACKAGES/);
  assert.match(androidManifest, /\.UpdateFileProvider/);
  assert.match(androidActivity, /class AndroidUpdates/);
  assert.match(androidActivity, /MessageDigest\.getInstance\("SHA-256"\)/);
  assert.match(androidActivity, /canRequestPackageInstalls\(\)/);
  assert.match(androidProvider, /MODE_READ_ONLY/);
  assert.match(builder, /public-release\.json/);
});

test("custom theme uses persisted semantic color channels on both runtimes", () => {
  for (const root of ["ui", "mobile/ui"]) {
    const index = read(`${root}/index.html`);
    const app = read(`${root}/engine-app.js`);
    const bootstrap = read(`${root}/bootstrap-app.js`);
    const styles = read(`${root}/styles.css`);

    assert.match(index, /id="customTheme"[^>]*>Custom<\/button>/);
    for (const channel of ["Canvas", "Surface", "Raised", "Text", "Accent"]) {
      assert.match(app, new RegExp(`${channel.toLowerCase()}: \\\"#[0-9a-f]{6}\\\"`, "i"));
      assert.match(styles, new RegExp(`--custom-${channel.toLowerCase()}`));
    }
    assert.match(app, /engineCustomThemeV1/);
    assert.match(app, /function readableTextColor/);
    assert.match(bootstrap, /activeTheme === "custom"|theme === "custom"/);
    assert.match(styles, /data-theme="dark"\]\[data-custom-theme="true"\]/);
    assert.match(styles, /\.segmentedControl button \{[\s\S]*?flex: 1 1 0;/);
  }
});

test("desktop roster navigation uses compact cards and guarded destructive actions", () => {
  const index = read("mobile/ui/index.html");
  const app = read("mobile/ui/engine-app.js");
  const styles = read("mobile/ui/styles.css");
  assert.match(index, /id="desktopPlayMode"[^>]*>Play Mode<\/button>/);
  assert.match(index, /id="headerFactionIcon"[^>]*assets\/factions\/unknown\.svg/);
  assert.match(index, /class="builderSettings" hidden/);
  assert.match(index, /id="backupDeleteRoster">Download JSON Backup<\/button>/);
  assert.match(index, /class="headerRosterSelect"/);
  assert.match(app, /role="button" tabindex="0" data-save-id=/);
  assert.doesNotMatch(app, /class="startLoadRoster"/);
  assert.match(app, /function formatSavedRosterEditedAgo/);
  assert.match(app, /savedRosterSortMode = "edited-desc"/);
  assert.match(app, /savedRosterGroupByFaction/);
  assert.match(app, /backupPendingRosterDelete/);
  assert.doesNotMatch(app, />Saved Rosters<|Load an existing roster or start a new one\./);
  assert.match(app, /headerFactionIcon\.src = `assets\/factions\/\$\{faction\.icon\}`/);
  assert.match(app, /pt limit · roster options/);
  assert.match(styles, /\.desktopPlayButton,[\s\S]*?background: #bd8426 !important/);
  assert.match(styles, /\.headerFileActions > div > button,[\s\S]*?min-height: 32px/);
  assert.match(styles, /\.headerFileActions \{[\s\S]*?grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/);
  assert.match(styles, /\.headerFactionMark \{[\s\S]*?grid-row: 2 \/ 5/);
  assert.match(styles, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(styles, /@media \(min-width: 1800px\)[\s\S]*?grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
});

test("every non-sheet export opens the shared text preview", () => {
  const index = read("mobile/ui/index.html");
  const app = read("mobile/ui/engine-app.js");
  const initStart = app.indexOf("async function init()");
  const initEnd = app.indexOf("\nfunction loadAvailableUnitsCollapsed", initStart);
  const init = app.slice(initStart, initEnd);

  assert.match(index, /<option value="json">JSON Backup<\/option>/);
  assert.match(init, /getElementById\("exportJson"\)[\s\S]*?openRosterExport\("json"\)/);
  assert.match(init, /getElementById\("openDiscordExport"\)[\s\S]*?openRosterExport\("discord-extended"\)/);
  assert.match(init, /querySelectorAll\("\.exportTextFormat"\)[\s\S]*?openRosterExport\(exportStyleForFormat/);
  assert.doesNotMatch(init, /exportRosterJson\(\)|exportRosterText\(/);
  assert.match(app, /style === "json" \? "Save \.json" : "Save \.txt"/);
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
