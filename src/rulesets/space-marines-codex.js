"use strict";
const fs = require("node:fs");
const { limiterMatchesUnit, tagsForUnit } = require("./enhancement-eligibility");
const PREFIX = "Imperium - Adeptus Astartes";
const normalize = value => String(value || "").toLowerCase().replace(/[’']/g, "").replace(/\s*\((?:upgrade|aura)\)/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const slug = value => normalize(value).replace(/ /g, "-");
function readSpaceMarinesCodex(filePath) {
  if (!filePath) return { detachments: [], issues: [] };
  try {
    const doc = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (doc.schemaVersion !== 1 || doc.detachments?.length !== 15 || !doc.armyRules?.length) throw Error("Incomplete Space Marine codex source");
    return { ...doc, issues: [] };
  } catch (error) {
    return { detachments: [], issues: [{code:"space-marines-codex-invalid",severity:"error",filePath,message:error.message}] };
  }
}
function isMarine(faction) { return faction === PREFIX || faction.startsWith(PREFIX + " - "); }
function dispositions(army, names) {
  return names.map(name => {
    const found = (army.forceDispositions || []).find(item => normalize(item.name) === normalize(name));
    if (!found) throw Error("Missing Space Marine force disposition: " + name);
    return { id: found.id, name: found.name };
  });
}
function profiles(enhancement, id, source) {
  return [{ id:id + "-ability",name:enhancement.name,typeName:"Abilities",characteristics:{Description:enhancement.description},source },
    ...(enhancement.weaponProfile ? [{...enhancement.weaponProfile,id:id + "-weapon",source}] : [])];
}
function eligible(unit, enhancement, detachmentId, army) {
  if (unit.roles?.epicHero) return false;
  const exclusions = enhancement.description.match(/only\s*\(excluding ([^)]+)\)/i)?.[1];
  const tags = tagsForUnit(unit, detachmentId, army);
  if (exclusions && exclusions.replace(/\s+units?$/i, "").split("/").some(value => tags.has(normalize(value)))) return false;
  if (enhancement.kind !== "upgrade" && !enhancement.allowNonCharacterBearer && !unit.roles?.character) return false;
  if (enhancement.requiredAbility && !JSON.stringify(unit.selectionTree || {}).toLowerCase().includes(enhancement.requiredAbility.toLowerCase())) return false;
  return limiterMatchesUnit(enhancement.eligibilityLimiter || enhancement.description.match(/^(.+?\b(?:model|unit) only(?:\s*\([^)]*\))?\.)/i)?.[1] || "ADEPTUS ASTARTES model only.",unit,detachmentId,army);
}
function applySpaceMarinesCodex(units, armies, document, {replaceUnitReferences = true} = {}) {
  if (!document.detachments?.length) return {units,armies,issues:document.issues || [],summary:{applied:false}};
  const workingUnits = units.map(u => isMarine(u.faction) && /^(Land Speeder|Storm Speeder (Hailstrike|Hammerstrike|Thunderstrike))(?: \[|$)/i.test(u.name) ? {...u,keywords:[...new Set([...(u.keywords || []), "Speeder"])]} : u);
  const marineArmies = armies.filter(a => isMarine(a.faction));
  const base = marineArmies.find(a => a.faction.endsWith(" - Space Marines"));
  const oldShared = new Set((base?.detachments || []).map(d => d.id));
  const photographed = new Map(document.detachments.map(d => [normalize(d.name),d]));
  const live = new Map(document.liveDetachments.map(d => [normalize(d.name),d]));
  const sharedNames = new Set([...photographed.keys(),...live.keys()]);
  const oldRuleNames = new Set(["oath of moment",...document.armyRules.map(r=>normalize(r.name))]);
  const source = document.source;
  const summary = {applied:true,armies:0,photographedDetachments:15,enhancements:32,stratagems:48,pendingRetainedRules:[]};
  const definitions = armies.map(army => {
    if (!isMarine(army.faction)) return army;
    summary.armies++;
    const allowed = new Set(army.allowedSelectionKeys || []);
    const armyUnits = workingUnits.filter(u=>allowed.has(u.selectionKey) && u.rosterSelectable !== false);
    const retained = (army.detachments || []).filter(d => !oldShared.has(d.id) && !sharedNames.has(normalize(d.name)));
    const retainedIds = new Set(retained.map(d=>d.id));
    const enhancements = (army.enhancements || []).flatMap(e => {
      const detachmentIds=(e.detachmentIds || []).filter(id=>retainedIds.has(id));
      return detachmentIds.length ? [{...e,detachmentIds}] : [];
    });
    const detachments = [...retained];
    for (const record of document.liveDetachments) {
      const key = normalize(record.name);
      const photo = photographed.get(key);
      const source = photo?.source || document.source;
      const prior = (army.detachments || []).find(d=>normalize(d.name)===key);
      const fallback = prior || marineArmies.flatMap(a=>a.detachments).find(d=>normalize(d.name)===key);
      const id = prior?.id || fallback?.id || "space-marines-codex-" + slug(record.name);
      const choices = dispositions(army, photo?.forceDispositions || record.forceDispositions);
      const pending = !photo && !fallback;
      if (pending && !summary.pendingRetainedRules.includes(record.name)) summary.pendingRetainedRules.push(record.name);
      const detachment = {
        ...(photo ? {} : fallback || {}), id,name:photo?.name || fallback?.name || record.name.toLowerCase().replace(/(^|[ -])([a-z])/g,(_,space,c)=>space+c.toUpperCase()),points:0,
        detachmentPoints:photo?.detachmentPoints ?? record.detachmentPoints,forceDisposition:choices[0],forceDispositions:choices,
        uniqueTags:[...(photo?.uniqueTags || record.uniqueTags),...(record.detachmentPoints===3?["3DP DETACHMENT"]:[])],
        rules: photo ? photo.rules.map((r,i)=>({...r,id:id+"-rule-"+i,source})) : fallback?.rules || [{id:id+"-rules-pending",name:"Rules awaiting source",description:"Current codex rules have not been supplied for this detachment. Its DP cost and force disposition are from the live MFM."}],
        stratagems: photo ? photo.stratagems.map((s,i)=>({...s,id:id+"-strat-"+i,type:photo.name+" Stratagem",cpCost:String(s.cpCost),turn:s.when.includes("opponent")?"Opponent's turn":s.when.includes("Your")?"Your turn":"",phase:s.when.split(",")[0],legend:"",detachment:photo.name,scope:"detachment",targetText:s.target,target:null,sourceUrl:null,source})) : fallback?.stratagems || [],
        rulesSource:photo?source:fallback?.rulesSource || "Retained existing rules",rulesPending:pending,
        detachmentPointsSource:document.pointsSource,forceDispositionSource:document.pointsSource
      };
      detachments.push(detachment);
      if (photo) {
        for (const e of photo.enhancements) {
          const existing = (army.enhancements || []).find(x=>normalize(x.name)===normalize(e.name) && (x.detachmentIds || []).includes(id));
          const eid=existing?.id || id+"-enhancement-"+slug(e.name);
          enhancements.push({id:eid,name:e.name,kind:e.kind,maxSelections:e.kind==="upgrade"?3:1,points:e.points,detachmentIds:[id],eligibleSelectionKeys:armyUnits.filter(u=>eligible(u,e,id,army)).map(u=>u.selectionKey),profiles:profiles(e,eid,source),rules:[],source,pointsSource:document.pointsSource});
        }
      } else if (fallback) {
        const owner=marineArmies.find(a=>a.detachments.some(d=>d.id===fallback.id && normalize(d.name)===key));
        for(const e of (owner?.enhancements || []).filter(e=>(e.detachmentIds || []).includes(fallback.id))) {
          const price=record.enhancements.find(x=>normalize(x.name)===normalize(e.name));
          if (!price) continue;
          const entryIds=new Set((e.eligibleSelectionKeys || []).map(k=>k.split(":").at(-1)));
          enhancements.push({...e,points:price.points,detachmentIds:[id],eligibleSelectionKeys:armyUnits.filter(u=>entryIds.has(u.selectionKey.split(":").at(-1))).map(u=>u.selectionKey),pointsSource:document.pointsSource});
        }
      }
    }
    return {...army,detachments,enhancements,armyRules:[...(army.armyRules || []).filter(r=>!oldRuleNames.has(normalize(r.name))),...document.armyRules.map(r=>({...r,id:"space-marines-codex-army-"+slug(r.name),source}))],spaceMarinesCodexSource:{source,lastUpdated:document.lastUpdated,mfmFetchedAt:document.mfmFetchedAt}};
  });
  // Replace obsolete shared ability references in datasheet trees as well as army summaries.
  const shared = new Map(document.armyRules.map(r=>[normalize(r.name),r]));
  function replaceReferences(value) {
    if (!value || typeof value!=="object") return value;
    if (Array.isArray(value)) return value.map(replaceReferences);
    let next=value;
    const name=normalize(value.name);
    const rule=shared.get(name==="oath of moment"?"combat doctrines":name);
    if (rule && (value.description!==undefined || value.characteristics?.Description!==undefined)) {
      next={...value,name:rule.name,source};
      if(value.description!==undefined)next.description=rule.description;
      if(value.characteristics?.Description!==undefined)next.characteristics={...value.characteristics,Description:rule.description};
    }
    const out={...next};
    for(const [key,child] of Object.entries(next))if(child && typeof child==="object")out[key]=replaceReferences(child);
    return out;
  }
  return {units:replaceUnitReferences ? workingUnits.map(u=>isMarine(u.faction)?replaceReferences(u):u) : workingUnits,armies:definitions,summary,issues:[...(document.issues || []),...summary.pendingRetainedRules.map(name=>({code:"space-marines-retained-rules-unavailable",severity:"warning",message:"No existing rules available for "+name+"; live MFM listing retained pending source."}))]};
}
module.exports = {readSpaceMarinesCodex,applySpaceMarinesCodex};
