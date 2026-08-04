"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const projectRoot = path.resolve(root, "..");
const source = fs.readFileSync(path.join(root, "ui", "play-mode.js"), "utf8");
const engineSource = fs.readFileSync(path.join(root, "ui", "engine-app.js"), "utf8");
const desktopBuildSource = fs.readFileSync(path.join(projectRoot, "scripts", "build-user-runtime.js"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(projectRoot, "ui", "assets", "11th", "secondary-missions", "manifest.json"), "utf8"));

test("Play Mode contains every Chapter Approved secondary card", () => {
  assert.equal(manifest.cards.length, 18);
  for (const card of manifest.cards) {
    assert.match(source, new RegExp(`card\\(\\"${card.cardSlug}\\"`));
    assert.equal(fs.existsSync(path.join(projectRoot, "ui", card.image)), true, `${card.title} image exists`);
  }
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
  assert.match(source, /schemaVersion: 3/);
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

test("army rows show defensive stats and profile-aware wound references", () => {
  const css = fs.readFileSync(path.join(root, "ui", "styles.css"), "utf8");
  assert.match(source, /function groupDefenseProfiles\(group\)/);
  assert.match(source, /\["M", "Move", "Movement"\]/);
  assert.match(source, /\["T", "Toughness"\]/);
  assert.match(source, /\["SV", "Save"\]/);
  assert.match(source, /\["InSv", "Invulnerable Save"/);
  assert.match(source, /function groupWoundSummary\(group, models = groupModels\(group\)\)/);
  assert.match(source, /models\[0\]\.current.*models\[0\]\.max/);
  assert.match(source, /playArmyWounds/);
  assert.match(css, /\.playArmyStats\{display:grid!important/);
  assert.match(css, /@media\(max-width:700px\).*\.playArmyReference\{grid-column:1\/-1\}/);
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

test("final scorecards rely on screenshots without dead Save or Share actions", () => {
  assert.doesNotMatch(source, /data-save-card/);
  assert.doesNotMatch(source, /data-share-card/);
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
