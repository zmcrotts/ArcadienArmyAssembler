"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildRosterSheets } = require("../src/domain/sheets");

test("printable sheets preserve Transport capacity outside ordinary abilities", () => {
  const sheets = buildRosterSheets({
    rosterEntries: [{
      instanceId: "transport-1",
      name: "Tyrannocyte",
      configured: {
        units: [],
        weapons: [],
        abilities: [{
          typeName: "Transport",
          name: "Tyrannocyte",
          characteristics: { Capacity: "This model has a transport capacity of 20 TYRANIDS INFANTRY models." }
        }],
        rules: []
      }
    }]
  });
  const transport = sheets.combinedUnitSheets[0].abilities[0];

  assert.equal(transport.profileType, "Transport");
  assert.match(transport.description, /transport capacity of 20 TYRANIDS INFANTRY/i);
});

test("sheets apply bearer Toughness additions from selected wargear", () => {
  const sheets = buildRosterSheets({
    rosterEntries: [{
      instanceId: "battlewagon-1",
      name: "Battlewagon",
      configured: {
        units: [{ name: "Battlewagon", characteristics: { T: "10" } }],
        weapons: [],
        abilities: [],
        rules: []
      }
    }],
    enhancements: [{
      bearerInstanceId: "battlewagon-1",
      profiles: [{ characteristics: { Description: "Add 2 to the bearer's Toughness characteristic." } }]
    }]
  });

  assert.equal(sheets.combinedUnitSheets[0].statlines[0].characteristics.T, "12");
});

test("detachment invulnerable saves only apply to the named units", () => {
  const rule = {
    sourceKind: "detachment",
    description: "Friendly TYRANID WARRIORS/TYRANID PRIME WITH LASH WHIP/WINGED TYRANID PRIME models from your army have 5+ InSv."
  };
  const sheets = buildRosterSheets({
    rosterEntries: [{
      instanceId: "warriors",
      name: "Tyranid Warriors with Ranged Bio-Weapons",
      keywords: ["Tyranid Warriors"],
      configured: { units: [{ name: "Tyranid Warrior", characteristics: { InSv: "-" } }], weapons: [], abilities: [], rules: [] }
    }, {
      instanceId: "gaunts",
      name: "Termagants",
      keywords: ["Infantry"],
      configured: { units: [{ name: "Termagant", characteristics: { InSv: "-" } }], weapons: [], abilities: [], rules: [] }
    }],
    detachments: [{ id: "warriors", name: "Warrior Bioform Onslaught", rules: [rule] }]
  });
  const warriors = sheets.combinedUnitSheets.find(sheet => sheet.title === "Tyranid Warriors with Ranged Bio-Weapons");
  const gaunts = sheets.combinedUnitSheets.find(sheet => sheet.title === "Termagants");
  assert.equal(warriors.statlines[0].characteristics.InSv, "5+");
  assert.equal(gaunts.statlines[0].characteristics.InSv, "-");
});

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

