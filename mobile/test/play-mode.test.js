"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const projectRoot = path.resolve(root, "..");
const source = fs.readFileSync(path.join(root, "ui", "play-mode.js"), "utf8");
const styles = fs.readFileSync(path.join(root, "ui", "styles.css"), "utf8");
const engineSource = fs.readFileSync(path.join(root, "ui", "engine-app.js"), "utf8");
const desktopBuildSource = fs.readFileSync(path.join(projectRoot, "scripts", "build-user-runtime.js"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(projectRoot, "ui", "assets", "11th", "secondary-missions", "manifest.json"), "utf8"));
const terrainManifest = JSON.parse(fs.readFileSync(path.join(projectRoot, "ui", "assets", "11th", "terrain-layouts", "manifest.json"), "utf8"));
const armyDefinitions = fs.readFileSync(path.join(projectRoot, "src", "bsdata", "army-definitions.js"), "utf8");

test("Play Mode contains every Chapter Approved secondary card", () => {
  assert.equal(manifest.cards.length, 18);
  for (const card of manifest.cards) {
    assert.match(source, new RegExp(`card\\(\\"${card.cardSlug}\\"`));
    assert.equal(fs.existsSync(path.join(projectRoot, "ui", card.image)), true, `${card.title} image exists`);
  }
});

test("Play Mode packages all 45 disposition-paired terrain layouts", () => {
  assert.equal(terrainManifest.schemaVersion, 1);
  assert.deepEqual(terrainManifest.sourcePageRange, { first: 9, last: 53 });
  assert.deepEqual(terrainManifest.imageEncoding, { format: "webp", quality: 85, method: 6 });
  assert.equal(terrainManifest.layouts.length, 45);
  const pairings = new Map();
  for (const layout of terrainManifest.layouts) {
    const pairing = `${layout.redDisposition.slug}|${layout.blueDisposition.slug}`;
    if (!pairings.has(pairing)) pairings.set(pairing, []);
    pairings.get(pairing).push(layout.option);
    const image = path.join(projectRoot, "ui", layout.image);
    assert.equal(path.extname(image), ".webp");
    assert.equal(fs.existsSync(image), true, `${layout.id} image exists`);
    assert.equal(layout.width, 1641);
    assert.equal(layout.height, 1966);
    assert.equal(crypto.createHash("sha256").update(fs.readFileSync(image)).digest("hex"), layout.sha256);
    assert.equal(armyDefinitions.includes(`name: "${layout.redDisposition.mission}"`), true, `${layout.redDisposition.mission} is an app mission`);
    assert.equal(armyDefinitions.includes(`name: "${layout.blueDisposition.mission}"`), true, `${layout.blueDisposition.mission} is an app mission`);
  }
  assert.equal(pairings.size, 15);
  for (const options of pairings.values()) assert.deepEqual(options.sort(), ["A", "B", "C"]);
});

