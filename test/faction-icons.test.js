"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");

function factionIconMap(relativeSource) {
  const source = fs.readFileSync(path.join(ROOT, relativeSource), "utf8");
  const match = source.match(/const SAVED_ROSTER_FACTION_ICONS = Object\.freeze\(\{([\s\S]*?)\n\}\);/);
  assert.ok(match, `${relativeSource} should declare its saved-roster faction icons`);
  return JSON.parse(`{${match[1]}}`);
}

test("saved-roster faction symbols cover every playable faction and chapter", () => {
  global.window = {};
  require("../ui/engine-data-manifest");

  const desktopIcons = factionIconMap("ui/engine-app.js");
  const mobileIcons = factionIconMap("mobile/ui/engine-app.js");
  assert.deepEqual(mobileIcons, desktopIcons);

  const playableIds = window.ROSTER_ENGINE_DATA.factionNavigation.flatMap(group =>
    group.factions.flatMap(faction => faction.modes?.length
      ? faction.modes.map(mode => mode.id)
      : [faction.id])
  );

  for (const factionId of playableIds) {
    assert.ok(desktopIcons[factionId], `Missing saved-roster symbol mapping for ${factionId}`);
    assert.ok(
      fs.existsSync(path.join(ROOT, "ui", "assets", "factions", desktopIcons[factionId])),
      `Missing saved-roster symbol asset for ${factionId}`
    );
  }

  assert.ok(fs.existsSync(path.join(ROOT, "ui", "assets", "factions", "unknown.svg")));
  assert.ok(fs.existsSync(path.join(ROOT, "ui", "assets", "factions", "ATTRIBUTION.md")));
  assert.ok(fs.existsSync(path.join(ROOT, "ui", "assets", "factions", "LICENSE_CC_BY_NC_SA_V4_0.md")));
});

test("saved-roster cards prefer a chapter-level subfaction label", () => {
  for (const relativeSource of ["ui/engine-app.js", "mobile/ui/engine-app.js"]) {
    const source = fs.readFileSync(path.join(ROOT, relativeSource), "utf8");
    assert.match(source, /record\?\.document\?\.subfaction \|\| record\?\.document\?\.faction/);
    assert.match(source, /savedRosterMetadata\(save\.document \|\| \{\}, faction\)/);
    assert.match(source, /class="savedRosterFactionMark"/);
  }
});
