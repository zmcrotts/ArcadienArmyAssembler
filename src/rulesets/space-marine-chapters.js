"use strict";
const fs = require("node:fs");
const { applySpaceMarinesCodex } = require("./space-marines-codex");
const { tagsForUnit } = require("./enhancement-eligibility");
const normalize = value => String(value || "").toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9]+/g," ").trim();
const chapterOf = faction => String(faction || "").split(" - ").at(-1);
const isMarine = faction => String(faction || "").startsWith("Imperium - Adeptus Astartes");
function readSpaceMarineChapters(filePath) {
  if(!filePath)return null;
  const doc=JSON.parse(fs.readFileSync(filePath,"utf8"));
  if(doc.schemaVersion!==1 || doc.detachments?.length!==20 || Object.keys(doc.chapters || {}).length!==11)throw Error("Incomplete Space Marine Chapter source");
  return doc;
}
function applySpaceMarineChapters(units, armies, core, chapters) {
  if(!chapters)return applySpaceMarinesCodex(units,armies,core);
  const deathwingNames=["Bladeguard Ancient","Bladeguard Veteran Squad","Sternguard Veteran Squad","Vanguard Veteran Squad with Jump Packs","Land Raider","Land Raider Crusader","Land Raider Redeemer","Repulsor","Repulsor Executioner"].map(normalize);
  const workingUnits=units.map(u=>{
    if(chapterOf(u.faction)!=="Dark Angels")return u;
    const tags=tagsForUnit(u), additions=[];
    if(normalize(u.name)==="land speeder vengeance")additions.push("Landspeeder Vengeance");
    if(tags.has("mounted") || (tags.has("vehicle") && tags.has("fly")))additions.push("Ravenwing");
    if(tags.has("terminator") || tags.has("dreadnought") || /dreadnought/i.test(u.name) || deathwingNames.includes(normalize(u.name)))additions.push("Deathwing");
    return {...u,keywords:[...new Set([...(u.keywords || []),...additions])],conditionalKeywords:(u.conditionalKeywords || []).filter(k=>!["ravenwing","deathwing"].includes(normalize(k.keyword)))};
  });
  const unitsByKey=new Map(workingUnits.map(u=>[u.selectionKey,u]));
  const chapterPhotos=new Map(chapters.detachments.map(d=>[normalize(d.name),d]));
  const sharedNames=new Set(core.liveDetachments.map(d=>normalize(d.name)));
  const photos=[...core.detachments.map(d=>({...d,source:core.source})),...chapters.detachments.map(d=>({...d,source:chapters.source}))];
  const summary={applied:true,armies:0,photographedDetachments:photos.length,enhancements:photos.reduce((n,d)=>n+d.enhancements.length,0),stratagems:photos.reduce((n,d)=>n+d.stratagems.length,0),pendingRetainedRules:[],chapters:{count:11,detachments:20,source:chapters.source}};
  const results=armies.map(army=>{
    if(!isMarine(army.faction))return army;
    summary.armies++;
    const chapter=chapterOf(army.faction), config=chapters.chapters[chapter] || {armyRules:[]};
    const blocked=u=>u && ((config.excludedKeywords || []).some(k=>tagsForUnit(u).has(normalize(k)) || normalize(u.name).includes(normalize(k))) || (config.excludedCoreDatasheets || []).some(n=>normalize(n)===normalize(u.name)));
    const allowedSelectionKeys=(army.allowedSelectionKeys || []).filter(k=>!blocked(unitsByKey.get(k)));
    const live=core.liveDetachments.filter(d=>{
      const owner=chapterPhotos.get(normalize(d.name))?.chapter;
      return !owner || owner===chapter || chapter==="Space Marines" || normalize(d.name)==="deathwatch support";
    });
    for(const d of chapters.detachments.filter(d=>d.chapter===chapter && !sharedNames.has(normalize(d.name))))live.push(d);
    // Only the replacement list enters the overlay; retired Chapter entries cannot survive.
    const seed={...army,allowedSelectionKeys,armyRules:[],detachments:(army.detachments || []).filter(d=>sharedNames.has(normalize(d.name)) || chapterPhotos.has(normalize(d.name)))};
    const merged={...core,source:chapters.source,detachments:photos,liveDetachments:live};
    const result=applySpaceMarinesCodex(workingUnits,[seed],merged,{replaceUnitReferences:false});
    summary.pendingRetainedRules.push(...result.summary.pendingRetainedRules);
    const updated=result.armies[0];
    const availableNames=new Set(live.map(d=>normalize(d.name)));
    const extras=config.armyRules.map(r=>({...r,id:"space-marines-chapter-army-"+normalize(r.name).replace(/ /g,"-"),source:chapters.source}));
    return {...updated,detachments:updated.detachments.filter(d=>availableNames.has(normalize(d.name))),armyRules:[...updated.armyRules,...extras],spaceMarineChapterSource:{source:chapters.source,lastUpdated:chapters.lastUpdated},enhancements:updated.enhancements.filter(e=>e.detachmentIds.some(id=>updated.detachments.some(d=>d.id===id && availableNames.has(normalize(d.name))))).map(e=>{
      const original=photos.flatMap(d=>d.enhancements).find(x=>x.name===e.name);
      return {...e,allowNonCharacterBearer:Boolean(original?.allowNonCharacterBearer)};
    })};
  });
  const sharedResult=applySpaceMarinesCodex(workingUnits,[],core);
  function replace(node, rules) {
    if(!node || typeof node!=="object")return node;
    if(Array.isArray(node))return node.map(n=>replace(n,rules));
    const replacement=rules.find(r=>normalize(r.name)===normalize(node.name));
    let next={...node};
    if(replacement) {
      if(node.description!==undefined)next.description=replacement.description;
      if(node.characteristics?.Description!==undefined)next.characteristics={...node.characteristics,Description:replacement.description};
    }
    return Object.fromEntries(Object.entries(next).map(([k,v])=>[k,v && typeof v==="object"?replace(v,rules):v]));
  }
  return {units:sharedResult.units.map(u=>{const rules=chapters.chapters[chapterOf(u.faction)]?.armyRules;return rules?.length ? replace(u,rules) : u;}),armies:results,summary,issues:[...(core.issues || [])]};
}
module.exports={readSpaceMarineChapters,applySpaceMarineChapters};
