
"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm");
const server = require("../src/domain/loadout"), pricing = require("../src/domain/pricing"), army = require("../src/domain/army"), docs = require("../src/domain/roster-document"), share = require("../src/domain/roster-share-code");
const window = {};
vm.runInNewContext(fs.readFileSync(require.resolve("../ui/engine-data-manifest.js"), "utf8"), {window});
vm.runInNewContext(fs.readFileSync(require.resolve("../ui/engine-data/imperium-adepta-sororitas.js"), "utf8"), {window});
vm.runInNewContext(fs.readFileSync(require.resolve("../ui/engine-runtime.js"), "utf8"), {window});
const faction = "Imperium - Adepta Sororitas", packages = window.ROSTER_ENGINE_FACTIONS[faction];
const dominions = packages.find(u => u.name === "Dominion Squad");
function configured(engine = server) {
  let entry = engine.createDefaultRosterEntry(dominions.definition);
  entry = engine.setSelection(dominions.definition, entry, engine.getOptionStates(dominions.definition, entry).find(o => o.name === "Dominion w/ Special Weapon").id, 4);
  entry = engine.setSelection(dominions.definition, entry, engine.getOptionStates(dominions.definition, entry).find(o => o.name === "Ministorum Flamer").id, 4);
  const pool = engine.getSplitModelPool(dominions.definition, entry);
  const aModels = pool.map((m,i) => /Flamer/.test(m.equipment.join()) ? i : -1).filter(i => i >= 0);
  aModels.push(0);
  const a = { ...structuredClone(entry), instanceId: "a", split: { groupId:"a", label:1, half:"A", aModels, cherubHalf:"A", transportId:"transport", embarkedHalf:"B" } };
  const b = structuredClone(a); b.instanceId="b"; b.split.half="B";
  return { entry, a, b, pool };
}
for (const [name, engine] of [["server", server],["browser", window.RosterEngine]]) {
  test(name + ": halves conserve equipped models, weapons, points and a single Cherub", () => {
    const {entry,a,b,pool} = configured(engine);
    assert.equal(pool.length,10);
    assert.equal(engine.getUnitSizeState(dominions.definition,a).current,5);
    assert.equal(engine.getUnitSizeState(dominions.definition,b).current,5);
    const weapons = x => engine.getConfiguredProfiles(dominions.definition,x).weapons;
    assert.equal(weapons(a).find(w => /flamer/i.test(w.name)).count,4);
    assert(!weapons(b).some(w => /flamer/i.test(w.name)));
    for (const weapon of weapons(entry)) {
      const count = [a,b].flatMap(weapons).filter(w => w.id === weapon.id).reduce((n,w) => n+w.count,0);
      assert.equal(count,weapon.count,weapon.name);
    }
    assert(!engine.getConfiguredProfiles(dominions.definition,b).abilities.some(p => /cherub/i.test(p.name)));
    assert.equal(engine.validateLoadout(dominions.definition,a).length,0);
    const calculate = name === "server" ? pricing.calculateEntryPoints : engine.calculateEntryPoints;
    assert.equal(calculate(dominions.definition,a).points+calculate(dominions.definition,b).points,calculate(dominions.definition,entry).points);
    assert.equal(engine.getUnitSizeState(dominions.definition,engine.normalizeRosterEntry(dominions.definition,a)).current,5);
    b.split.aModels=[0];
    assert(engine.validateLoadout(dominions.definition,b).some(e => e.code==="SPLIT_SIZE_INVALID"));
  });
}
test("different special weapons remain with individual models",()=>{
  let {entry}=configured();
  const opts=server.getOptionStates(dominions.definition,entry);
  entry=server.setSelection(dominions.definition,entry,opts.find(o=>o.name==="Meltagun").id,2);
  const pool=server.getSplitModelPool(dominions.definition,entry).filter(m=>/Special Weapon/.test(m.name));
  assert.equal(pool.filter(m=>/Meltagun/.test(m.equipment.join())).length,2);
  assert.equal(pool.filter(m=>/Flamer/.test(m.equipment.join())).length,2);
  assert(pool.every(m=>!(m.equipment.some(e=>/Meltagun/.test(e))&&m.equipment.some(e=>/Flamer/.test(e)))));
});
test("split squad links, transport and leaders survive document hydration and sharing",()=>{
  const {a,b}=configured();
  const immolator=packages.find(u=>u.name==="Immolator"), leader=packages.find(u=>u.name==="Junith Eruita");
  const records=[{instanceId:"a",unitPackage:dominions,entry:a},{instanceId:"b",unitPackage:dominions,entry:b},
    {instanceId:"transport",unitPackage:immolator,entry:{...structuredClone(immolator.defaultEntry),instanceId:"transport"}},
    {instanceId:"leader",unitPackage:leader,entry:{...structuredClone(leader.defaultEntry),instanceId:"leader"}}];
  const state={...army.createArmyState(window.ROSTER_ENGINE_DATA.armies[faction]),attachments:[{leaderInstanceId:"leader",targetInstanceId:"b"}]};
  const doc=docs.createRosterDocument({faction,subfaction:faction,armyState:state,rosterEntries:records,services:{
    configuredProfiles:server.getConfiguredProfiles,configuredModels:server.getConfiguredModels,unitSizeState:server.getUnitSizeState,configuredUnitName:server.getConfiguredUnitName
  }});
  const hydrated=docs.hydrateRosterDocument(doc,{unitPackages:packages,normalizeRosterEntry:server.normalizeRosterEntry,unitSizeState:server.getUnitSizeState});
  assert.deepEqual(hydrated.roster[0].entry.split,a.split);
  assert.equal(server.getConfiguredModels(dominions.definition,hydrated.roster[0].entry).reduce((n,m)=>n+m.count,0),5);
  const context={faction,subfaction:faction,factionIds:[faction],unitPackages:packages,armyDefinition:window.ROSTER_ENGINE_DATA.armies[faction]};
  const decoded=share.decodeRoster(share.encodeRoster(doc,context),context);
  assert.equal(decoded.rosterEntries[0].entry.split.groupId,decoded.rosterEntries[0].instanceId);
  assert.equal(decoded.rosterEntries[1].entry.split.transportId,decoded.rosterEntries[2].instanceId);
  assert.equal(decoded.armyState.attachments[0].targetInstanceId,decoded.rosterEntries[1].instanceId);
  const presentation=army.getRosterPresentation(context.armyDefinition,state,records);
  assert(presentation.find(g=>g.memberInstanceIds.includes("b")).title.includes("Squad 1B"));
  assert(!presentation.find(g=>g.memberInstanceIds.includes("a")).memberInstanceIds.includes("leader"));
});
test("split halves count as one purchased copy",()=>{
  const {a,b}=configured();
  const entries=Array.from({length:3},(_,i)=>[
    {instanceId:"a"+i,unitPackage:dominions,entry:{...a,instanceId:"a"+i}},
    {instanceId:"b"+i,unitPackage:dominions,entry:{...b,instanceId:"b"+i}}
  ]).flat();
  const result=army.validateRosterLegality(window.ROSTER_ENGINE_DATA.armies[faction],{},entries);
  assert(!result.warnings.some(w=>w.code==="UNIT_COPY_LIMIT_EXCEEDED"));
});
for(const file of ["ui/engine-app.js","mobile/ui/engine-app.js"])test(file+": weapon hovers omit full keyword rules",()=>{
  const source=fs.readFileSync(require.resolve("../"+file),"utf8");
  const start=source.indexOf("function renderOptionNamePreview("),end=source.indexOf("function weaponProfilesForOptionNode(",start);
  const c={weaponProfilesForOptionNode:()=>[{name:"Combi-weapon"}],renderWeaponOptionName:()=>"<compact>"};vm.runInNewContext(source.slice(start,end),c);
  assert.equal(c.renderOptionNamePreview("Combi-weapon"),"<compact>");
});

