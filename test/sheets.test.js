"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildRosterSheets } = require("../src/domain/sheets");

test("printable sheets build combined unit records from grouped presentation", () => {
  const document = {
    name: "Order Test",
    faction: "Imperium - Adepta Sororitas",
    subfaction: "Order of Our Martyred Lady",
    pointsLimit: 1000,
    totalPoints: 175,
    enhancements: [{
      enhancementId: "blade",
      name: "Saintly Example",
      points: 20,
      bearerInstanceId: "leader-1",
      bearerName: "Canoness",
      description: "The bearer can re-roll Advance and Charge rolls."
    }],
    rosterEntries: [{
      instanceId: "bodyguard-1",
      name: "Battle Sisters Squad",
      points: 100,
      keywords: ["Infantry", "Battleline"],
      unitSize: { current: 10 },
      configured: {
        units: [{ name: "Battle Sister", count: 10, characteristics: { M: "6\"", T: "3", SV: "3+", W: "1", LD: "7+", OC: "2", InSv: "6+" } }],
        weapons: [{ name: "Boltgun", typeName: "Ranged Weapons", count: 10, characteristics: { Range: "24\"", A: "2", BS: "3+", S: "4", AP: "0", D: "1", Keywords: "Rapid Fire 1" } }],
        abilities: [{ name: "Acts of Faith", characteristics: { Description: "Use Miracle dice." } }],
        rules: [{ name: "Rapid Fire 1", description: "Keyword explanation." }]
      }
    }, {
      instanceId: "leader-1",
      name: "Canoness",
      points: 55,
      keywords: ["Infantry", "Character"],
      unitSize: { current: 1 },
      configured: {
        units: [{ name: "Canoness", count: 1, characteristics: { M: "6\"", T: "3", SV: "3+", W: "4", LD: "6+", OC: "1" } }],
        weapons: [{ name: "Power weapon", typeName: "Melee Weapons", count: 1, characteristics: { A: "4", WS: "2+", S: "5", AP: "-2", D: "2" } }],
        abilities: [
          { name: "Might is Right", characteristics: { Description: "While this model is leading a unit, add 1 to the Hit roll." } },
          { name: "Leader", characteristics: { Description: "Can lead a unit." } },
          { name: "Bodyguard", characteristics: { Description: "Construction text." } }
        ],
        rules: [{ name: "Waaagh!", description: "Army rule text." }]
      }
    }],
    groupedPresentation: [{
      id: "attached:bodyguard-1",
      kind: "attached",
      title: "Battle Sisters Squad + Canoness",
      totalPoints: 175,
      basePoints: 155,
      enhancementPoints: 20,
      memberInstanceIds: ["bodyguard-1", "leader-1"],
      warnings: []
    }]
  };

  const sheets = buildRosterSheets(document);
  const combined = sheets.combinedUnitSheets[0];

  assert.equal(combined.kind, "combined-unit");
  assert.equal(combined.title, "Battle Sisters Squad + Canoness");
  assert.deepEqual(combined.memberInstanceIds, ["bodyguard-1", "leader-1"]);
  assert.deepEqual(combined.members.map(item => item.name), ["Battle Sisters Squad", "Canoness"]);
  assert.deepEqual(combined.members.map(item => [item.name, item.points, item.enhancementPoints, item.totalPoints]), [
    ["Battle Sisters Squad", 100, 0, 100],
    ["Canoness", 55, 20, 75]
  ]);
  assert.equal(combined.totalPoints, 175);
  assert.equal(combined.basePoints, 155);
  assert.equal(combined.enhancementPoints, 20);
  assert.deepEqual(combined.keywords, ["Infantry", "Battleline", "Character"]);
  assert.equal(combined.rangedWeapons[0].name, "Boltgun");
  assert.equal(combined.rangedWeapons[0].keywords, "RF1");
  assert.equal(combined.meleeWeapons[0].name, "Power weapon");
  assert.equal(combined.statlines[0].characteristics.InSv, "6+");
  assert.deepEqual(combined.abilities.map(item => [item.name, item.provider]), [
    ["Acts of Faith", "Battle Sister"],
    ["Might is Right", "Canoness"]
  ]);
  assert.deepEqual(combined.rulesTags, ["Waaagh!"]);
  assert.deepEqual(combined.enhancements.map(item => [item.name, item.description]), [
    ["Saintly Example", "The bearer can re-roll Advance and Charge rolls."]
  ]);
});

