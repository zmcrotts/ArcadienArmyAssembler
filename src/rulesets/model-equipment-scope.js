'use strict';
// Equipment attached to a unit-level Character node has no model ancestor in
// BSData. Bind the effect to that Character's stat profile before combining it
// with bodyguard profiles in tables and sheets.
function bindModelEquipmentEffects(unit) {
  let changed = false;
  function visit(node, bearerProfiles) {
    const localProfiles = (node.profiles || []).filter(p => p.typeName === 'Unit').map(p => p.id).filter(Boolean);
    const owner = (node.kind === 'model' || node.kind === 'unit') && localProfiles.length ? localProfiles : bearerProfiles;
    const profiles = (node.profiles || []).map(profile => {
      if (!/^Relic Shield$/i.test(profile.name) || !owner.length) return profile;
      if (!/\b(?:this model|bearer)\b/i.test(profile.characteristics?.Description || '')) return profile;
      if (JSON.stringify(profile.bearerProfileIds) === JSON.stringify(owner)) return profile;
      changed = true;
      return {...profile, bearerProfileIds:owner.slice()};
    });
    return {...node, profiles, children:(node.children || []).map(child => visit(child, owner))};
  }
  const tree = visit(unit.selectionTree, []);
  return changed ? {...unit, selectionTree:tree} : unit;
}
module.exports = {bindModelEquipmentEffects};
