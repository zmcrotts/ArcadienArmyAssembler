"use strict";

const ENHANCEMENT_ALIASES = new Map(Object.entries({
  "autoclavic denounciation": "autoclavic denunciation",
  "assassin s eye": "assassins eye",
  "biomorph adaption": "biomorph adaptation",
  "delvwerke navigator": "delvewerke navigator",
  "diabolic servant": "diabolic savant",
  "farstryder node": "farstrydr node",
  "herald of the sacred slaughter": "herald of sacred slaughter",
  "incandeum": "incandaeum",
  "instinctive defence": "instinctive defense",
  "intra neural biotech": "introneural biotech",
  "master of the machine war": "master of machine war",
  "micromelta round": "micromelta rounds",
  "naturalised camoflage": "naturalised camouflage",
  "sharp eyes light fingers": "sharp eyes",
  "slaugterthirst": "slaughterthirst",
  "spy skull datalink": "spy skull data link",
  "sublime presence": "sublime prescience",
  "synaptic synergy": "synaptic strategy",
  "tl 4o9": "tl 409"
}));

const DETACHMENT_ALIASES = new Map(Object.entries({
  "alien hunters ordo xenos": "ordo xenos alien hunters",
  "brood brothers auxilia": "brood brother auxilia",
  "daemon hunters ordo malleus": "ordo malleus daemon hunters",
  "haloscreed battle clade": "haloscreed battleclade",
  "luminen auto choir": "luminen autochoir",
  "purgation force ordo hereticus": "ordo hereticus purgation force"
}));

function normalizeMfmName(value) {
  return String(value || "")
    .replace(/[øØ]/g, "o")
    .replace(/[æÆ]/g, "ae")
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\barmour\b/g, "armor")
    .trim();
}

function canonicalEnhancementName(value) {
  const normalized = normalizeMfmName(value)
    .replace(/(?:\s+(?:upgrade|aura|psychic))+$/, "");
  return ENHANCEMENT_ALIASES.get(normalized) || normalized;
}

function canonicalDetachmentName(value) {
  const normalized = normalizeMfmName(value);
  return DETACHMENT_ALIASES.get(normalized) || normalized;
}

module.exports = { canonicalDetachmentName, canonicalEnhancementName, normalizeMfmName };
