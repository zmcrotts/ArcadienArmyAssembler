"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const installerSource = fs.readFileSync(path.join(__dirname, "..", "scripts", "build-local-installer.js"), "utf8");

test("Windows installer updates discovered installs in place", () => {
  assert.match(installerSource, /var existingInstall = FindExistingInstall\(\)/);
  assert.match(installerSource, /installButton\.Text = existingInstall != null \? "Update" : "Install"/);
  assert.match(installerSource, /Registry\.CurrentUser\.OpenSubKey\(RegistryKeyPath\)/);
  assert.match(installerSource, /foreach \(var shortcut in ExistingShortcutPaths\(\)\)/);
  assert.match(installerSource, /EnsureInstalledAppIsClosed\(installRoot\)/);
});

test("Windows in-place updates transact app files without replacing user data", () => {
  const transactionMatch = installerSource.match(/var transactionItems = AppItems\.Concat\(new\[\] \{([^}]+)\}\)\.ToArray\(\);/);
  assert.ok(transactionMatch, "Installer should explicitly define its transactional application payload");
  assert.doesNotMatch(transactionMatch[0], /user-data|rosters|exports/);
  assert.match(installerSource, /Directory\.CreateDirectory\(userDataFolder\)/);
  assert.match(installerSource, /Directory\.CreateDirectory\(rostersFolder\)/);
  assert.match(installerSource, /Directory\.CreateDirectory\(exportsFolder\)/);
  assert.match(installerSource, /foreach \(var item in backedUpItems\.AsEnumerable\(\)\.Reverse\(\)\) MovePath/);
});
