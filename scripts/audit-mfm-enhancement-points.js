"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { extractNormalizedRuleset } = require("../src/rulesets/sources");

const FACTIONS = {
  "adepta sororitas": "Imperium - Adepta Sororitas",
  "adeptus custodes": "Imperium - Adeptus Custodes",
  "adeptus mechanicus": "Imperium - Adeptus Mechanicus",
  aeldari: "Xenos - Aeldari",
  "astra militarum": "Imperium - Astra Militarum",
  "black templars": "Imperium - Adeptus Astartes - Black Templars",
  "blood angels": "Imperium - Adeptus Astartes - Blood Angels",
  "chaos daemons": "Chaos - Chaos Daemons",
  "chaos knights": "Chaos - Chaos Knights",
  "chaos space marines": "Chaos - Chaos Space Marines",
  "dark angels": "Imperium - Adeptus Astartes - Dark Angels",
  "death guard": "Chaos - Death Guard",
  deathwatch: "Imperium - Adeptus Astartes - Deathwatch",
  drukhari: "Xenos - Drukhari",
  "emperor s children": "Chaos - Emperor's Children",
  "genestealer cults": "Xenos - Genestealer Cults",
  "grey knights": "Imperium - Grey Knights",
  "imperial agents": "Imperium - Agents of the Imperium",
  "imperial knights": "Imperium - Imperial Knights",
  "leagues of votann": "Xenos - Leagues of Votann",
  necrons: "Xenos - Necrons",
  orks: "Xenos - Orks",
  "space marines": "Imperium - Adeptus Astartes - Space Marines",
  "space wolves": "Imperium - Adeptus Astartes - Space Wolves",
  "t au empire": "Xenos - T'au Empire",
  "thousand sons": "Chaos - Thousand Sons",
  tyranids: "Xenos - Tyranids",
  "world eaters": "Chaos - World Eaters"
};

const DETACHMENT_ALIASES = {
  "haloscreed battle clade": "haloscreed battleclade",
  "luminen auto choir": "luminen autochoir",
  "brood brothers auxilia": "brood brother auxilia",
  "ordo hereticus purgation force": "purgation force ordo hereticus",
  "ordo malleus daemon hunters": "daemon hunters ordo malleus",
  "ordo xenos alien hunters": "alien hunters ordo xenos"
};

const NAME_ALIASES = {
  "autoclavic denunciation": "autoclavic denounciation",
  "assassins eye": "assassin s eye",
  "sharp eyes": "sharp eyes light fingers",
  "spy skull data link": "spy skull datalink",
  "herald of sacred slaughter": "herald of the sacred slaughter",
  "master of machine war": "master of the machine war",
  slaughterthirst: "slaugterthirst",
  "entreaty of perpetual ardour": "petition of stability",
  "sublime prescience": "sublime presence",
  "biomorph adaptation": "biomorph adaption",
  "delvewerke navigator": "delvwerke navigator",
  "farstrydr node": "farstryder node",
  "stormseers wisdom": "stormseer s wisdom",
  "diabolic savant": "diabolic servant",
  incandaeum: "incandeum",
  "instinctive defence": "instinctive defense",
  "synaptic strategy": "synaptic synergy",
  "naturalised camouflage": "naturalised camoflage"
};

function normalize(value) {
  return String(value || "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ø/g, "0")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\barmour\b/g, "armor")
    .trim()
    .replace(/(?:\s+(?:upgrade|aura|psychic))+$/, "");
}

function normalizeDetachment(value) {
  const name = normalize(value);
  return DETACHMENT_ALIASES[name] || name;
}

function normalizeEnhancement(value) {
  const name = normalize(value);
  return NAME_ALIASES[name] || name;
}

function audit(reportPath = path.resolve(__dirname, "..", "reports", "mfm-current-all-enhancements.json")) {
  const official = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  const ruleset = extractNormalizedRuleset("wh40k-11e-vflam");
  const unmatched = [];
  const mismatched = [];
  let matched = 0;

  for (const row of official.enhancements || []) {
    const faction = FACTIONS[normalize(row.faction)] || row.faction;
    const armies = normalize(row.faction) === "space marines"
      ? ruleset.armies.filter(item => String(item.faction || "").startsWith("Imperium - Adeptus Astartes - "))
      : ruleset.armies.filter(item => item.faction === faction);
    const matchingContexts = armies.flatMap(army => {
      const detachment = army.detachments.find(item => normalizeDetachment(item.name) === normalizeDetachment(row.detachmentName));
      if (!detachment) return [];
      return [{ army, detachment }];
    });
    const candidates = matchingContexts.flatMap(({ army, detachment }) =>
      (army.enhancements || []).filter(item =>
        normalizeEnhancement(item.name) === normalizeEnhancement(row.enhancementName)
        && (item.detachmentIds || []).includes(detachment.id)
      )
    );
    if (!armies.length || !matchingContexts.length || !candidates.length) {
      unmatched.push({
        ...row,
        faction,
        armyFound: Boolean(armies.length),
        detachmentFound: Boolean(matchingContexts.length)
      });
      continue;
    }
    matched += 1;
    const appPoints = [...new Set(candidates.map(item => Number(item.points)))];
    if (appPoints.length !== 1 || appPoints[0] !== Number(row.points)) {
      mismatched.push({ ...row, faction, appPoints });
    }
  }
  return {
    summary: {
      generatedAt: official.generatedAt,
      officialRows: (official.enhancements || []).length,
      matched,
      unmatched: unmatched.length,
      mismatched: mismatched.length
    },
    unmatched,
    mismatched
  };
}

function main() {
  const result = audit(process.argv[2]);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.summary.unmatched || result.summary.mismatched) process.exitCode = 1;
}

if (require.main === module) main();

module.exports = { audit };
