"use strict";

const SPACE_MARINES = "Imperium - Adeptus Astartes - Space Marines";
const AELDARI = "Xenos - Aeldari";

function isBuilderFaction(name) {
  return Boolean(name)
    && !/library/i.test(name)
    && !/Titanicus/i.test(name)
    && name !== "Unaligned Forces";
}

function allegianceFor(name) {
  if (/^(Chaos|.*Chaos)/i.test(name)) return "Chaos";
  if (/^Imperium/i.test(name)) return "Imperium";
  return "Xenos";
}

function labelFor(name) {
  return String(name)
    .replace(/^Imperium - /, "")
    .replace(/^Chaos - /, "")
    .replace(/^Xenos - /, "")
    .replace(/^Aeldari - /, "");
}

function buildFactionNavigation(factionNames) {
  const visible = [...new Set(factionNames)].filter(isBuilderFaction).sort();
  const records = new Map();

  for (const faction of visible) {
    let id = faction;
    let label = labelFor(faction);
    let modeLabel = null;

    if (faction.startsWith("Imperium - Adeptus Astartes - ")) {
      id = SPACE_MARINES;
      label = "Space Marines";
      modeLabel = faction === SPACE_MARINES ? "Generic" : faction.slice("Imperium - Adeptus Astartes - ".length);
    } else if (faction === "Aeldari - Ynnari") {
      id = AELDARI;
      label = "Aeldari";
      modeLabel = "Ynnari";
    } else if (faction === AELDARI) {
      modeLabel = "Craftworlds";
    }

    if (!records.has(id)) records.set(id, {
      id,
      label,
      allegiance: allegianceFor(id),
      baseFaction: id,
      modes: []
    });
    if (modeLabel) records.get(id).modes.push({ id: faction, label: modeLabel, faction });
  }

  for (const record of records.values()) {
    record.modes.sort((a, b) => {
      const preferred = value => /^(Generic|Craftworlds)$/.test(value) ? 0 : 1;
      return preferred(a.label) - preferred(b.label) || a.label.localeCompare(b.label);
    });
    record.defaultMode = record.modes[0]?.id || record.id;
  }

  return ["Imperium", "Chaos", "Xenos"].map(allegiance => ({
    allegiance,
    factions: [...records.values()]
      .filter(record => record.allegiance === allegiance)
      .sort((a, b) => a.label.localeCompare(b.label))
  })).filter(group => group.factions.length);
}

module.exports = { AELDARI, SPACE_MARINES, buildFactionNavigation, isBuilderFaction };