test("printable sheets keep weapon keywords on weapons and omit gameplay glossary rules", () => {
  const sheets = buildRosterSheets({
    name: "Gretchin Test",
    pointsLimit: 1000,
    totalPoints: 40,
    rosterEntries: [{
      instanceId: "gretchin-1",
      name: "Gretchin",
      points: 40,
      keywords: ["Infantry"],
      unitSize: { current: 10 },
      configured: {
        units: [{ name: "Gretchin", count: 10, characteristics: { M: "6\"", T: "2", SV: "7+" } }],
        weapons: [
          { name: "Grot blasta", typeName: "Ranged Weapons", count: 10, characteristics: { Range: "12\"", A: "1", BS: "4+", S: "3", AP: "0", D: "1", Keywords: "Pistol" } },
          { name: "Slugga", typeName: "Ranged Weapons", count: 1, characteristics: { Range: "12\"", A: "1", BS: "5+", S: "4", AP: "0", D: "1", Keywords: "Close-quarters" } }
        ],
        abilities: [
          { name: "Thievin' Scavengers", characteristics: { Description: "Gain CP on a roll." } },
          { name: "Bodyguard", characteristics: { Description: "Construction text." } }
        ],
        rules: [
          { name: "Pistol", description: "Basic weapon keyword explanation." },
          { name: "Close-quarters", description: "Basic weapon keyword explanation." },
          { name: "Waaagh!", description: "Army rule text." }
        ]
      }
    }]
  });

  const sheet = sheets.combinedUnitSheets[0];
  assert.deepEqual(sheet.rangedWeapons.map(item => [item.name, item.keywords]), [
    ["Grot blasta", "Pistol"],
    ["Slugga", "CQ"]
  ]);
  assert.deepEqual(sheet.abilities.map(item => [item.name, item.provider]), [["Thievin' Scavengers", "Gretchin"]]);
  assert.deepEqual(sheet.rulesTags, ["Waaagh!"]);
});

test("printable sheets render compact unit rule tags with values when available", () => {
  const sheets = buildRosterSheets({
    name: "Rules Tag Test",
    pointsLimit: 1000,
    totalPoints: 95,
    rosterEntries: [{
      instanceId: "spawn-1",
      name: "Chaos Spawn",
      points: 95,
      keywords: ["Beast"],
      unitSize: { current: 2 },
      configured: {
        units: [{ name: "Chaos Spawn", count: 2, characteristics: { M: "8\"", T: "5", SV: "4+" } }],
        weapons: [{ name: "Hideous mutations", typeName: "Melee Weapons", count: 2, characteristics: { A: "D6+2", WS: "4+", S: "5", AP: "-1", D: "2", Keywords: "Sustained Hits 1" } }],
        abilities: [],
        rules: [
          { name: "Feel No Pain", description: "This model has Feel No Pain 5+." },
          { name: "Scouts", description: "This unit has Scouts 8\"." },
          { name: "Deadly Demise", description: "Deadly Demise D3." },
          { name: "Lone Operative", description: "This unit has Lone Operative." },
          { name: "Deep Strike", description: "" },
          { name: "Synapse", description: "Friendly units benefit from Synapse." },
          { name: "Sustained Hits 1", description: "Weapon keyword explanation." }
        ]
      }
    }]
  });

  const sheet = sheets.combinedUnitSheets[0];
  assert.deepEqual(sheet.rulesTags, [
    "FNP 5+",
    "Scouts 8\"",
    "Deadly Demise D3",
    "Lone Op",
    "Deep Strike",
    "Synapse"
  ]);
});

