"use strict";
const fs = require("node:fs");
const FACTION = "Imperium - Adeptus Custodes";
const normalize = value => String(value || "").toLowerCase().replace(/^faction:\s*/, "").replace(/[^a-z0-9]+/g, " ").trim();
const unitName = value => normalize(String(value || "").replace(/\[Legends\]/gi, ""));
const slug = value => normalize(value).replace(/ /g, "-");
function readCustodesCodex(file) {
  if (!file) return null;
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  if (data.schemaVersion !== 1 || data.units?.length !== 31 || data.detachments?.length !== 13 || data.detachments.reduce((n,d)=>n+d.stratagems.length,0)!==41 || data.detachments.reduce((n,d)=>n+d.enhancements.length,0)!==29) throw new Error("Incomplete Custodes codex source");
  return data;
}
function eligible(unit, enhancement) {
  if (unit.roles.epicHero || /\[Legends\]/i.test(unit.name)) return false;
  if (enhancement.kind !== "upgrade" && !unit.roles.character) return false;
  const tags = new Set(unit.keywords.map(normalize));
  const e = enhancement.eligibility;
  return e.allKeywords.every(k=>tags.has(normalize(k)))
    && (!e.anyKeywords.length || e.anyKeywords.some(k=>tags.has(normalize(k))))
    && !e.excludeKeywords.some(k=>tags.has(normalize(k)))
    && (!e.unitNames.length || e.unitNames.some(n=>normalize(n)===normalize(unit.name)));
}
function applyCustodesCodex(units, armies, source, rulesetId) {
  if (!source) return {units, armies, summary:{applied:false}};
  const definitions = structuredClone(source.units).map(u=>({...u,rulesetId}));
  const byName = new Map(definitions.map(u=>[unitName(u.name),u]));
  for (const unit of definitions) {
    unit.rosterRules.leaderTargetSelectionKeys = (unit.rosterRules.leaderTargetNames || []).map(n=>byName.get(unitName(n))?.selectionKey).filter(Boolean);
  }
  const armiesNext = armies.map(army=> {
    if (army.faction !== FACTION) return army;
    const detachments = source.detachments.map(d=> {
      const choices = d.forceDispositions.map(name=> {
        const match = army.forceDispositions.find(x=>normalize(x.name)===normalize(name));
        if (!match) throw new Error("Missing Custodes disposition " + name);
        return {id:match.id,name:match.name};
      });
      return {id:d.id,name:d.name,points:0,detachmentPoints:d.detachmentPoints,forceDisposition:choices[0],forceDispositions:choices,uniqueTags:d.uniqueTags,
        rules:d.rules.map((r,i)=>({...r,id:d.id+"-rule-"+i,source:source.source})),
        stratagems:d.stratagems.map((s,i)=>({...s,id:d.id+"-stratagem-"+i,type:d.name+" Stratagem",turn:/opponent/i.test(s.when)?"Opponent's turn":/your/i.test(s.when)?"Your turn":"",legend:"",scope:"detachment",detachment:d.name,source:source.source,sourceUrl:null})),
        rulesSource:source.source,detachmentPointsSource:source.pointsSource,forceDispositionSource:source.pointsSource};
    });
    const enhancements = source.detachments.flatMap(d=>d.enhancements.map(e=> {
      const id=d.id+"-enhancement-"+slug(e.name);
      return {id,name:e.name,kind:e.kind,maxSelections:e.maxSelections,points:e.points,detachmentIds:[d.id],eligibleSelectionKeys:definitions.filter(u=>eligible(u,e)).map(u=>u.selectionKey),profiles:[{id:id+"-ability",name:e.name,typeName:"Abilities",characteristics:{Description:e.description},source:source.source},...(e.weaponProfiles || []).map((p,i)=>({...p,id:id+"-weapon-"+i,source:source.source}))],rules:[],source:source.source,pointsSource:source.pointsSource};
    }));
    return {...army,allowedSelectionKeys:definitions.map(u=>u.selectionKey),detachments,enhancements,armyRules:source.armyRules.map(r=>({...r,id:"custodes-army-"+slug(r.name),source:source.source})),armyRuleSource:source.source,custodesCodexSource:{date:source.lastUpdated,mfmVersion:source.mfmVersion,source:source.source,pointsSource:source.pointsSource}};
  });
  return {units:[...units.filter(u=>u.faction!==FACTION),...definitions],armies:armiesNext,summary:{applied:true,units:definitions.filter(u=>!/\[Legends\]/i.test(u.name)).length,legends:definitions.filter(u=>/\[Legends\]/i.test(u.name)).length,detachments:13,enhancements:29,stratagems:41,date:source.lastUpdated}};
}
module.exports = {readCustodesCodex,applyCustodesCodex};
