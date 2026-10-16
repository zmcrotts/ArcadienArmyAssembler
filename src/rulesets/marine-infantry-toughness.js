'use strict';
const armourClass=/\b(?:phobos|gravis|terminator)\b/i;
const nonMarine=/\b(?:servitors?|neophytes?|wolves|hunting wolf|fenrisian wolf|cyberwolf)\b/i;
function correctMarineInfantryToughness(unit) {
  if (unit.rulesetId !== 'wh40k-11e-vflam' || !String(unit.faction).startsWith('Imperium - Adeptus Astartes')) return unit;
  const tags=[...(unit.keywords || []),...(unit.categories || [])];
  if (!tags.some(k=>/^infantry$/i.test(k)) || tags.some(k=>armourClass.test(k)) || armourClass.test(unit.name)) return unit;
  function visit(node) {
    const profiles=(node.profiles || []).map(p=>{
      if (p.typeName !== 'Unit' || String(p.characteristics?.T) !== '4') return p;
      if (armourClass.test(p.name) || nonMarine.test(p.name) || /\bservitors?\b/i.test(unit.name)) return p;
      return {...p,characteristics:{...p.characteristics,T:'5'}};
    });
    return {...node,profiles,children:(node.children || []).map(visit)};
  }
  return {...unit,selectionTree:visit(unit.selectionTree)};
}
module.exports={correctMarineInfantryToughness};