test("printable sheets still show compact rule tags when source text omits X values", () => {
  const sheets = buildRosterSheets({
    name: "Rules Placeholder Test",
    pointsLimit: 1000,
    totalPoints: 95,
    rosterEntries: [{
      instanceId: "spawn-1",
      name: "Chaos Spawn",
      points: 95,
      keywords: ["Beast"],
      unitSize: { current: 2 },
      configured: {
        units: [],
        weapons: [],
        abilities: [],
        rules: [
          { name: "Feel No Pain", description: "This ability always takes the form Feel No Pain X+." },
          { name: "Scouts", description: "This ability always takes the form Scouts X\"." }
        ]
      }
    }]
  });

  assert.deepEqual(sheets.combinedUnitSheets[0].rulesTags, ["FNP", "Scouts"]);
});

test("printable sheets apply selected upgrade invulnerable saves to statlines", () => {
  const sheets = buildRosterSheets({
    name: "Norn Test",
    pointsLimit: 1000,
    totalPoints: 290,
    enhancements: [{
      enhancementId: "synaptoprescience",
      name: "Synaptoprescience",
      points: 25,
      bearerInstanceId: "norn-1",
      bearerName: "Norn Assimilator",
      profiles: [{
        name: "Synaptoprescience",
        characteristics: { Description: "**NORN ASSIMILATOR** unit only. This unit has 4+ **InSv**." }
      }]
    }],
    rosterEntries: [{
      instanceId: "norn-1",
      name: "Norn Assimilator",
      points: 265,
      keywords: ["Monster"],
      unitSize: { current: 1 },
      configured: {
        units: [{ name: "Norn Assimilator", count: 1, characteristics: { M: "8\"", T: "11", SV: "2+", W: "16", LD: "7+", OC: "5" } }],
        weapons: [],
        abilities: [],
        rules: []
      }
    }]
  });

  assert.equal(sheets.combinedUnitSheets[0].statlines[0].characteristics.InSv, "4+");
  assert.equal(sheets.crusadeSheets[0].statline.characteristics.InSv, "4+");
});

test("printable sheets abbreviate long weapon keywords for attack rows", () => {
  const sheets = buildRosterSheets({
    name: "Keyword Test",
    pointsLimit: 1000,
    totalPoints: 100,
    rosterEntries: [{
      instanceId: "tankbustas-1",
      name: "Tankbustas",
      points: 100,
      keywords: ["Infantry"],
      unitSize: { current: 5 },
      configured: {
        units: [{ name: "Tankbusta", count: 5, characteristics: { M: "6\"", T: "5", SV: "5+" } }],
        weapons: [{
          name: "Tankhammer",
          typeName: "Melee Weapons",
          count: 1,
          characteristics: {
            A: "2",
            WS: "4+",
            S: "10",
            AP: "-2",
            D: "D6",
            Keywords: "Anti-Monster 4+, Anti-Vehicle 4+, Devastating Wounds, Hazardous, Sustained Hits 1, Twin-linked"
          }
        }, {
          name: "Weird gun",
          typeName: "Ranged Weapons",
          count: 1,
          characteristics: {
            Range: "18\"",
            A: "3",
            BS: "5+",
            S: "6",
            AP: "0",
            D: "1",
            Keywords: "Anti-Infantry 3+, Anti-Psyker 4+, Rapid Fire 2, Blast, Precision, Close-quarters"
          }
        }],
        abilities: [],
        rules: []
      }
    }]
  });

  const sheet = sheets.combinedUnitSheets[0];
  assert.equal(sheet.meleeWeapons[0].keywords, "AMon4+, AVeh4+, DEV, HAZ, SH1, TL");
  assert.equal(sheet.rangedWeapons[0].keywords, "AInf3+, APsy4+, RF2, Blast, Precision, CQ");
});

