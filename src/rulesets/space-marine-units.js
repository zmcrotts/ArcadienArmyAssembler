"use strict";
const fs = require("node:fs");
const zlib = require("node:zlib");
const isMarine = value => String(value || "").startsWith("Imperium - Adeptus Astartes");
function readSpaceMarineUnits(file) {
  if (!file) return null;
  const data = JSON.parse(zlib.gunzipSync(fs.readFileSync(file)));
  if (data.schemaVersion !== 1 || !data.commit || !data.units?.length || !data.armies?.length) throw new Error("Invalid pinned Space Marine unit source");
  const keys = new Set();
  const hasCurrentCalgar = data.units.some(unit => unit.name === "Marneus Calgar in Armour of Antilochus");
  const units = data.units.filter(unit => !(hasCurrentCalgar && unit.name === "Marneus Calgar")).map(({ selectionTreeRef, ...unit }) => {
    if (!isMarine(unit.faction) || keys.has(unit.selectionKey) || !data.trees[selectionTreeRef]) throw new Error("Invalid Marine definition or selection tree");
    keys.add(unit.selectionKey);
    if (unit.name === "Marneus Calgar in Armour of Antilochus") {
      unit.previousSelectionKeys = data.units.filter(old => old.faction === unit.faction && old.name === "Marneus Calgar").map(old => old.selectionKey);
      unit.previousNames = ["Marneus Calgar"];
    }
    return { ...unit, selectionTree: repairMarineTree(data.trees[selectionTreeRef], unit.name), spaceMarineUnitSource: { source: data.source, branch: data.branch, commit: data.commit, date: data.date } };
  });
  return { ...data, units };
}
// These repairs address malformed upstream structure, without inventing weapon rules.
function repairMarineTree(tree, unitName) {
  if (!["Ancient in Terminator Armour", "Victrix Honour Guard", "Inner Circle Companions", "Wolf Scouts", "Eradicator Squad with Heavy Bolters", "Desolation Squad", "Death Company Marines with Jump Packs", "Deathwatch Terminator Squad"].includes(unitName)) return tree;
  function visit(node) {
    const next = { ...node, children: (node.children || []).map(visit) };
    if (unitName === "Ancient in Terminator Armour" && node.kind === "group" && node.name === "Wargear"
        && node.children?.length === 2 && node.children.every(child => child.constraints?.some(c => c.type === "min" && Number(c.value) === 1))) {
      next.defaultSelectionId = null;
      next.constraints = node.constraints.map(c => c.field === "selections" && ["min", "max"].includes(c.type) ? { ...c, value: 2 } : c);
    }
    if (unitName === "Victrix Honour Guard" && node.kind === "group" && node.name === "Victrix Honour Guard") {
      next.constraints = node.constraints.map(c => c.field === "selections" && c.type === "min" ? { ...c, value: 3 } : c);
    }
    if (unitName === "Inner Circle Companions" && node.kind === "group" && node.name === "Companions"
        && !node.constraints.some(c => c.field === "selections" && c.type === "max")) {
      next.constraints = [...node.constraints, { id: "marine-companions-maximum", type: "max", field: "selections", scope: "parent", value: 6 }];
    }
    if (unitName === "Wolf Scouts" && /^\d+ Models$/i.test(node.name)) next.modelBundleSize = Number(node.name.match(/^\d+/)[0]);
    if (unitName === "Eradicator Squad with Heavy Bolters" && node.kind === "group" && node.name === "Eradicators") {
      next.constraints = node.constraints.map(c => c.field === "selections" && c.type === "max" ? { ...c, value: 6 } : c);
    }
    if (unitName === "Desolation Squad" && node.kind === "group" && node.name === "Weapon Option") {
      // Current Codex card supplied by the user: squad-wide launcher choice,
      // with the Sergeant allowed to replace either launcher with a Vengor.
      next.squadWeaponChoice = "desolation-launchers";
      next.squadWeaponExceptions = node.children.some(child => child.name === "Vengor launcher") ? ["Vengor launcher"] : [];
      next.children = next.children.map(child => ({ ...child,
        modifiers: child.modifiers.filter(modifier => modifier.field !== "hidden")
      }));
    }
    if (unitName === "Death Company Marines with Jump Packs") {
      // October 11 user-supplied wargear card: independent pistol/melee
      // replacements, each capped per five models, without paired restrictions.
      if (node.kind === "model" && node.name === "Death Company Marine w/ alternate weapons") {
        next.constraints = node.constraints.map(c => c.field === "selections" && c.type === "max" ? { ...c, value: 10 } : c);
      }
      const perFive = { "Power fist": 1, "Hand flamer": 1, "Power weapon": 2, "Inferno Pistol": 1, "Plasma pistol": 2, "Eviscerator": 1 }[node.name];
      if (node.kind === "upgrade" && perFive) {
        const legacyIds = {
          "Plasma pistol": ["dcjp-plasma-pistol-option", "dcjp-plasma-pistol-chainsword", "dcjp-plasma-pistol-power-fist", "dcjp-plasma-pistol-power-weapon"],
          "Hand flamer": ["dcjp-hand-flamer-chainsword", "dcjp-hand-flamer-power-fist", "dcjp-hand-flamer-power-weapon"],
          "Inferno Pistol": ["dcjp-inferno-pistol-chainsword", "dcjp-inferno-pistol-power-fist", "dcjp-inferno-pistol-power-weapon"],
          "Power fist": ["dcjp-power-fist", "dcjp-hand-flamer-power-fist", "dcjp-heavy-bolt-pistol-power-fist", "dcjp-inferno-pistol-power-fist", "dcjp-plasma-pistol-power-fist"],
          "Power weapon": ["dcjp-power-weapon", "dcjp-hand-flamer-power-weapon", "dcjp-heavy-bolt-pistol-power-weapon", "dcjp-inferno-pistol-power-weapon", "dcjp-plasma-pistol-power-weapon"],
          "Eviscerator": ["dcjp-eviscerator-option"]
        };
        next.previousSelectionIds = legacyIds[node.name];
        const maximum = node.constraints.find(c => c.field === "selections" && c.scope === "unit" && c.type === "max");
        if (maximum) {
          next.constraints = node.constraints.map(c => c.id === maximum.id ? { ...c, value: perFive } : c);
          next.modifiers = [
            ...node.modifiers.filter(m => m.field !== maximum.id),
            { type: "increment", field: maximum.id, value: perFive,
              conditions: [{ childId: "model", field: "selections", includeChildSelections: true, scope: "unit", type: "atLeast", value: 10 }],
              conditionGroups: [], repeats: [] }
          ];
        }
      }
    }
    if (unitName === "Deathwatch Terminator Squad") {
      // October 11 user-supplied datasheet. Preserve saved selection IDs.
      const weapons = {
        "assault cannon": ['24"', '6', '3+', '6', '-2', '1', 'Sustained Hits 1'],
        "heavy flamer": ['12"', '3', '-', '5', '-1', '1', 'Blast 2, Torrent'],
        "storm bolter": ['24"', '2', '3+', '5', '-1', '1', 'Rapid Fire 2'],
        "plasma cannon - standard": ['36"', '3', '3+', '9', '-2', '2', 'Blast 1'],
        "plasma cannon - supercharge": ['36"', '3', '3+', '10', '-3', '3', 'Blast 1, Hazardous'],
        "cyclone missile launcher - frag": ['36"', '8', '3+', '4', '-1', '1', 'Blast 2'],
        "cyclone missile launcher - krak": ['36"', '2', '3+', '10', '-2', 'D3+3', ''],
        "power fist": ['Melee', '3', '3+', '8', '-2', '2', ''],
        "power weapon": ['Melee', '5', '3+', '5', '-2', '1', ''],
        "thunder hammer": ['Melee', '3', '3+', '8', '-2', '3', 'Devastating Wounds'],
        "twin lightning claws": ['Melee', '6', '3+', '5', '-2', '1', 'Twin-linked'],
        "chainfist - standard": ['Melee', '2', '4+', '8', '-2', '2', ''],
        "chainfist - hunter": ['Melee', '3', '3+', '12', '-2', '3', 'Hunter']
      };
      const weaponProfile = (profile, key) => ({ ...profile, characteristics: Object.fromEntries(
        ['Range', 'A', profile.typeName === 'Melee Weapons' ? 'WS' : 'BS', 'S', 'AP', 'D', 'Keywords'].map((field, i) => [field, weapons[key][i]])
      ) });
      next.profiles = (node.profiles || []).flatMap(profile => {
        const name = profile.name.replace(/^➤\s*/, '').trim().toLowerCase();
        if (profile.typeName === 'Unit') return [{ ...profile, characteristics: { ...profile.characteristics, T: '6', InSv: '4+' } }];
        if (name === 'chainfist') return [
          weaponProfile({ ...profile, name: '➤ Chainfist - Standard' }, 'chainfist - standard'),
          weaponProfile({ ...profile, id: profile.id + '-hunter', name: '➤ Chainfist - Hunter' }, 'chainfist - hunter')
        ];
        if (weapons[name]) return [weaponProfile(profile, name)];
        if (name === 'storm shield') return [{ ...profile, characteristics: { ...profile.characteristics, Description: 'This model has +1 W.' } }];
        if (name === 'teleport homer') return [{ ...profile, characteristics: { ...profile.characteristics, Description: 'At the start of the battle, you can set up one Teleport Homer token for this unit on the battlefield. When you target this unit with the Rapid Ingress stratagem, you can use that token. If you do, reduce the CP cost by 1; this unit must be set up within 3" of the token and not within 8" of an enemy unit. The token is then removed. If an enemy unit ends a move within 1" of the token, the token is removed.' } }];
        return [profile];
      });
      if (node.name === 'Thunder Hammer & Storm Shield') next.modelWoundsBonus = 1;
    }
    return next;
  }
  return visit(tree);
}

function applySpaceMarineUnits(units, armies, source, rulesetId) {
  if (!source) return { units, armies, summary: { applied: false } };
  const definitions = source.units.map(unit => ({ ...unit, rulesetId }));
  const allowed = new Map(source.armies.map(army => [army.faction, army.allowedSelectionKeys]));
  return {
    units: [...units.filter(unit => !isMarine(unit.faction)), ...definitions],
    armies: armies.map(army => allowed.has(army.faction) ? { ...army, allowedSelectionKeys: allowed.get(army.faction) } : army),
    summary: { applied: true, source: source.source, commit: source.commit, branch: source.branch, units: definitions.length, armies: allowed.size }
  };
}
module.exports = { readSpaceMarineUnits, applySpaceMarineUnits };
