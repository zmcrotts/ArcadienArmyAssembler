"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

test("Electron test profiles isolate data, disable sync, and identify the window", () => {
  const main = fs.readFileSync(path.join(root, "electron", "main.js"), "utf8");
  assert.match(main, /--aaa-test-profile=/);
  assert.match(main, /\.test-env["'], TEST_PROFILE/);
  assert.match(main, /OneDrive sync is disabled in AAA test profiles/);
  assert.match(main, /available: false, connected: false/);
  assert.match(main, /query: TEST_PROFILE \? \{ aaaTestProfile: TEST_PROFILE \}/);
  assert.match(main, /test-roster-library\.json/);
});

test("the test launcher copies only Local Storage from the canonical production install", () => {
  const launcher = fs.readFileSync(path.join(root, "scripts", "launch-test-environment.ps1"), "utf8");
  assert.match(launcher, /G:\\AAA/);
  assert.match(launcher, /user-data\\Local Storage/);
  assert.doesNotMatch(launcher, /onedrive-sync-token/);
  assert.match(launcher, /-ne 'LOCK'/);
  assert.match(launcher, /--aaa-test-name-suffix=/);
});