test("unit sheet packets include rule and stratagem reference sheets", () => {
  const sheets = buildRosterSheets({
    name: "Reference Test",
    faction: "Xenos - Tyranids",
    pointsLimit: 1000,
    totalPoints: 80,
    armyRules: [
      { name: "Shadow in the Warp", description: "Force Battle-shock tests." },
      { name: "Sustained Hits 1", description: "Glossary text should stay off the rules page." }
    ],
    coreStratagems: [{
      name: "Command Re-roll",
      cpCost: "1",
      phase: "Any phase",
      description: "Re-roll an eligible roll."
    }],
    detachments: [{
      id: "invasion",
      name: "Invasion Fleet",
      detachmentPoints: 3,
      rules: [
        { name: "Hyper-adaptations", description: "Pick an adaptation." },
        { name: "Rapid Fire 1", description: "Glossary text should stay off the rules page." }
      ],
      stratagems: [{
        name: "Adrenal Surge",
        cpCost: "1",
        phase: "Fight phase",
        description: "Improve melee output."
      }]
    }],
    rosterEntries: [{
      instanceId: "termagants-1",
      name: "Termagants",
      points: 80,
      keywords: ["Infantry"],
      unitSize: { current: 10 },
      configured: {
        units: [],
        weapons: [{
          name: "Fleshborer",
          typeName: "Ranged Weapons",
          count: 10,
          characteristics: { Keywords: "Rapid Fire 1, Blast, Twin-linked" }
        }],
        abilities: [],
        rules: []
      }
    }]
  });

  assert.deepEqual(sheets.referenceSheets.rules.armyRules.map(item => item.name), ["Shadow in the Warp"]);
  assert.deepEqual(sheets.referenceSheets.rules.detachments.map(item => [item.name, item.rules[0].name]), [["Invasion Fleet", "Hyper-adaptations"]]);
  assert.deepEqual(sheets.referenceSheets.rules.detachments[0].rules.map(item => item.name), ["Hyper-adaptations"]);
  assert.deepEqual(sheets.referenceSheets.rules.detachments[0].stratagems.map(item => [item.name, item.sourceLabel]), [["Adrenal Surge", "Invasion Fleet"]]);
  assert.deepEqual(sheets.referenceSheets.rules.weaponKeywordLegend.map(item => [item.keyword, item.original]), [
    ["RF1", "Rapid Fire 1"],
    ["TL", "Twin-linked"]
  ]);
  assert.deepEqual(sheets.referenceSheets.stratagems.coreStratagems.map(item => [item.name, item.sourceLabel]), [["Command Re-roll", "Core"]]);
  assert.equal(sheets.referenceSheets.stratagems.detachmentStratagems, undefined);
});

test("printable sheets label abilities with the model or unit providing them", () => {
  const sheets = buildRosterSheets({
    name: "Ghaz Test",
    pointsLimit: 1000,
    totalPoints: 235,
    rosterEntries: [{
      instanceId: "ghaz-1",
      name: "Ghazghkull Thraka",
      points: 235,
      keywords: ["Infantry", "Character"],
      unitSize: { current: 2 },
      configured: {
        units: [
          { name: "Ghazghkull Thraka", count: 1, characteristics: { M: "5\"", T: "6", SV: "2+" } },
          { name: "Makari", count: 1, characteristics: { M: "5\"", T: "3", SV: "6+" } }
        ],
        weapons: [],
        abilities: [
          { name: "Prophet of Da Great Waaagh!", characteristics: { Description: "While this unit is leading a unit, add 1 to melee Hit rolls." } },
          { name: "Ghazghkull's Waaagh! Banner", characteristics: { Description: "While a friendly ORKS unit is within 12\" of Makari, melee weapons have [LETHAL HITS]." } },
          { name: "Leader", characteristics: { Description: "This unit can be attached to listed units." } }
        ],
        rules: [{ name: "Lethal Hits", description: "Weapon keyword explanation." }]
      }
    }]
  });

  assert.deepEqual(sheets.combinedUnitSheets[0].abilities.map(item => [item.name, item.provider]), [
    ["Prophet of Da Great Waaagh!", "Ghazghkull Thraka"],
    ["Ghazghkull's Waaagh! Banner", "Makari"]
  ]);
});