test("Start Game requires a terrain choice before entering the Play Mode menu", () => {
  const html = fs.readFileSync(path.join(root, "ui", "index.html"), "utf8");
  assert.match(html, /terrain-layouts\/manifest\.js/);
  assert.ok(html.indexOf("terrain-layouts/manifest.js") < html.indexOf("play-mode.js"));
  assert.match(source, />Start Game<\/button>/);
  assert.match(source, /function openLayoutPicker\(rosterId, roster\)/);
  assert.match(source, /data-confirm-layout disabled/);
  assert.match(source, /session\.setup\.terrainLayout = \{/);
  assert.match(source, /persist\(\);\s*closeModal\(\);\s*showShell\(\);/);
  assert.match(source, /data-view-layout/);
  assert.match(source, /function openSelectedTerrainLayout\(\)/);
  assert.match(source, /modal\.querySelector\("\.playSetupPanel, \.playLayoutPanel"\)/);
});

test("terrain layouts expand and shrink with a double tap", () => {
  assert.match(source, /function bindDoubleTap\(target, handler\)/);
  assert.match(source, /function openLayoutFullscreen\(layout, picker\)/);
  assert.match(source, /data-layout-fullscreen-image/);
  assert.match(source, /Double-tap the map to shrink/);
  assert.match(source, /bindDoubleTap\(viewer\.querySelector\("\[data-layout-fullscreen-image\]"\), closeFullscreen\)/);
  assert.match(source, /event\.key !== "Escape"/);
  assert.match(styles, /\.playLayoutFullscreen\{grid-template-rows:auto minmax\(0,1fr\);grid-template-columns:minmax\(0,1fr\)/);
  assert.match(styles, /\.playLayoutFullscreenBar\{position:relative;top:auto;left:auto;right:auto/);
  assert.match(styles, /\.playLayoutFullscreen>img\{grid-row:2;width:100%;height:100%;max-width:100vw;max-height:100vh;min-width:0;min-height:0\}/);
});

test("Windows packaging uses the Play Mode UI", () => {
  assert.match(desktopBuildSource, /path\.join\(ROOT, "mobile", "ui", "index\.html"\)/);
  assert.match(desktopBuildSource, /mobile\/ui\/play-mode\.js/);
  assert.match(desktopBuildSource, /mobile\/ui\/engine-app\.js/);
  assert.match(desktopBuildSource, /mobile\/ui\/styles\.css/);
});

test("Play Mode enforces round category caps and persists one active session per roster", () => {
  assert.match(source, /Math\.min\(amount, Math\.max\(0, 15 - current\)\)/);
  assert.match(source, /overflow VP discarded/);
  assert.match(source, /all\[session\.rosterId\] = session/);
  assert.match(source, /delete all\[session\.rosterId\]/);
});

test("Play Mode starts both players at 1 CP without awarding the first Command phase", () => {
  assert.match(source, /schemaVersion: 5/);
  assert.match(source, /cp: \{ you: 1, opponent: 1 \}/);
  assert.match(source, /cpAwarded: \[`1:\$\{setup\.firstTurn/);
  assert.doesNotMatch(source, /session\.setup\.opponentPrimary = opponentMission;\s*awardCommandCp\(\)/);
  assert.match(source, /untouchedLegacyOpening/);
  assert.match(source, /session\.cp = \{ you: 1, opponent: 1 \}/);
});

test("Tactical scoring discards the mission and displays VP confirmation", () => {
  assert.match(source, /category === "secondary" && options\.cardId && session\.decks\[player\]\?\.mode !== "fixed"/);
  assert.match(source, /deck\.hand = deck\.hand\.filter\(id => id !== options\.cardId\)/);
  assert.match(source, /showScoreFeedback\(player, source, amount/);
  assert.match(source, /Scored and discarded/);
});

test("Fixed mode is limited to the four Fixed-eligible cards and keeps them active", () => {
  for (const id of ["a-grievous-blow", "assassination", "bring-it-down", "engage-on-all-fronts"]) {
    assert.match(source, new RegExp(`card\\(\\"${id}\\"[^\\n]+\\[[^\\]]+\\]\\)`));
  }
  assert.match(source, /FIXED_CARDS = CARDS\.filter\(item => item\.fixedScores\.length\)/);
  assert.match(source, /Selected missions remain active after scoring/);
  assert.match(source, /session\.decks\[player\]\?\.mode === "fixed"/);
});

test("implicit single-model units remain alive and damage-trackable in Play Mode", () => {
  assert.match(source, /function trackingModels\(entry\)/);
  assert.match(source, /entry\.unitSize\?\.current \|\| 1/);
  assert.match(source, /id: "implicit-model"/);
  assert.match(source, /for \(const model of trackingModels\(member\)\)/);
  assert.match(source, /entry\.configured\?\.weapons/);
});

test("mixed-profile squads track wounds per model and reduce weapon bearer counts", () => {
  assert.match(source, /function modelWounds\(entry, model = null\)/);
  assert.match(source, /profileMatchScore\(b, modelName\) - profileMatchScore\(a, modelName\)/);
  assert.match(source, /Math\.min\(max, Number\(session\.modelState\[id\] \?\? max\)\)/);
  assert.match(source, /originalCount \* livingBearers \/ bearers\.length/);
  assert.match(source, /originalCount - displayedCount/);
});

test("wound changes preserve the open unit panel scroll position", () => {
  assert.match(source, /const previousPanel = selectedGroupId === groupId \? modal\.querySelector\("\.playUnitPanel"\) : null/);
  assert.match(source, /const previousScrollTop = previousPanel\?\.scrollTop \|\| 0/);
  assert.match(source, /modal\.querySelector\("\.playUnitPanel"\)\.scrollTop = previousScrollTop/);
});

test("army rows show defensive stats and profile-aware wound references", () => {
  const css = fs.readFileSync(path.join(root, "ui", "styles.css"), "utf8");
  assert.match(source, /function groupDefenseProfiles\(group\)/);
  assert.match(source, /\["M", "Move", "Movement"\]/);
  assert.match(source, /\["T", "Toughness"\]/);
  assert.match(source, /\["SV", "Save"\]/);
  assert.match(source, /\["OC", "Objective Control", "Objective control"\]/);
  assert.match(source, /\["InSv", "Invulnerable Save"/);
  assert.match(source, /function groupWoundSummary\(group, models = groupModels\(group\)\)/);
  assert.match(source, /models\[0\]\.current.*models\[0\]\.max/);
  assert.match(source, /playArmyWounds/);
  assert.match(source, /<small>OC<\/small>/);
  assert.match(css, /\.playArmyStats\{display:grid!important/);
  assert.match(css, /@media\(max-width:700px\).*\.playArmyReference\{grid-column:1\/-1\}/);
});

test("Play Mode persists five round-scoped full-state Undo actions", () => {
  const html = fs.readFileSync(path.join(root, "ui", "index.html"), "utf8");
  assert.match(html, /id="playModeUndo"[^>]*disabled>Undo<\/button>/);
  assert.match(source, /const MAX_UNDO_ACTIONS = 5/);
  assert.match(source, /session\.undoHistory = session\.undoHistory\.slice\(-MAX_UNDO_ACTIONS\)/);
  assert.match(source, /Number\(item\.round\) === round/);
  assert.match(source, /function undoStateSnapshot\(\)/);
  assert.match(source, /function undoLastAction\(\)/);
  assert.match(source, /undoButton\.textContent = "Undo"/);
  assert.doesNotMatch(source, /undoButton\.textContent = session\.undoHistory\.length/);
  for (const field of ["cp", "ledger", "decks", "modelState", "battleShockedGroups", "abilityUses", "stratagemUses"]) {
    assert.match(source, new RegExp(`UNDO_FIELDS = \\[.*\\"${field}\\"`));
  }
  for (const action of ["Advance phase", "Draw secondary", "Score primary", "Toggle model wounds"]) {
    assert.match(source, new RegExp(`recordUndo\\(\\\"${action}`));
  }
});

test("army summary wound controls are limited to multi-wound single-model listings", () => {
  const css = fs.readFileSync(path.join(root, "ui", "styles.css"), "utf8");
  assert.match(source, /models\.length === 1 && models\[0\]\.max > 1/);
  assert.match(source, /data-summary-model-delta/);
  assert.match(source, /data-summary-model-toggle/);
  assert.match(source, /changeModelWounds\([^\n]+\{ groupId: button\.dataset\.summaryGroup, summary: true \}\)/);
  assert.match(css, /\.playArmyQuickWounds\{display:grid/);
});

test("Half-strength states use model counts for units and wounds for single models", () => {
  const start = source.indexOf("function strengthStateForModels(models)");
  const end = source.indexOf("\n  function groupDefenseProfiles", start);
  assert.ok(start >= 0 && end > start);
  const strengthStateForModels = new Function(`${source.slice(start, end)}; return strengthStateForModels;`)();
  const unit = (total, alive) => Array.from({ length: total }, (_, index) => ({ current: index < alive ? 1 : 0, max: 1 }));
  assert.equal(strengthStateForModels(unit(14, 8)), "normal");
  assert.equal(strengthStateForModels(unit(14, 7)), "halfStrength");
  assert.equal(strengthStateForModels(unit(15, 8)), "normal");
  assert.equal(strengthStateForModels(unit(15, 7)), "halfStrength");
  assert.equal(strengthStateForModels([{ current: 6, max: 10 }]), "normal");
  assert.equal(strengthStateForModels([{ current: 5, max: 10 }]), "halfStrength");
  assert.equal(strengthStateForModels([{ current: 0, max: 10 }]), "destroyed");
});

test("your Command phase shows a non-blocking Battle-shock reminder for Half-strength units", () => {
  const css = fs.readFileSync(path.join(root, "ui", "styles.css"), "utf8");
  assert.match(source, /function renderBattleShockReminder\(\)/);
  assert.match(source, /session\.turn !== "you" \|\| session\.phase !== "Command"/);
  assert.match(source, /groupStrengthState\(group\) === "halfStrength"/);
  assert.match(source, /BATTLE-SHOCK STEP/);
  assert.match(source, /AT OR BELOW HALF STRENGTH/);
  assert.match(css, /\.playArmyUnit\.halfStrength\{border-color:#d8972f/);
  assert.match(css, /\.playBattleShockReminder\{display:grid/);
});

test("Battleshocked toggles persist, mark Army rows, and block unit Stratagems", () => {
  const css = fs.readFileSync(path.join(root, "ui", "styles.css"), "utf8");
  assert.match(source, /battleShockedGroups: \{\}/);
  assert.match(source, /session\.battleShockedGroups \|\|= \{\}/);
  assert.match(source, /function toggleBattleShock\(groupId\)/);
  assert.match(source, /data-battleshock-toggle/);
  assert.match(source, /aria-pressed="\$\{battleShocked\}"/);
  assert.match(source, /aria-label="\$\{battleShocked \? "Clear Battleshocked" : "Mark Battleshocked"\}"/);
  assert.match(source, /battleShocked \? `<b>BATTLESHOCKED<\/b>` : ""/);
  assert.match(source, /Unavailable while Battleshocked/);
  assert.match(source, /if \(isGroupBattleShocked\(group\.id\) \|\| stratagemUsedThisPhase/);
  assert.match(css, /\.playArmyUnit\.battleShocked::after\{content:""/);
  assert.match(css, /\.playBattleShockToggle:not\(\.active\)\{width:38px/);
  assert.match(css, /\.playBattleShockToggle\.active\{/);
  assert.match(css, /\.playStratagemBlockedFlag\{display:flex/);
});

test("opened units show full model statlines without leaving the Army view", () => {
  const css = fs.readFileSync(path.join(root, "ui", "styles.css"), "utf8");
  assert.match(source, /function renderUnitStatlines\(group\)/);
  assert.match(source, /Full statline/);
  for (const label of ["M", "T", "SV", "W", "LD", "OC", "INV"]) assert.match(source, new RegExp(`<span>${label}<\\/span>`));
  assert.match(css, /\.playUnitStatlineTable\{min-width:600px/);
});

test("Play Mode rebuilds complete attached-unit groups from roster entries", () => {
  assert.match(source, /function playRosterGroups\(\)/);
  assert.match(source, /const entries = roster\.rosterEntries \|\| \[\]/);
  assert.match(source, /roster\.armyState\?\.attachments/);
  assert.match(source, /leaderInstanceId/);
  assert.match(source, /targetInstanceId/);
  assert.match(source, /for \(const entry of entries\)/);
  assert.match(source, /members: \[entry\]/);
  assert.match(source, /const groups = playRosterGroups\(\)/);
});

test("using a stratagem spends CP once per unit and phase with visual confirmation", () => {
  assert.match(source, /session\.stratagemUses \|\|= \[\]/);
  assert.match(source, /session\.cp\.you -= cost/);
  assert.match(source, /amount: -cost/);
  assert.match(source, /Used this phase ✓/);
  assert.match(source, /showStratagemFeedback\(group, item, cost, printedCost\)/);
  assert.match(source, /data-paid-cost="\$\{discountedCost\}"/);
  assert.match(source, /Use for \$\{cost\} CP/);
  assert.match(source, /Use reduced for \$\{discountedCost\} CP/);
  assert.match(source, /playStratagemUsedFlag/);
  assert.doesNotMatch(source, /Discount spent ✓/);
  assert.match(source, /discount: printedCost - cost/);
});

test("unit rules are expandable and limited-use abilities can be used and restored", () => {
  const css = fs.readFileSync(path.join(root, "ui", "styles.css"), "utf8");
  assert.match(source, /session\.abilityUses \|\|= \[\]/);
  assert.match(source, /function unitRules\(group\)/);
  assert.match(source, /Rules & abilities/);
  assert.match(source, /function abilityTracker\(name, description\)/);
  assert.match(source, /once per battle round\|once per round/);
  assert.match(source, /twice per \(\?:battle\|game\)/);
  assert.match(source, /data-use-ability/);
  assert.match(source, /data-restore-ability/);
  assert.match(css, /\.playUnitRule\{border:/);
  assert.match(css, /\.playAbilityActions\{display:grid/);
});

test("battle scoring keeps Primary and Secondary stacked inside each player column", () => {
  const css = fs.readFileSync(path.join(root, "ui", "styles.css"), "utf8");
  assert.match(source, /playRoundCapPlayer \$\{player\}/);
  assert.match(source, /<b>Primary<\/b><strong>/);
  assert.match(source, /<b>Secondary<\/b><strong>/);
  assert.match(css, /\.playRoundCaps\{grid-template-columns:1fr 1fr/);
  assert.match(css, /\.playRoundCaps span\{grid-template-columns:1fr/);
});

test("game setup captures both player names and factions for crest-bearing scorecards", () => {
  assert.match(source, /name="yourName"/);
  assert.match(source, /name="opponentName"/);
  assert.match(source, /name="yourFaction"/);
  assert.match(source, /name="opponentFaction"/);
  assert.match(source, /drawFactionBadge\(ctx, yourIcon/);
  assert.match(source, /drawFactionBadge\(ctx, opponentIcon/);
  assert.match(source, /assets\/factions\/\$\{factionRecord/);
});

test("final scorecards can save the scorecard-only PNG to the gallery", () => {
  assert.match(source, /data-save-gallery/);
  assert.match(source, /function saveScorecardToGallery\(canvas\)/);
  assert.match(source, /canvas\.toBlob/);
  assert.match(source, /navigator\.share\(\{ files: \[file\]/);
  assert.match(source, /choose Save Image in the share sheet/i);
  assert.match(source, /link\.download = fileName/);
  assert.match(source, /data-return-lists/);
});

test("saved roster cards omit Last Score and new games always open on Battle", () => {
  assert.doesNotMatch(engineSource, /Last Score|startResultRoster/);
  assert.match(source, /currentView = "battle";\s*session = createSession/);
});

test("game setup keeps both player columns aligned without an orphan detachment field", () => {
  const css = fs.readFileSync(path.join(root, "ui", "styles.css"), "utf8");
  assert.doesNotMatch(source, /Opponent detachment|name="opponentDetachment"/);
  const yourSecondaries = source.indexOf('name="yourMissionMode"');
  const opponentSecondaries = source.indexOf('name="opponentMissionMode"');
  assert.ok(yourSecondaries > -1);
  assert.ok(opponentSecondaries > yourSecondaries);
  assert.match(source, /class="playSetupYou">Your secondaries/);
  assert.match(source, /class="playSetupOpponent">Opponent secondaries/);
  assert.match(css, /\.playSetupYou\{grid-column:1\}\.playSetupOpponent\{grid-column:2\}/);
});

test("completed scorecards remain available in an edition-long Games tab", () => {
  assert.match(source, /function listResults\(\)/);
  assert.match(source, /function openResult\(id\)/);
  assert.match(source, /function deleteResult\(id\)/);
  assert.match(source, /results\.unshift\(finalResult\)/);
  assert.doesNotMatch(source, /results\.slice\(0, 50\)/);
  assert.match(source, /crypto\.subtle\.digest\("SHA-256"/);
  assert.match(source, /const TOMBSTONE_KEY = "arcadienPlayModeResultTombstonesV1"/);
  assert.match(source, /function exportSyncState\(\)/);
  assert.match(source, /function importSyncState\(value = \{\}\)/);
  assert.match(engineSource, /id="startManageSync"/);
  assert.match(engineSource, /function rosterSyncTombstones\(\)/);
  assert.match(engineSource, /function openSyncDataManager\(\)/);
  assert.match(source, /session\.status === "final" \? "" : `<button data-undo-score/);
  assert.match(engineSource, /id="showGamesTab"/);
  assert.match(engineSource, /function renderGameHistory\(games\)/);
  assert.match(engineSource, /data-delete-result/);
  assert.doesNotMatch(engineSource, /data-open-result/);
  assert.match(source, /openedFromHistory && shell\.hidden/);
  assert.match(source, /function reviewHistoryGame\(\)/);
});

test("the opponent secondary hand always uses its own red tint", () => {
  const css = fs.readFileSync(path.join(root, "ui", "styles.css"), "utf8");
  assert.match(source, /content\.classList\.toggle\("playOpponentHand", currentView === "missions" && missionPlayer === "opponent"\)/);
  assert.match(css, /\.playModeContent\.playOpponentHand\{background:radial-gradient\([^}]+#492d32[^}]+#1a1014/);
  assert.match(css, /\.playOpponentHand \.playPlayerTabs button\.active\{background:#67343b!important\}/);
});

test("Primary scoring stages card taps, flips one card, and confirms or cancels at View-card size", () => {
  const css = fs.readFileSync(path.join(root, "ui", "styles.css"), "utf8");
  assert.match(source, /function openPrimaryScoreModal\(player\)/);
  assert.match(source, /mission\?\.cardImages\?\.front/);
  assert.match(source, /PRIMARY_SCORE_HOTSPOTS/);
  assert.match(source, /playPrimaryScoreHotspot/);
  assert.match(source, /scoreOptionId/);
  assert.match(source, /function commitPrimaryScoreEdits\(player, source, pending\)/);
  assert.match(source, /data-confirm-primary/);
  assert.match(source, /data-flip-card/);
  assert.match(source, /Flip to back/);
  assert.match(source, /Close cancels\. Score confirms\./);
  assert.doesNotMatch(source, /playPrimaryCardBack/);
  assert.match(source, /Return to Lists/);
  assert.match(source, /function returnToListsAfterGame\(\)/);
  assert.match(css, /\.playCpControl\{grid-template-columns:46px auto 46px/);
  assert.match(css, /\.playPrimaryCardScorer/);
  assert.match(css, /\.playPrimaryCardScorer\{width:min\(100%,544px\)\}/);
  assert.match(css, /\.playPrimaryFlip\{[^}]*top:auto!important;right:0!important;bottom:0/);
  assert.match(css, /\.playPrimaryFlip:hover,\.playPrimaryFlip:focus-visible/);
  assert.match(css, /\.playPrimaryCardScorer\.showingBack \.playPrimaryScoreHotspot\{display:none\}/);
});

test("every primary mission name resolves to a scoring hotspot entry", () => {
  const hotspotBlock = source.slice(source.indexOf("const PRIMARY_SCORE_HOTSPOTS"), source.indexOf("const cardById"));
  const hotspotKeys = new Set([...hotspotBlock.matchAll(/^\s+"([^"]+)":/gm)].map(match => match[1]));
  const missionBlock = armyDefinitions.slice(armyDefinitions.indexOf("const FORCE_DISPOSITION_MISSION_MAP"), armyDefinitions.indexOf("function missionSlug"));
  const missionNames = [...missionBlock.matchAll(/\{ name: "([^"]+)"/g)].map(match => match[1]);
  const scoringKey = name => name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, "-");
  assert.equal(missionNames.length, 25);
  assert.deepEqual(missionNames.filter(name => !hotspotKeys.has(scoringKey(name))), []);
  assert.equal(hotspotKeys.has("destroyer-s-wrath"), true);
});

test("stratagem WHEN TARGET and EFFECT sections always render as separate blocks", () => {
  const css = fs.readFileSync(path.join(root, "ui", "styles.css"), "utf8");
  assert.match(source, /function formatStratagemDescription\(description\)/);
  assert.match(source, /\(WHEN\|TARGET\|EFFECT\)/);
  assert.match(source, /<section><b>/);
  assert.match(css, /\.playStratagemText section\{display:grid/);
});

test("Play Mode loads before the roster UI so active and completed match actions render", () => {
  const html = fs.readFileSync(path.join(root, "ui", "index.html"), "utf8");
  assert.ok(html.indexOf("play-mode.js") < html.indexOf("engine-app.js"));
  assert.match(html, /id="mobilePlayMode"/);
});

test("mobile battle controls fit narrow screens and weapons are split by range", () => {
  const css = fs.readFileSync(path.join(root, "ui", "styles.css"), "utf8");
  assert.match(css, /\.playModeShell\{position:fixed;inset:0;z-index:4000;display:grid/);
  assert.match(css, /\.playModeHeader\{grid-template-columns:auto minmax\(0,1fr\) auto auto\}/);
  assert.match(source, /const rangedWeapons = weapons\.filter\(weapon => !isMeleeWeapon\(weapon\)\)/);
  assert.match(source, /const meleeWeapons = weapons\.filter\(isMeleeWeapon\)/);
  assert.match(source, /renderWeaponGroup\("Ranged Weapons"/);
  assert.match(source, /renderWeaponGroup\("Melee Weapons"/);
  assert.match(source, /return normalize\(range\) === "melee"/);
  assert.match(css, /\.playWeaponGroup\.ranged\{/);
  assert.match(css, /\.playWeaponGroup\.melee\{/);
  assert.match(css, /@media\(max-width:520px\)\{[\s\S]*?\.playCpControl\{box-sizing:border-box;grid-template-columns:36px minmax\(0,1fr\) 36px/);
  assert.match(css, /html\[data-native-shell="android"\] \.playModeHeader\{padding-top:12px\}/);
});