test("Aestred buffs the flamer half without leaking into Junith's half",()=>{
  const {a,b}=configured();
  const aestred=packages.find(u=>/Aestred Thurga/.test(u.name)),junith=packages.find(u=>u.name==="Junith Eruita");
  const records=[{instanceId:"a",unitPackage:dominions,entry:a},{instanceId:"b",unitPackage:dominions,entry:b},
    ...[[aestred,"aestred"],[junith,"junith"]].map(([u,id])=>({instanceId:id,unitPackage:u,entry:{...structuredClone(u.defaultEntry),instanceId:id}}))];
  const state={attachments:[{leaderInstanceId:"aestred",targetInstanceId:"a"},{leaderInstanceId:"junith",targetInstanceId:"b"}]};
  const grouped=army.getRosterPresentation(window.ROSTER_ENGINE_DATA.armies[faction],state,records);
  const doc=docs.createRosterDocument({faction,armyState:state,rosterEntries:records,groupedPresentation:grouped,services:{configuredProfiles:server.getConfiguredProfiles,configuredModels:server.getConfiguredModels,configuredUnitName:server.getConfiguredUnitName,unitSizeState:server.getUnitSizeState}});
  const sheets=require("../src/domain/sheets").buildRosterSheets(doc).combinedUnitSheets;
  const first=sheets.find(s=>s.memberInstanceIds.includes("a"));
  const second=sheets.find(s=>s.memberInstanceIds.includes("b"));
  const flamer=first.rangedWeapons.find(w=>/ministorum flamer/i.test(w.name));
  assert(flamer,"four allocated flamers appear on the A sheet");
  assert.match(JSON.stringify(flamer),/Devastating Wounds/i);
  assert.doesNotMatch(JSON.stringify(second.rangedWeapons),/Devastating Wounds/i);
});
test("the split editor creates two linked entries, flags capacity and reunites safely",()=>{
  const source=fs.readFileSync(require.resolve("../mobile/ui/engine-app.js"),"utf8");
  const {entry}=configured(),unit={instanceId:"squad",unitPackage:dominions,entry};
  const immolator=packages.find(u=>u.name==="Immolator"),u={instanceId:"transport",unitPackage:immolator,entry:structuredClone(immolator.defaultEntry)};
  const context={engine:server,roster:[unit,u],armyState:{attachments:[]},armyEngine:army,selectedInstanceId:null,selectedPanel:null,
    createRosterEntry:p=>({instanceId:"half-b",unitPackage:p,entry:{}})};
  vm.runInNewContext(source.slice(0,source.indexOf("const engineData")),context);
  context.createSplitSquad(unit,"transport");
  assert.equal(context.roster.length,3);
  assert.equal(context.roster[1].entry.split.half,"B");
  assert.equal(context.splitSquadWarnings().length,0);
  const aestred=packages.find(u=>/Aestred Thurga/.test(u.name));
  context.roster.push({instanceId:"aestred",unitPackage:aestred,entry:structuredClone(aestred.defaultEntry)});
  context.armyState.attachments=[{leaderInstanceId:"aestred",targetInstanceId:"half-b"}];
  assert(context.splitSquadWarnings().some(w=>/7 models/.test(w.text)));
  context.armyState.attachments=[{leaderInstanceId:"aestred",targetInstanceId:"squad"}];
  assert.equal(context.splitSquadWarnings().length,0);
  context.reuniteSplitSquad(unit);
  assert.equal(context.roster.length,3);
  assert.equal(context.roster[0].entry.split,undefined);
  assert.equal(context.armyState.attachments.length,0);
  assert.equal(server.getUnitSizeState(dominions.definition,context.roster[0].entry).current,10);
});