test("unit sheet packets omit roster warnings from printable unit cards", () => {
  const sheets = buildRosterSheets({
    name: "Warning Test",
    pointsLimit: 1000,
    totalPoints: 100,
    rosterEntries: [{
      instanceId: "unit-1",
      name: "Nobz",
      points: 100,
      keywords: ["Infantry"],
      unitSize: { current: 5 },
      configured: {
        units: [{ name: "Nob", count: 5, characteristics: { M: "6\"", T: "5", SV: "4+" } }],
        weapons: [],
        abilities: [],
        rules: []
      }
    }],
    groupedPresentation: [{
      id: "unit-1",
      kind: "unit",
      title: "Nobz",
      totalPoints: 100,
      memberInstanceIds: ["unit-1"],
      warnings: [{ code: "BODYGUARD_HAS_MULTIPLE_LEADERS", message: "Nobz has 2 Leaders attached." }]
    }]
  });

  assert.deepEqual(sheets.combinedUnitSheets[0].warnings, []);
});

test("unit sheet packets collapse identical reference sheets but keep crusade copies", () => {
  const boyz = index => ({
    instanceId: `boyz-${index}`,
    name: "Boyz",
    points: 150,
    keywords: ["Infantry", "Battleline"],
    unitSize: { current: 20 },
    configured: {
      units: [
        { name: "Boy", count: 19, characteristics: { M: "6\"", T: "5", SV: "5+", W: "1" } },
        { name: "Boss Nob", count: 1, characteristics: { M: "6\"", T: "5", SV: "5+", W: "2" } }
      ],
      weapons: [
        { name: "Slugga", typeName: "Ranged Weapons", count: 18, characteristics: { Range: "12\"", A: "1", BS: "5+", S: "4", AP: "0", D: "1", Keywords: "Pistol" } },
        { name: "Choppa", typeName: "Melee Weapons", count: 17, characteristics: { A: "3", WS: "3+", S: "4", AP: "0", D: "1" } },
        { name: "Power klaw", typeName: "Melee Weapons", count: 1, characteristics: { A: "3", WS: "4+", S: "9", AP: "-2", D: "2" } }
      ],
      abilities: [{ name: "Mob Rule", characteristics: { Description: "Use the Boyz reference rule." } }],
      rules: []
    }
  });
  const nobz = {
    instanceId: "nobz-1",
    name: "Nobz",
    points: 210,
    keywords: ["Infantry"],
    unitSize: { current: 10 },
    configured: {
      units: [{ name: "Nob", count: 10, characteristics: { M: "6\"", T: "5", SV: "4+", W: "2" } }],
      weapons: [{ name: "Big choppa", typeName: "Melee Weapons", count: 10, characteristics: { A: "3", WS: "3+", S: "7", AP: "-1", D: "2" } }],
      abilities: [],
      rules: []
    }
  };

  const sheets = buildRosterSheets({
    name: "Orks Reference Test",
    pointsLimit: 2000,
    totalPoints: 660,
    rosterEntries: [boyz(1), boyz(2), boyz(3), nobz]
  });

  assert.deepEqual(sheets.combinedUnitSheets.map(sheet => sheet.title), ["Boyz", "Nobz"]);
  assert.equal(sheets.crusadeSheets.length, 4);
});

test("crusade sheets preserve unit data and provide empty bookkeeping fields", () => {
  const sheets = buildRosterSheets({
    name: "Crusade Test",
    pointsLimit: 1000,
    totalPoints: 100,
    rosterEntries: [{
      instanceId: "unit-1",
      name: "Intercessor Squad",
      points: 100,
      keywords: ["Infantry"],
      unitSize: { current: 5 },
      configured: {
        units: [{ name: "Intercessor", count: 5, characteristics: { M: "6\"", T: "4", SV: "3+" } }],
        weapons: [{ name: "Bolt rifle", typeName: "Ranged Weapons", count: 5, characteristics: { Keywords: "Assault" } }],
        abilities: [],
        rules: []
      }
    }]
  });

  const crusade = sheets.crusadeSheets[0];
  assert.equal(crusade.unitName, "Intercessor Squad");
  assert.equal(crusade.statline.name, "Intercessor");
  assert.deepEqual(crusade.equipment, ["5x Bolt rifle [Assault]"]);
  assert.equal(crusade.crusadePoints, undefined);
  assert.equal(crusade.crusade.crusadePoints, "");
  assert.equal(crusade.crusade.battleHonours, "");
});
