"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const core = require("../data/manual-rules/wh40k-11e-core-stratagems.json");
const systemRules = require("../data/rulesets/wh40k-11e-vflam/Warhammer 40,000.json").gameSystem.sharedRules;

for (const file of ["ui/engine-app.js", "mobile/ui/engine-app.js"]) {
  test(`${file}: keyword aliases and qualified keywords remain linked`, () => {
    const source = fs.readFileSync(path.join(__dirname, "..", file), "utf8");
    const context = { rulePopupCounter: 0, escapeHtml: String, formatRichDescription: String };
    vm.createContext(context);
    vm.runInContext(source.slice(source.indexOf("function normalizeRuleLookupKey("), source.indexOf("function bindRulePopovers(")), context);
    const lookup = new Map([...systemRules, ...core.coreRules].map(rule => [context.normalizeRuleLookupKey(rule.name), rule]));
    for (const label of ["CLOSE QUARTERS", "TWIN LINKED", "TWIN-LINKED", "BLAST 1", "CLEAVE 2", "LETHAL HITS: non-MONSTER/VEHICLE"]) {
      assert.match(context.renderRuleToken(label, lookup, { compact: true }), /popovertarget=/, label);
    }
    const html = context.renderRuleToken("LETHAL HITS: non-MONSTER/VEHICLE", lookup);
    assert.match(html, /class="ruleQualifier">non-MONSTER\/VEHICLE/);
  });
  test(`${file}: a generic Leader profile cannot hide MFM attachment targets`, () => {
    const source = fs.readFileSync(path.join(__dirname, "..", file), "utf8");
    const context = { escapeHtml: String, formatDescription: String };
    vm.createContext(context);
    vm.runInContext(source.slice(source.indexOf("function renderAbilities("), source.indexOf("function renderTransportProfiles(")), context);
    const html = context.renderAbilities([{ name: "Leader", characteristics: { Description: "The unit gains Leader." } }], {
      roles: { leader: true, support: true }, rosterRules: { leaderTargetNames: ["BOYZ", "FLASH GITZ"] }
    });
    assert.match(html, /attached as Support/);
    assert.match(html, /BOYZ/);
    assert.match(html, /FLASH GITZ/);
    assert.doesNotMatch(html, /gains Leader/);
  });
}
test("keyword chip styles do not paint nested qualifier/popover spans", () => {
  const css = fs.readFileSync(path.join(__dirname, "../mobile/ui/styles.css"), "utf8");
  assert.doesNotMatch(css, /\.weaponKeywordChips\s+span\s*\{/);
  assert.match(css, /\.weaponKeywordChips > span:not\(\.ruleTokenWrap\)/);
});
