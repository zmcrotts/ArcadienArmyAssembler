"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync(require.resolve("../ui/play-mode.js"), "utf8");
const CatalogueSections = require("../ui/catalogue-sections");
const plain = value => JSON.parse(JSON.stringify(value));

function harness(roster) {
  const controls = Object.fromEntries(["[data-stratagem-search]", "[data-stratagem-results]", "[data-expand-stratagems]", "[data-collapse-stratagems]"]
    .map(key => [key, { innerHTML: "" }]));
  const cards = [{ open: false }, { open: false }];
  const content = { innerHTML: "", querySelector: key => controls[key], querySelectorAll: () => cards };
  const context = { window: { CatalogueSections }, structuredClone,
    document: { getElementById: id => id === "playModeContent" ? content : null, addEventListener() {} } };
  const injection = `window.testApi = { set: value => session = value, groups: playRosterGroups,
    sections: stratagemReferenceSections, review: renderStratagemReview, eligible: eligibleStratagems };`;
  vm.runInNewContext(source.replace("  window.ArcadienPlayMode =", injection + "\n  window.ArcadienPlayMode ="), context);
  const session = { roster, phase: "Command", turn: "you", round: 1, status: "active", cp: { you: 3 }, stratagemUses: [], modelState: {} };
  context.window.testApi.set(session);
  return { api: context.window.testApi, session, controls, cards, content, context };
}

test("full stratagem review includes both turns, every phase, and every selected detachment", () => {
  const { api, session, controls, content, cards } = harness({
    coreStratagems: [{ id: "core", name: "Core defence", cpCost: "2", phase: "Fight", turn: "Opponent's turn", description: "WHEN: Fight phase TARGET: Infantry EFFECT: Gain cover." }],
    detachments: [
      { name: "First detachment", stratagems: [{ id: "first", name: "Tank fire", cpCost: "1", phase: "Shooting", turn: "Your turn", description: "WHEN: Shooting phase TARGET: A Vehicle EFFECT: Fire twice." }] },
      { name: "Second detachment", stratagems: [{ id: "second", name: "Rapid move", cpCost: "1", when: "Movement phase", targetText: "Mounted units", effect: "Advance further." }] }
    ]
  });
  const before = JSON.stringify(session);
  api.review();
  const html = controls["[data-stratagem-results]"].innerHTML;
  for (const name of ["Core defence", "Tank fire", "Rapid move", "First detachment", "Second detachment"]) assert.ok(html.includes(name), name);
  assert.match(html, /3 of 3 stratagems/);
  assert.match(html, /<b>WHEN<\/b>/);
  assert.match(html, /Mounted units/);
  assert.match(html, /2 CP/);
  assert.doesNotMatch(html, /data-use-stratagem|data-paid-cost/);
  controls["[data-expand-stratagems]"].onclick(); assert.ok(cards.every(card => card.open));
  controls["[data-collapse-stratagems]"].onclick(); assert.ok(cards.every(card => !card.open));
  const originalShell = content.innerHTML;
  controls["[data-stratagem-search]"].oninput({ target: { value: "mounted" } });
  assert.match(controls["[data-stratagem-results]"].innerHTML, /1 of 3 stratagems/);
  assert.doesNotMatch(controls["[data-stratagem-results]"].innerHTML, /Tank fire/);
  assert.equal(content.innerHTML, originalShell, "typing leaves the search input in place");
  controls["[data-stratagem-search]"].oninput({ target: { value: "no match" } });
  assert.match(controls["[data-stratagem-results]"].innerHTML, /No stratagems match/);
  controls["[data-stratagem-search]"].oninput({ target: { value: "" } });
  assert.match(controls["[data-stratagem-results]"].innerHTML, /3 of 3/);
  assert.equal(JSON.stringify(session), before, "review never spends CP or changes the game");
});

test("stratagem review supports legacy single-detachment saves, duplicate records, and empty rosters", () => {
  const item = { id: "one", name: "Legacy stratagem", description: "Rule text" };
  const { api } = harness({ detachments: [], detachment: { name: "Legacy", stratagems: [item, item] } });
  assert.equal(api.sections()[0].items.length, 1);
  const empty = harness({}); empty.api.review();
  assert.match(empty.controls["[data-stratagem-results]"].innerHTML, /No stratagem rules/);
});

const entry = (instanceId, name, keywords, roles = {}) => ({ instanceId, name, keywords, roles, points: 50 });
test("Play Mode orders combined units first, then roster categories, with alphabetical names", () => {
  const roster = { rosterEntries: [
    entry("v2", "Voidweaver", ["Vehicle"]), entry("z", "Zeta Infantry", ["Infantry"]),
    entry("solo", "Captain", ["Infantry", "Character"], { character: true }),
    entry("epic", "Epic Leader", ["Infantry", "Character", "Epic Hero"], { character: true, epicHero: true }),
    entry("b", "Battleline Squad", ["Infantry", "Battleline"], { battleline: true }),
    entry("a", "Alpha Infantry", ["Infantry"]), entry("v1", "Voidweaver", ["Vehicle"]),
    entry("body", "Bodyguards", ["Infantry"]), entry("leader", "Captain", ["Character"], { character: true }),
    entry("transport", "Transport", ["Vehicle", "Dedicated Transport"], { dedicatedTransport: true })
  ], armyState: { attachments: [{ leaderInstanceId: "leader", targetInstanceId: "body" }] } };
  const { api, session, context } = harness(roster);
  const before = JSON.stringify(session);
  const groups = plain(api.groups());
  assert.deepEqual(groups.map(group => group.title), ["Bodyguards + Captain #2", "Epic Leader", "Captain #1", "Battleline Squad", "Alpha Infantry", "Zeta Infantry", "Voidweaver #1", "Voidweaver #2", "Transport"]);
  assert.deepEqual(groups.map(group => group.playCategory), ["Combined Units", "Epic Hero", "Character", "Battleline", "Infantry", "Infantry", "Vehicle", "Vehicle", "Dedicated Transport"]);
  assert.deepEqual(groups.filter(g => g.title.startsWith("Voidweaver")).map(g => g.memberInstanceIds[0]), ["v2", "v1"]);
  assert.equal(JSON.stringify(session), before, "ordering and labels never mutate saved entries or IDs");
  session.modelState.v2 = { wounds: 0 };
  assert.deepEqual(plain(api.groups()).map(g => g.title), groups.map(g => g.title), "destroying a model never renumbers units");
  context.window.ArmyEngine = { eligibleStratagemsForEntry: (army, state, unit) => {
    assert.equal(unit.name, "Voidweaver", "target matching uses the original name"); return [];
  } };
  api.eligible(api.groups().find(g => g.memberInstanceIds[0] === "v2"));
});

test("legacy groups retain their IDs and points while receiving the same ordering and labels", () => {
  const { api } = harness({ groupedPresentation: ["two", "one"].map(id => ({ id, kind: "unit", title: "Voidweaver", totalPoints: 75,
    memberInstanceIds: [id], members: [entry(id, "Voidweaver", ["Vehicle"])] })) });
  assert.deepEqual(plain(api.groups()).map(g => [g.id, g.title, g.totalPoints]), [["two", "Voidweaver #1", 75], ["one", "Voidweaver #2", 75]]);
});
