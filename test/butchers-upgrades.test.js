
"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm");
function equalJSON(actual,expected){assert.equal(JSON.stringify(actual),JSON.stringify(expected));}
const serverArmy=require("../src/domain/army"),serverSheets=require("../src/domain/sheets"),loadout=require("../src/domain/loadout"),docs=require("../src/domain/roster-document");
const window={};
for(const file of ["ui/engine-data-manifest.js","ui/engine-data/chaos-world-eaters.js","src/domain/army.js","src/domain/sheets.js"])
 vm.runInNewContext(fs.readFileSync(require.resolve("../"+file),"utf8"),{window,structuredClone});
const army=window.ROSTER_ENGINE_DATA.armies["Chaos - World Eaters"],unit=window.ROSTER_ENGINE_FACTIONS["Chaos - World Eaters"].find(u=>u.name==="Chaos Terminators");
const gore=army.enhancements.find(e=>/Gore.stained Veterans/i.test(e.name)),sanctified=army.enhancements.find(e=>e.name==="Sanctified in Slaughter"),detachment=army.detachments.find(d=>d.name==="Butchers of Khorne");
function record(id){return {instanceId:id,unitPackage:unit,entry:{...loadout.createDefaultRosterEntry(unit.definition),instanceId:id}};}
for(const [runtime,armyEngine,sheets] of [["server",serverArmy,serverSheets],["browser",window.ArmyEngine,window.RosterSheets]]){
 test(runtime+": Butchers upgrades improve only the requested stats and recalculate without stacking",()=>{
  const entry=record("term-1"),base=loadout.getConfiguredProfiles(unit.definition,entry.entry),context={instanceId:entry.instanceId};
  const buffed=sheets.applyWeaponEffectsToConfigured(base,[{...gore,bearerInstanceId:entry.instanceId}],context);
  for(const weapon of buffed.weapons){
   const original=base.weapons.find(w=>w.id===weapon.id);
   if(weapon.typeName==="Melee Weapons"){
    assert.equal(weapon.characteristics.WS,Math.max(2,Number(original.characteristics.WS.replace("+",""))-1)+"+");
    assert(weapon.modifiedCharacteristics.includes("WS"));
   }else equalJSON(weapon.characteristics,original.characteristics);
  }
  const buffedUnits=sheets.applyUnitEffectsToProfiles(base.units,[sanctified],context);
  for(let i=0;i<base.units.length;i++){
   assert.equal(Number(buffedUnits[i].characteristics.OC),Number(base.units[i].characteristics.OC)+1);
   assert(buffedUnits[i].modifiedCharacteristics.includes("OC"));
  }
  const reloaded=JSON.parse(JSON.stringify(buffedUnits));
  const repeated=sheets.applyUnitEffectsToProfiles(reloaded,[sanctified],context);
  equalJSON(repeated.map(p=>p.characteristics.OC),buffedUnits.map(p=>p.characteristics.OC));
  const removed=sheets.applyUnitEffectsToProfiles(reloaded,[],context);
  equalJSON(removed.map(p=>p.characteristics.OC),base.units.map(p=>p.characteristics.OC));
  const melee=sheets.applyWeaponEffectsToConfigured(JSON.parse(JSON.stringify(buffed)),[gore],context);
  equalJSON(melee.weapons.map(w=>w.characteristics.WS),buffed.weapons.map(w=>w.characteristics.WS));
 });
 test(runtime+": one upgrade per unit is enforced while the same upgrade can be used on another unit",()=>{
  const roster=[record("term-1"),record("term-2")];
  let state=armyEngine.selectDetachment(army,armyEngine.createArmyState(army),detachment.id);
  state=armyEngine.setEnhancement(army,state,roster,gore.id,"term-1",true);
  const before=JSON.stringify(state);
  state=armyEngine.setEnhancement(army,state,roster,sanctified.id,"term-1",true);
  assert.equal(JSON.stringify(state),before);
  const choices=armyEngine.getEnhancementStates(army,state,roster);
  assert.equal(choices.find(e=>e.id===sanctified.id).bearerOptions.find(e=>e.instanceId==="term-1").blockedByEnhancementId,gore.id);
  assert.equal(choices.find(e=>e.id===sanctified.id).bearerOptions.find(e=>e.instanceId==="term-2").blockedByEnhancementId,null);
  state=armyEngine.setEnhancement(army,state,roster,gore.id,"term-2",true);
  assert.equal(state.enhancements.length,2);
  state=armyEngine.setEnhancement(army,state,roster,gore.id,"term-1",false);
  state=armyEngine.setEnhancement(army,state,roster,sanctified.id,"term-1",true);
  assert.equal(state.enhancements.length,2);
  assert.equal(armyEngine.calculateArmyOptionPoints(army,state),gore.points+sanctified.points);
  const legacy={...state,enhancements:[...state.enhancements,{enhancementId:gore.id,bearerInstanceId:"term-1"}]};
  assert(armyEngine.validateRosterLegality(army,legacy,roster).warnings.some(w=>w.code==="BEARER_HAS_MULTIPLE_ENHANCEMENTS"));
  const corrected=armyEngine.setEnhancement(army,legacy,roster,gore.id,"term-1",false);
  assert.equal(corrected.enhancements.filter(e=>e.bearerInstanceId==="term-1").length,1);
 });
 test(runtime+": roster snapshots and printed sheets keep OC at +1 and WS at +1 without affecting another unit",()=>{
  const roster=[record("gore-unit"),record("oc-unit"),record("plain-unit")];
  let state=armyEngine.selectDetachment(army,armyEngine.createArmyState(army),detachment.id);
  state=armyEngine.setEnhancement(army,state,roster,gore.id,"gore-unit",true);
  state=armyEngine.setEnhancement(army,state,roster,sanctified.id,"oc-unit",true);
  const group=armyEngine.getRosterPresentation(army,state,roster);
  const document=docs.createRosterDocument({faction:army.faction,armyDefinition:army,armyState:state,rosterEntries:roster,groupedPresentation:group,services:{
   configuredProfiles:(definition,entry,item)=>{
    const configured=loadout.getConfiguredProfiles(definition,entry);
    const effects=(state.enhancements||[]).filter(a=>a.bearerInstanceId===item.instanceId).map(a=>({...army.enhancements.find(e=>e.id===a.enhancementId),bearerInstanceId:a.bearerInstanceId}));
    return {...sheets.applyWeaponEffectsToConfigured(configured,effects,{instanceId:item.instanceId}),units:sheets.applyUnitEffectsToProfiles(configured.units,effects,{instanceId:item.instanceId})};
   },configuredModels:loadout.getConfiguredModels,unitSizeState:loadout.getUnitSizeState
  }});
  const packet=sheets.buildRosterSheets(JSON.parse(JSON.stringify(document)));
  const oc=packet.combinedUnitSheets.find(s=>s.memberInstanceIds.includes("oc-unit"));
  const plain=packet.combinedUnitSheets.find(s=>s.memberInstanceIds.includes("plain-unit"));
  const goreSheet=packet.combinedUnitSheets.find(s=>s.memberInstanceIds.includes("gore-unit"));
  assert(oc.statlines.every(p=>p.characteristics.OC==="2"));
  assert(plain.statlines.every(p=>p.characteristics.OC==="1"));
  assert(goreSheet.meleeWeapons.every(w=>w.characteristics.WS==="2+"));
  assert(plain.meleeWeapons.every(w=>w.characteristics.WS==="3+"));
 });
}

