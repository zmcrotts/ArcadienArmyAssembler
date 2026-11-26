"use strict";
(function install(global) {
  const clone = value => JSON.parse(JSON.stringify(value));
  // D6 order verified against the official free Crusade rules, p. 11.
  const SOURCE = "https://assets.warhammer-community.com/warhammer40000_crusade_crusaderules_eng_24.09-x7lpyyilc9.pdf";
  const MODIFICATIONS = [
    { id:"balanced", roll:1, name:"Finely Balanced", stat:"skill", delta:-1, description:"Improve this weapon's BS or WS by 1." },
    { id:"brutal", roll:2, name:"Brutal", stat:"S", delta:1, description:"Add 1 Strength to this weapon." },
    { id:"piercing", roll:3, name:"Armour Piercing", stat:"AP", delta:-1, description:"Improve this weapon's AP by 1." },
    { id:"master", roll:4, name:"Master-worked", stat:"D", delta:1, description:"Add 1 Damage to this weapon." },
    { id:"heirloom", roll:5, name:"Heirloom", stat:"A", delta:1, description:"Add 1 Attack to this weapon." },
    { id:"precise", roll:6, name:"Precise", stat:"Keywords", description:"Precision applies to attacks that score a Critical Wound." }
  ];
  const LETHAL={id:"lethal",name:"Seeping Poisons",stat:"Keywords",description:"This weapon gains Lethal Hits instead of the usual Weapon Modifications."};
  const modification=id=>id===LETHAL.id?LETHAL:MODIFICATIONS.find(item=>item.id===id);
  const physicalName = profile => String(profile.name || "").replace(/\s+[-–]\s+.*$/, "")
    .replace(/\s+\((?:focused fire|saturation|strike|sweep|standard|supercharge|supercharged|overcharge|overcharged|focused|dispersed|single blade|dual blades)\)$/i, "");
  // The same physical weapon may have ranged/melee or strike/sweep profiles.
  const key = profile => [physicalName(profile).toLowerCase(), [...(profile.bearerProfileIds || [])].sort().join(",")].join("|");
  function baseProfiles(unit) { return (unit.record?.configured?.weapons || []).filter(profile => Number(profile.count ?? 1) > 0); }
  function adjust(value, delta) {
    const text = String(value ?? "");
    if (/^-?\d+\+?$/.test(text)) return `${Math.max(text.endsWith("+") ? 1 : -100, parseInt(text) + delta)}${text.endsWith("+") ? "+" : ""}`;
    const dice = /^(\d*[dD]\d+)(?:\s*([+-])\s*(\d+))?$/.exec(text);
    if (dice) { const addition = (dice[3] ? Number(dice[3]) * (dice[2] === "-" ? -1 : 1) : 0) + delta; return dice[1] + (addition ? `${addition > 0 ? "+" : ""}${addition}` : ""); }
    return text;
  }
  function modify(profile, choices) {
    const result = clone(profile);
    for (const id of choices) {
      const change = modification(id);
      if (!change) throw new Error("Unknown weapon modification.");
      const stat = change.stat === "skill" ? (result.typeName === "Melee Weapons" ? "WS" : "BS") : change.stat;
      // Play Mode recomputes enhancement effects from this baseline. The
      // permanent Crusade upgrade must exist in both it and the displayed stats.
      for (const characteristics of [result.characteristics, result.weaponEffectBaseCharacteristics].filter(Boolean)) {
        if (id === "lethal") characteristics.Keywords = [characteristics.Keywords, "LETHAL HITS"].filter(value=>value && value !== "-").join(", ");
        else if (id === "precise") characteristics.Keywords = [characteristics.Keywords, "PRECISION (Critical Wounds)"].filter(value=>value && value !== "-").join(", ");
        else characteristics[stat] = adjust(characteristics[stat],change.delta);
      }
    }
    return result;
  }
  function profiles(unit, input = baseProfiles(unit)) {
    const output = [];
    for (const profile of input) {
      const count = Number(profile.count ?? 1);
      const modifications = (unit.weaponModifications || []).filter(item => item.weaponKey === key(profile) && item.copy <= count);
      if (count > modifications.length) output.push({...clone(profile),count:count-modifications.length});
      for (const item of modifications) {
        const changed = modify(profile,item.choices);
        changed.count = 1; changed.crusadeModified = true; changed.crusadeModificationId = item.id;
        const mode = String(profile.name).slice(physicalName(profile).length);
        changed.name = `${item.name || physicalName(profile)}${mode} ★`;
        changed.crusadeBaseName = profile.name;
        changed.crusadeChanges = item.choices.map(id=>modification(id).name);
        output.push(changed);
      }
    }
    return output;
  }
  function assign(unit, target, choices, metadata = {}) {
    if (metadata.seepingPoisons ? choices.length!==1 || choices[0]!=="lethal" : choices.length !== 2 || new Set(choices).size !== 2 || choices.some(id=>!MODIFICATIONS.some(item=>item.id===id))) throw new Error("Choose two different weapon modifications, or Seeping Poisons instead.");
    const profile = baseProfiles(unit).find(item => key(item) === target.weaponKey);
    if (!profile || !Number.isInteger(target.copy) || target.copy < 1 || target.copy > Number(profile.count ?? 1)) throw new Error("That individual weapon is not currently equipped.");
    if ((unit.weaponModifications || []).some(item=>item.weaponKey===target.weaponKey && item.copy===target.copy)) throw new Error("That weapon already has a Weapon Modification.");
    if (profile.crusadeRelic || profile.enhancementWeapon) throw new Error("A replacement enhancement or relic weapon cannot be modified.");
    const result = clone(unit), id = global.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
    result.weaponModifications ||= [];
    result.weaponModifications.push({id,weaponKey:target.weaponKey,copy:target.copy,weaponName:physicalName(profile),name:String(target.name || physicalName(profile)),choices:[...choices],method:metadata.method || "chosen",rolls:metadata.rolls || [],source:SOURCE,...(metadata.seepingPoisons?{blessing:"seeping-poisons"}:{})});
    result.awards.push({id:`weapon:${id}`,weaponModificationId:id,name:`Weapon Modification: ${profile.name} #${target.copy}`,kind:"weapon",pack:"Core",table:"Weapon Modifications",description:choices.map(id=>modification(id).description).join(" "),crusadePoints:(unit.keywords||[]).some(key=>/^titanic$/i.test(key))?2:1});
    result.history.push({id,at:new Date().toISOString(),type:"award",name:`${profile.name} #${target.copy}: ${choices.map(id=>modification(id).name).join(" + ")}`});
    return result;
  }
  function rollTwo(die = () => { const bytes=new Uint32Array(1); let number; do {global.crypto.getRandomValues(bytes);number=bytes[0];}while(number>=4294967292);return number%6+1; }) {
    const attempts=[];
    for (let count=0;count<100;count++) {
      const rolls=[die(),die()]; attempts.push(rolls);
      if (rolls.some(value=>!Number.isInteger(value)||value<1||value>6)) throw new Error("Invalid D6 result.");
      if (rolls[0]!==rolls[1]) return {choices:rolls.map(value=>MODIFICATIONS.find(item=>item.roll===value).id),rolls,attempts};
    }
    throw new Error("Could not roll two distinct results.");
  }
  const api={MODIFICATIONS,SOURCE,key,physicalName,baseProfiles,modify,profiles,assign,rollTwo};
  global.ArcadienCrusadeWeapons=api;
  if(typeof module!=="undefined"&&module.exports)module.exports=api;
})(typeof window!=="undefined"?window:globalThis);