test("printable sheets infer invulnerable saves split across ability name and value", () => {
  const sheets = buildRosterSheets({
    name: "Bladeguard Test",
    pointsLimit: 1000,
    totalPoints: 90,
    rosterEntries: [{
      instanceId: "bladeguard-1",
      name: "Bladeguard Veteran Squad",
      points: 90,
      keywords: ["Infantry"],
      unitSize: { current: 3 },
      configured: {
        units: [
          { name: "Bladeguard Veteran", count: 2, characteristics: { M: "6\"", T: "4", SV: "3+", W: "3", LD: "6+", OC: "1", InSv: "" } },
          { name: "Bladeguard Veteran Sergeant", count: 1, characteristics: { M: "6\"", T: "4", SV: "3+", W: "3", LD: "6+", OC: "1", InSv: "" } }
        ],
        weapons: [],
        abilities: [
          { name: "Bladeguard", characteristics: { Description: "Each time an invulnerable saving throw is made for a model in this unit, re-roll a saving throw of 1." } },
          { name: "Invulnerable Save", characteristics: { Description: "4+" } }
        ],
        rules: []
      }
    }]
  });

  assert.deepEqual(sheets.combinedUnitSheets[0].statlines.map(profile => profile.characteristics.InSv), ["4+", "4+"]);
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

test("unit sheets apply detachment and attached leader weapon effects", () => {
  const sheets = buildRosterSheets({
    name: "Buff Test",
    pointsLimit: 1000,
    totalPoints: 200,
    detachments: [{
      id: "warhorde",
      name: "War Horde",
      rules: [{
        name: "Get Stuck In",
        description: "Melee weapons equipped by Orks models from your army have the [Sustained Hits 1] ability."
      }]
    }],
    rosterEntries: [{
      instanceId: "bodyguard-1",
      name: "Battle Sisters Squad",
      points: 100,
      keywords: ["Infantry"],
      configured: {
        units: [],
        weapons: [
          { name: "Boltgun", typeName: "Ranged Weapons", count: 10, characteristics: { Range: "24\"", A: "2", BS: "3+", S: "4", AP: "0", D: "1" } },
          { name: "Close combat weapon", typeName: "Melee Weapons", count: 10, characteristics: { A: "1", WS: "4+", S: "3", AP: "0", D: "1" } }
        ],
        abilities: [],
        rules: []
      }
    }, {
      instanceId: "leader-1",
      name: "Palatine",
      points: 50,
      keywords: ["Character"],
      configured: {
        units: [],
        weapons: [{ name: "Palatine blade", typeName: "Melee Weapons", count: 1, characteristics: { A: "4", WS: "2+", S: "4", AP: "-2", D: "2" } }],
        abilities: [{
          name: "Righteous Rage",
          characteristics: { Description: "While this model is leading a unit, weapons equipped by models in that unit have [Lethal Hits]." }
        }],
        rules: []
      }
    }],
    groupedPresentation: [{
      id: "attached:bodyguard-1",
      kind: "attached",
      title: "Battle Sisters Squad + Palatine",
      totalPoints: 150,
      memberInstanceIds: ["bodyguard-1", "leader-1"],
      warnings: []
    }]
  });

  const sheet = sheets.combinedUnitSheets[0];
  assert.equal(sheet.rangedWeapons[0].keywords, "LH");
  assert.deepEqual(sheet.meleeWeapons.map(item => [item.name, item.keywords]), [
    ["Close combat weapon", "SH1, LH"],
    ["Palatine blade", "SH1, LH"]
  ]);
});

test("unit sheets ignore detachment weapon glossary examples when applying effects", () => {
  const sheets = buildRosterSheets({
    name: "War Horde Test",
    pointsLimit: 1000,
    totalPoints: 240,
    detachments: [{
      id: "warhorde",
      name: "War Horde",
      rules: [{
        name: "Get Stuck In",
        description: "Melee weapons equipped by ORKS models from your army have the [SUSTAINED HITS 1] ability."
      }, {
        name: "Sustained Hits",
        description: "This ability always takes the form [SUSTAINED HITS X]. Example: An attack made with a [SUSTAINED HITS 2] weapon results in a critical hit."
      }]
    }],
    rosterEntries: [{
      instanceId: "boyz-1",
      name: "Boyz",
      points: 240,
      keywords: ["Orks", "Infantry"],
      configured: {
        units: [],
        weapons: [
          { name: "Slugga", typeName: "Ranged Weapons", count: 17, characteristics: { Range: "12\"", A: "1", BS: "5+", S: "4", AP: "0", D: "1", Keywords: "Pistol" } },
          { name: "Choppa", typeName: "Melee Weapons", count: 17, characteristics: { Range: "Melee", A: "3", WS: "3+", S: "4", AP: "-1", D: "1", Keywords: "-" } }
        ],
        abilities: [],
        rules: []
      }
    }]
  });

  const sheet = sheets.combinedUnitSheets[0];
  assert.equal(sheet.rangedWeapons[0].keywords, "Pistol");
  assert.equal(sheet.meleeWeapons[0].keywords, "SH1");
});

test("unit sheets ignore detachment keyword glossary rules when applying effects", () => {
  const sheets = buildRosterSheets({
    name: "Montka Glossary Test",
    pointsLimit: 1000,
    totalPoints: 100,
    detachments: [{
      id: "montka",
      name: "Mont'ka",
      rules: [{
        name: "Killing Blow",
        description: "During the first, second and third battle rounds, ranged weapons equipped by T'AU EMPIRE models from your army have the [ASSAULT] ability. During the first, second and third battle rounds, while a unit is a Guided unit (see For the Greater Good), its ranged weapons have the [LETHAL HITS] ability."
      }, {
        name: "Assault",
        description: "Units containing one or more models with an **[ASSAULT]** weapon can shoot using assault shooting."
      }, {
        name: "Lethal Hits",
        description: "Each time an attack made with a **[LETHAL HITS]** weapon results in a critical hit, you can choose for that attack to automatically wound the target. You may decide against this, as it means that attack cannot result in a critical wound and so cannot trigger other abilities such as [DEVASTATING WOUNDS]."
      }]
    }],
    rosterEntries: [{
      instanceId: "fire-warriors-1",
      name: "Strike Team",
      points: 100,
      keywords: ["T'au Empire", "Infantry"],
      configured: {
        units: [],
        weapons: [
          { name: "Pulse rifle", typeName: "Ranged Weapons", count: 10, characteristics: { Range: "30\"", A: "1", BS: "4+", S: "5", AP: "0", D: "1", Keywords: "-" } },
          { name: "Close combat weapon", typeName: "Melee Weapons", count: 10, characteristics: { Range: "Melee", A: "1", WS: "5+", S: "3", AP: "0", D: "1", Keywords: "-" } }
        ],
        abilities: [],
        rules: []
      }
    }]
  });

  const sheet = sheets.combinedUnitSheets[0];
  assert.equal(sheet.rangedWeapons[0].keywords, "");
  assert.equal(sheet.meleeWeapons[0].keywords, "");
});

test("unit sheets do not auto-apply conditional aura weapon effects", () => {
  const sheets = buildRosterSheets({
    name: "Ghaz Aura Test",
    pointsLimit: 1000,
    totalPoints: 550,
    detachments: [{
      id: "warhorde",
      name: "War Horde",
      rules: [{
        name: "Get Stuck In",
        description: "Melee weapons equipped by ORKS models from your army have the [SUSTAINED HITS 1] ability."
      }]
    }],
    rosterEntries: [{
      instanceId: "nobz-1",
      name: "Nobz",
      points: 210,
      keywords: ["Orks", "Infantry"],
      configured: {
        units: [],
        weapons: [{ name: "Power klaw", typeName: "Melee Weapons", count: 10, characteristics: { Range: "Melee", A: "3", WS: "4+", S: "9", AP: "-2", D: "2", Keywords: "-" } }],
        abilities: [{ name: "Da Boss' Ladz", characteristics: { Description: "While a WARBOSS model is leading this unit, subtract 1 from the Wound roll." } }],
        rules: []
      }
    }, {
      instanceId: "painboy-1",
      name: "Painboy",
      points: 70,
      keywords: ["Orks", "Character", "Support"],
      configured: {
        units: [],
        weapons: [{ name: "Power klaw", typeName: "Melee Weapons", count: 1, characteristics: { Range: "Melee", A: "3", WS: "4+", S: "9", AP: "-2", D: "2", Keywords: "-" } }],
        abilities: [{ name: "Dok's Toolz", characteristics: { Description: "While this model is leading a unit, models in that unit have the Feel No Pain 5+ ability." } }],
        rules: []
      }
    }, {
      instanceId: "ghaz-1",
      name: "Ghazghkull Thraka",
      points: 270,
      keywords: ["Orks", "Character", "Epic Hero"],
      configured: {
        units: [],
        weapons: [{ name: "Gork's Klaw", typeName: "Melee Weapons", count: 1, characteristics: { Range: "Melee", A: "6", WS: "2+", S: "14", AP: "-3", D: "4", Keywords: "-" } }],
        abilities: [{
          name: "Ghazghkull's Waaagh! Banner (Aura)",
          characteristics: { Description: "While a friendly ORKS unit is within 12\" of Makari, if the Waaagh! is active for your army, melee weapons equipped by models in that unit have the [LETHAL HITS] ability." }
        }],
        rules: []
      }
    }],
    groupedPresentation: [{
      id: "attached:nobz-1",
      kind: "attached",
      title: "Nobz + Painboy + Ghazghkull Thraka",
      totalPoints: 550,
      memberInstanceIds: ["nobz-1", "painboy-1", "ghaz-1"],
      warnings: []
    }]
  });

  assert.deepEqual(sheets.combinedUnitSheets[0].meleeWeapons.map(item => [item.name, item.keywords]), [
    ["Power klaw", "SH1"],
    ["Power klaw", "SH1"],
    ["Gork's Klaw", "SH1"]
  ]);
});

test("unit sheets apply leading support armour penetration effects to melee weapons", () => {
  const sheets = buildRosterSheets({
    name: "Sanguinary Priest Test",
    pointsLimit: 1000,
    totalPoints: 160,
    rosterEntries: [{
      instanceId: "bodyguard-1",
      name: "Assault Intercessor Squad",
      points: 80,
      keywords: ["Infantry"],
      configured: {
        units: [],
        weapons: [
          { name: "Heavy bolt pistol", typeName: "Ranged Weapons", count: 5, characteristics: { Range: "18\"", A: "1", BS: "3+", S: "4", AP: "-1", D: "1" } },
          { name: "Astartes chainsword", typeName: "Melee Weapons", count: 5, characteristics: { A: "4", WS: "3+", S: "4", AP: "-1", D: "1" } }
        ],
        abilities: [],
        rules: []
      }
    }, {
      instanceId: "support-1",
      name: "Sanguinary Priest",
      points: 80,
      keywords: ["Character", "Support"],
      configured: {
        units: [],
        weapons: [{ name: "Astartes chainsword", typeName: "Melee Weapons", count: 1, characteristics: { A: "5", WS: "2+", S: "4", AP: "-1", D: "1" } }],
        abilities: [{
          name: "Blood Chalice",
          characteristics: { Description: "While this model is leading a unit, improve the Armour Penetration characteristic of melee weapons equipped by models in that unit by 1." }
        }],
        rules: []
      }
    }],
    groupedPresentation: [{
      id: "attached:bodyguard-1",
      kind: "attached",
      title: "Assault Intercessor Squad + Sanguinary Priest",
      totalPoints: 160,
      memberInstanceIds: ["bodyguard-1", "support-1"],
      warnings: []
    }]
  });

  const sheet = sheets.combinedUnitSheets[0];
  assert.equal(sheet.rangedWeapons[0].characteristics.AP, "-1");
  assert.deepEqual(sheet.meleeWeapons.map(item => [item.name, item.characteristics.AP]), [
    ["Astartes chainsword", "-2"],
    ["Astartes chainsword", "-2"]
  ]);
});

test("unit sheets apply attached epic bodyguard-only strength and toughness effects", () => {
  const sheets = buildRosterSheets({
    name: "Fabius Test",
    pointsLimit: 1000,
    totalPoints: 170,
    rosterEntries: [{
      instanceId: "bodyguard-1",
      name: "Legionaries",
      points: 90,
      keywords: ["Infantry"],
      configured: {
        units: [{ name: "Legionary", count: 5, characteristics: { M: "6\"", T: "4", SV: "3+", W: "2" } }],
        weapons: [
          { name: "Boltgun", typeName: "Ranged Weapons", count: 5, characteristics: { Range: "24\"", A: "2", BS: "3+", S: "4", AP: "0", D: "1" } },
          { name: "Astartes chainsword", typeName: "Melee Weapons", count: 5, characteristics: { A: "4", WS: "3+", S: "4", AP: "-1", D: "1" } }
        ],
        abilities: [],
        rules: []
      }
    }, {
      instanceId: "fabius-1",
      name: "Fabius Bile",
      points: 80,
      keywords: ["Epic Hero"],
      configured: {
        units: [{ name: "Fabius Bile", count: 1, characteristics: { M: "6\"", T: "4", SV: "3+", W: "5" } }],
        weapons: [{ name: "Rod of Torment", typeName: "Melee Weapons", count: 1, characteristics: { A: "5", WS: "2+", S: "5", AP: "-2", D: "2" } }],
        abilities: [{
          name: "Enhanced Warriors",
          characteristics: { Description: "If this unit is attached to a unit at the start of the battle, until the end of the battle, add 1 to the Strength characteristic of melee weapons equipped by Bodyguard models in that unit and add 1 to the Toughness characteristic of Bodyguard models in that unit." }
        }],
        rules: []
      }
    }],
    groupedPresentation: [{
      id: "attached:bodyguard-1",
      kind: "attached",
      title: "Legionaries + Fabius Bile",
      totalPoints: 170,
      memberInstanceIds: ["bodyguard-1", "fabius-1"],
      bodyguard: { instanceId: "bodyguard-1" },
      warnings: []
    }]
  });

  const sheet = sheets.combinedUnitSheets[0];
  assert.deepEqual(sheet.statlines.map(item => [item.name, item.characteristics.T]), [
    ["Legionary", "5"],
    ["Fabius Bile", "4"]
  ]);
  assert.deepEqual(sheet.rangedWeapons.map(item => [item.name, item.characteristics.S]), [["Boltgun", "4"]]);
  assert.deepEqual(sheet.meleeWeapons.map(item => [item.name, item.characteristics.S]), [
    ["Astartes chainsword", "5"],
    ["Rod of Torment", "5"]
  ]);
});

test("unit sheets apply static leader OC, weapon keyword, and attacks effects", () => {
  const sheets = buildRosterSheets({
    name: "Static Effect Test",
    pointsLimit: 1000,
    totalPoints: 150,
    rosterEntries: [{
      instanceId: "bodyguard-1",
      name: "Bodyguard Squad",
      points: 100,
      keywords: ["Infantry"],
      configured: {
        units: [{ name: "Bodyguard", count: 5, characteristics: { M: "6\"", T: "4", SV: "3+", W: "2", OC: "1" } }],
        weapons: [
          { name: "Ranged weapon", typeName: "Ranged Weapons", count: 5, characteristics: { Range: "24\"", A: "1", BS: "3+", S: "4", AP: "0", D: "1", Keywords: "-" } },
          { name: "Melee weapon", typeName: "Melee Weapons", count: 5, characteristics: { Range: "Melee", A: "1", WS: "3+", S: "4", AP: "0", D: "1", Keywords: "-" } }
        ],
        abilities: [],
        rules: []
      }
    }, {
      instanceId: "leader-1",
      name: "Static Leader",
      points: 50,
      keywords: ["Character"],
      configured: {
        units: [],
        weapons: [],
        abilities: [
          { name: "Astartes Banner", characteristics: { Description: "While this model is leading a unit, add 1 to the Objective Control characteristic of models in that unit." } },
          { name: "Vicious Insight", characteristics: { Description: "While this model is leading a unit, weapons equipped by models in that unit have the [DEVASTATING WOUNDS] ability." } },
          { name: "Volley Fire", characteristics: { Description: "While this model is leading a unit, add 1 to the Attacks characteristic of ranged weapons equipped by models in that unit." } }
        ],
        rules: []
      }
    }],
    groupedPresentation: [{
      id: "attached:bodyguard-1",
      kind: "attached",
      title: "Bodyguard Squad + Static Leader",
      totalPoints: 150,
      memberInstanceIds: ["bodyguard-1", "leader-1"],
      bodyguard: { instanceId: "bodyguard-1" },
      warnings: []
    }]
  });

  const sheet = sheets.combinedUnitSheets[0];
  assert.equal(sheet.statlines[0].characteristics.OC, "2");
  assert.equal(sheet.rangedWeapons[0].characteristics.A, "2");
  assert.equal(sheet.meleeWeapons[0].characteristics.A, "1");
  assert.equal(sheet.rangedWeapons[0].keywords, "DEV");
  assert.equal(sheet.meleeWeapons[0].keywords, "DEV");
});

test("unit sheets apply named weapon and unusual keyword effects narrowly", () => {
  const sheets = buildRosterSheets({
    name: "One-off Effect Test",
    pointsLimit: 1000,
    totalPoints: 200,
    rosterEntries: [{
      instanceId: "bodyguard-1",
      name: "Purifier Squad",
      points: 100,
      keywords: ["Infantry"],
      configured: {
        units: [],
        weapons: [
          { name: "Purifying Flame", typeName: "Ranged Weapons", count: 5, characteristics: { Range: "18\"", A: "1", BS: "3+", S: "4", AP: "0", D: "1", Keywords: "-" } },
          { name: "Storm bolter", typeName: "Ranged Weapons", count: 5, characteristics: { Range: "24\"", A: "2", BS: "3+", S: "4", AP: "0", D: "1", Keywords: "-" } },
          { name: "Force weapon", typeName: "Melee Weapons", count: 5, characteristics: { Range: "Melee", A: "3", WS: "3+", S: "6", AP: "-2", D: "2", Keywords: "-" } }
        ],
        abilities: [],
        rules: []
      }
    }, {
      instanceId: "leader-1",
      name: "One-off Leader",
      points: 100,
      keywords: ["Character"],
      configured: {
        units: [],
        weapons: [
          { name: "Purifying Flame", typeName: "Ranged Weapons", count: 1, characteristics: { Range: "18\"", A: "3", BS: "2+", S: "4", AP: "-2", D: "1", Keywords: "-" } }
        ],
        abilities: [{
          name: "Champion of the Order of Purifiers",
          characteristics: { Description: "While this model is leading a unit, add 1 to the Attacks characteristic of Purifying Flame weapons equipped by that unit." }
        }, {
          name: "Break the Foe",
          characteristics: { Description: "Melee weapons equipped by models in this unit have the [^^Sustained Hits 1^^] ability." }
        }, {
          name: "For the Khan",
          characteristics: { Description: "While this model is leading a unit, ranged weapons equipped by models in that unit have the [ASSAULT] ability and melee weapons equipped by models in that unit have the [LANCE] ability." }
        }, {
          name: "Might of Heroes",
          characteristics: { Description: "While this model is leading a unit, melee weapons equipped by models in that unit have the [PYSCHIC] ability." }
        }],
        rules: []
      }
    }],
    groupedPresentation: [{
      id: "attached:bodyguard-1",
      kind: "attached",
      title: "Purifier Squad + One-off Leader",
      totalPoints: 200,
      memberInstanceIds: ["bodyguard-1", "leader-1"],
      bodyguard: { instanceId: "bodyguard-1" },
      warnings: []
    }]
  });

  const sheet = sheets.combinedUnitSheets[0];
  assert.deepEqual(sheet.rangedWeapons.map(item => [item.name, item.characteristics.A, item.keywords]), [
    ["Purifying Flame", "2", "Assault"],
    ["Storm bolter", "2", "Assault"],
    ["Purifying Flame", "4", "Assault"]
  ]);
  assert.deepEqual(sheet.meleeWeapons.map(item => [item.name, item.keywords]), [
    ["Force weapon", "SH1, Lance, Psychic"]
  ]);
});

test("unit sheets apply static leader and detachment invulnerable save effects", () => {
  const sheets = buildRosterSheets({
    name: "Invulnerable Effect Test",
    pointsLimit: 1000,
    totalPoints: 150,
    detachments: [{
      id: "kroot",
      name: "Kroot Hunting Pack",
      rules: [{
        name: "Skirmish Fighters",
        description: "KROOT models from your army have a 6+ invulnerable save."
      }, {
        name: "Battle Round Shield",
        description: "During the first, second and third battle rounds, models from your army have a 4+ invulnerable save."
      }]
    }],
    rosterEntries: [{
      instanceId: "bodyguard-1",
      name: "Bodyguard Squad",
      points: 100,
      keywords: ["Infantry", "Kroot"],
      configured: {
        units: [{ name: "Bodyguard", count: 5, characteristics: { M: "6\"", T: "4", SV: "3+", W: "2", OC: "1", InSv: "" } }],
        weapons: [],
        abilities: [],
        rules: []
      }
    }, {
      instanceId: "leader-1",
      name: "Librarian",
      points: 50,
      keywords: ["Character"],
      configured: {
        units: [{ name: "Librarian", count: 1, characteristics: { M: "6\"", T: "4", SV: "3+", W: "4", OC: "1", InSv: "" } }],
        weapons: [],
        abilities: [{
          name: "Mental Fortress",
          characteristics: { Description: "While this model is leading a unit, models in that unit have a 4+ invulnerable save." }
        }],
        rules: []
      }
    }],
    groupedPresentation: [{
      id: "attached:bodyguard-1",
      kind: "attached",
      title: "Bodyguard Squad + Librarian",
      totalPoints: 150,
      memberInstanceIds: ["bodyguard-1", "leader-1"],
      bodyguard: { instanceId: "bodyguard-1" },
      warnings: []
    }]
  });

  const sheet = sheets.combinedUnitSheets[0];
  assert.deepEqual(sheet.statlines.map(profile => [profile.name, profile.characteristics.InSv]), [
    ["Bodyguard", "4+"],
    ["Librarian", "4+"]
  ]);
  assert.equal(sheets.crusadeSheets[0].statline.characteristics.InSv, "6+");
});

test("unit sheets apply static model characteristic set and improve effects", () => {
  const sheets = buildRosterSheets({
    name: "Model Stat Effect Test",
    pointsLimit: 1000,
    totalPoints: 200,
    rosterEntries: [{
      instanceId: "bodyguard-1",
      name: "Bodyguard Squad",
      points: 100,
      keywords: ["Infantry"],
      configured: {
        units: [{ name: "Bodyguard", count: 5, characteristics: { M: "6\"", T: "4", SV: "3+", W: "2", LD: "6+", OC: "1" } }],
        weapons: [],
        abilities: [],
        rules: []
      }
    }, {
      instanceId: "leader-1",
      name: "Stat Leader",
      points: 100,
      keywords: ["Character"],
      configured: {
        units: [{ name: "Stat Leader", count: 1, characteristics: { M: "6\"", T: "4", SV: "3+", W: "4", LD: "6+", OC: "1" } }],
        weapons: [],
        abilities: [
          { name: "Fast", characteristics: { Description: "While this model is leading a unit, models in that unit have a Move characteristic of 12\"." } },
          { name: "Armoured", characteristics: { Description: "While this model is leading a unit, models in that unit have a Save characteristic of 2+." } },
          { name: "Officer", characteristics: { Description: "While this model is leading a unit, add 1 to the Leadership characteristic of models in that unit." } },
          { name: "Veteran", characteristics: { Description: "While this model is leading a unit, improve the Objective Control characteristic of models in that unit by 1." } }
        ],
        rules: []
      }
    }],
    groupedPresentation: [{
      id: "attached:bodyguard-1",
      kind: "attached",
      title: "Bodyguard Squad + Stat Leader",
      totalPoints: 200,
      memberInstanceIds: ["bodyguard-1", "leader-1"],
      bodyguard: { instanceId: "bodyguard-1" },
      warnings: []
    }]
  });

  assert.deepEqual(sheets.combinedUnitSheets[0].statlines.map(profile => [profile.name, profile.characteristics.M, profile.characteristics.SV, profile.characteristics.LD, profile.characteristics.OC]), [
    ["Bodyguard", "12\"", "2+", "7+", "2"],
    ["Stat Leader", "12\"", "2+", "7+", "2"]
  ]);
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