for(const file of ["ui/engine-app.js","mobile/ui/engine-app.js"])test(file+": a second upgrade is visibly disabled while the selected upgrade can be removed",()=>{
 const roster=[record("unit-1")];
 let state=serverArmy.selectDetachment(army,serverArmy.createArmyState(army),detachment.id);
 state=serverArmy.setEnhancement(army,state,roster,gore.id,"unit-1",true);
 const source=fs.readFileSync(require.resolve("../"+file),"utf8"),start=source.indexOf("function renderUnitAssignments("),end=source.indexOf("function leaderAssignmentLabel(",start);
 const context={roster,armyState:state,armyEngine:serverArmy,currentArmyDefinition:()=>army,
  escapeHtml:String,disclosureOpenAttribute:()=>"",leaderAssignmentLabel:()=>"",
  renderEnhancementAssignmentDetails:()=>"",renderRosterUnitOptions:()=>""};
 vm.runInNewContext(source.slice(start,end),context);
 const html=context.renderUnitAssignments(roster[0]);
 const input=id=>html.match(new RegExp('<input class="enhancementToggle"[^>]*data-enhancement-id="'+id+'"[^>]*>'))?.[0];
 assert.match(input(sanctified.id),/disabled/);
 assert.match(input(sanctified.id),/remove it first/);
 assert.match(input(gore.id),/checked/);
 assert.doesNotMatch(input(gore.id),/disabled/);
});
