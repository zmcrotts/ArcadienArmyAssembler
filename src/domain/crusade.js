"use strict";

(function installCrusadeModel(global) {
  const KIND = "arcadien.orderOfBattle";
  const RANKS = [
    { name: "Battle-Ready", minimum: 0, colour: "#788b9b" },
    { name: "Blooded", minimum: 6, colour: "#12b997" },
    { name: "Battle-Hardened", minimum: 16, colour: "#36aede" },
    { name: "Heroic", minimum: 31, colour: "#a082ed" },
    { name: "Legendary", minimum: 51, colour: "#dba83e" }
  ];
  const clone = value => JSON.parse(JSON.stringify(value));
  function deathGuardRules(force) {
    const name = `${force.faction || ""} ${force.builderDocument?.faction || ""}`.toLowerCase().replace(/[^a-z]/g, "");
    if (!name.includes("deathguard")) return null;
    return global.ArcadienDeathGuard || (typeof require === "function" ? require("./crusade-death-guard") : null);
  }
  const uid = () => global.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  function count(value, label = "Value") {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 0 || number > 1000000) throw new Error(`${label} must be a whole number between 0 and 1,000,000.`);
    return number;
  }
  function rankFor(xp) {
    xp = count(xp, "XP");
    const index = RANKS.findLastIndex(rank => xp >= rank.minimum);
    const rank = RANKS[index];
    const next = RANKS[index + 1] || null;
    return { ...rank, index, next: next?.name || null, nextAt: next?.minimum ?? null,
      progress: next ? (xp - rank.minimum) / (next.minimum - rank.minimum) : 1 };
  }
  function unitFromRecord(record, document) {
    const type = record.name || "Unnamed unit";
    const enhancements = (document.enhancements || []).filter(item => item.bearerInstanceId === record.instanceId);
    return {
      id: uid(), sourceInstanceId: record.instanceId || null, selectionKey: record.selectionKey || null,
      name: String(document.rosterDisplay?.unitNicknames?.[record.instanceId] || type), unitType: type, points: Number(record.points || 0) + enhancements.reduce((sum, item) => sum + Number(item.points || 0), 0),
      keywords: clone(record.keywords || []), roles: clone(record.roles || {}),
      record: clone(record), enhancements: clone(enhancements),
      xp: 0, games: 0, wins: 0, survived: 0, kills: 0, awards: [], notes: "", history: []
    };
  }
  function createForce(document = {}, options = {}) {
    const time = new Date().toISOString();
    const force = {
      kind: KIND, schemaVersion: 1, id: uid(), name: String(options.name || document.name || "New Crusade"),
      faction: String(document.subfaction || document.faction || options.faction || "Unassigned"),
      ruleset: clone(document.ruleset || { id: "wh40k-11e-vflam" }),
      supplyLimit: count(options.supplyLimit ?? document.pointsLimit ?? 1000, "Supply limit"),
      requisitionPoints: 5, packs: ["Core"], notes: "", createdAt: time, updatedAt: time,
      units: (document.rosterEntries || []).map(record => unitFromRecord(record, document))
    };
    const ids = new Map(force.units.map(unit => [unit.sourceInstanceId, unit.id]).filter(([id]) => id));
    force.builderDocument = remapReferences(document, ids);
    force.builderDocument.rosterEntries = [];
    force.builderDocument.groupedPresentation = [];
    return force;
  }
  function remapReferences(value, ids) {
    if (typeof value === "string") return ids.get(value) || value;
    if (Array.isArray(value)) return value.map(item => remapReferences(item, ids));
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value)
      .map(([key, item]) => [ids.get(key) || key, remapReferences(item, ids)]));
    return value;
  }
  function toRosterDocument(force) {
    const document = clone(force.builderDocument || {});
    const ids = new Map(force.units.map(unit => [unit.record?.instanceId || unit.sourceInstanceId, unit.id]).filter(([id]) => id));
    document.kind = "roster-engine.savedRoster";
    document.schemaVersion = 2;
    document.name = force.name;
    document.faction ||= force.faction;
    document.subfaction ||= document.faction;
    document.ruleset ||= force.ruleset;
    document.pointsLimit = force.supplyLimit;
    document.rosterEntries = force.units.map(unit => {
      const record = remapReferences(unit.record, ids);
      record.instanceId = unit.id;
      record.entry ||= {};
      record.entry.instanceId = unit.id;
      return record;
    });
    document.enhancements = force.units.flatMap(unit => unit.enhancements.map(item => ({ ...clone(item), bearerInstanceId: unit.id })));
    document.rosterDisplay ||= {};
    document.rosterDisplay.unitNicknames = Object.fromEntries(force.units
      .filter(unit => unit.name !== unit.unitType).map(unit => [unit.id, unit.name]));
    document.groupedPresentation = [];
    return document;
  }
  function applyRosterDocument(force, document) {
    const result = clone(force);
    const existing = new Map(force.units.map(unit => [unit.id, unit]));
    const seen = new Set();
    result.units = (document.rosterEntries || []).map(record => {
      if (!record.instanceId || !record.selectionKey || seen.has(record.instanceId)) throw new Error("The catalogue returned an invalid or duplicate unit.");
      seen.add(record.instanceId);
      const rebuilt = unitFromRecord(record, document);
      const previous = existing.get(record.instanceId);
      return { ...(previous ? clone(previous) : rebuilt), id: record.instanceId,
        name: rebuilt.name, unitType: rebuilt.unitType, points: rebuilt.points,
        selectionKey: rebuilt.selectionKey, record: rebuilt.record, keywords: rebuilt.keywords,
        roles: rebuilt.roles, enhancements: rebuilt.enhancements };
    });
    result.retiredUnits = [...(result.retiredUnits || []), ...force.units.filter(unit => !seen.has(unit.id))];
    result.builderDocument = clone(document);
    result.builderDocument.rosterEntries = [];
    result.builderDocument.groupedPresentation = [];
    result.name = String(document.name || force.name);
    result.supplyLimit = count(document.pointsLimit, "Supply limit");
    const trackers = global.ArcadienCrusadeTrackers || (typeof require === "function" ? require("./crusade-trackers") : null);
    if (trackers?.factionKey(result) === "deathGuard") {
      const deathGuard = global.ArcadienDeathGuard || (typeof require === "function" ? require("./crusade-death-guard") : null);
      deathGuard?.afterNewUnits(result, new Set(force.units.map(unit=>unit.id)));
    }
    result.updatedAt = new Date().toISOString();
    const bookkeeping = global.ArcadienCrusadeBookkeeping || (typeof require === "function" ? require("./crusade-bookkeeping") : null);
    bookkeeping?.reconcileBuilder(force, result);
    const validated=validateForce(result);
    return bookkeeping?.recordBuilder(force, validated) || validated;
  }
  function battleDocument(force, unitIds, agendas = [], options = {}) {
    const selected = new Set(unitIds);
    if (!selected.size || selected.size !== unitIds.length || unitIds.some(id => !force.units.some(unit => unit.id === id))) throw new Error("Select at least one available unit, without duplicates.");
    if (force.units.some(unit=>selected.has(unit.id) && (unit.deathGuard?.pendingSpawndom || unit.deathGuard?.pendingHonours || unit.deathGuard?.pendingScars || unit.deathGuard?.spreadingHonourPending))) throw new Error("Resolve this unit's Death Guard replacement or pending awards before mustering it.");
    if (force.units.some(unit=>selected.has(unit.id)&&unit.progression?.pendingInjury)) throw new Error("Resolve pending Out of Action results before mustering this unit.");
    const document = toRosterDocument(force);
    document.rosterEntries = document.rosterEntries.filter(record => selected.has(record.instanceId));
    if (document.rosterEntries.some(record => !record.configured?.units?.length)) throw new Error("Refresh missing unit stats with Edit unit & equipment before bringing that unit to battle.");
    document.pointsLimit = count(options.pointsLimit ?? force.supplyLimit, "Battle size");
    const points = force.units.filter(unit => selected.has(unit.id)).reduce((sum, unit) => sum + unit.points, 0);
    if (points > document.pointsLimit) throw new Error(`Selected force exceeds the battle size by ${points - document.pointsLimit} points.`);
    document.enhancements = document.enhancements.filter(item => selected.has(item.bearerInstanceId));
    document.rosterDisplay.unitNicknames = Object.fromEntries(Object.entries(document.rosterDisplay.unitNicknames).filter(([id]) => selected.has(id)));
    if (document.armyState) {
      document.armyState.attachments = (document.armyState.attachments || []).filter(item => selected.has(item.leaderInstanceId) && selected.has(item.targetInstanceId));
      document.armyState.enhancements = (document.armyState.enhancements || []).filter(item => selected.has(item.bearerInstanceId));
      if (!selected.has(document.armyState.warlordInstanceId)) document.armyState.warlordInstanceId = null;
    }
    document.groupedPresentation = document.rosterEntries.map(record => ({id:`unit:${record.instanceId}`,kind:"unit",title:document.rosterDisplay.unitNicknames[record.instanceId] || record.name,memberInstanceIds:[record.instanceId]}));
    document.crusade = { forceId: force.id, forceName: force.name, unitIds: [...unitIds],
      units: force.units.filter(unit => selected.has(unit.id)).map(unit => ({id:unit.id,name:unit.name,unitType:unit.unitType,points:unit.points})),
      unitRecords: clone(force.units.filter(unit=>selected.has(unit.id))), crusadePoints: summary({...force,units:force.units.filter(unit=>selected.has(unit.id))}).crusadePoints,
      agendas: clone(agendas), createdAt: new Date().toISOString() };
    const weapons = global.ArcadienCrusadeWeapons || (typeof require === "function" ? require("./crusade-weapons") : null);
    if (weapons) for (const record of document.rosterEntries) record.configured.weapons = weapons.profiles(force.units.find(unit=>unit.id===record.instanceId));
    if (force.factionProgression) document.crusade.factionProgression = { version: 1, panels: clone(force.factionProgression.panels) };
    const deathGuard = global.ArcadienDeathGuard || (typeof require === "function" ? require("./crusade-death-guard") : null);
    const trackers = global.ArcadienCrusadeTrackers || (typeof require === "function" ? require("./crusade-trackers") : null);
    if (trackers?.factionKey(force) === "deathGuard") {
      const pathogen = deathGuard.pathogen(force);
      if (pathogen.unknown.length || pathogen.potency > 7) throw new Error("Restore the saved Pathogen to the printed choices before mustering.");
      document.crusade.extraCrusadePoints = trackers.blessingClaims(force).filter(b=>b.claims.length).length;
      document.crusade.deathGuard = {duration:pathogen.duration,potency:pathogen.potency,properties:pathogen.properties.map(p=>({id:p.definition.id,name:p.definition.name,effect:p.definition.effect,drawback:p.definition.drawback,suppressed:Boolean(p.record.values.suppressed)})),blessings:trackers.blessingClaims(force).filter(b=>b.claims.length).map(b=>({id:b.id,name:b.name,description:b.description})),temporaryTraits:force.units.filter(u=>selected.has(u.id)&&u.deathGuard?.temporaryTrait).map(u=>({unitId:u.id,...clone(u.deathGuard.temporaryTrait)}))};
    }
    if (agendas.some(item => !item.id || !String(item.name || "").trim() || typeof item.description !== "string") || new Set(agendas.map(item => item.id)).size !== agendas.length) throw new Error("Select valid, distinct agendas.");
    return document;
  }
  function updateUnit(force, unitId, changes) {
    const result = clone(force);
    const unit = result.units.find(item => item.id === unitId);
    if (!unit) throw new Error("This unit could not be found.");
    const before = { name: unit.name, xp: unit.xp, games: unit.games, wins: unit.wins, survived: unit.survived, kills: unit.kills, notes: unit.notes };
    const deathGuard = deathGuardRules(force);
    if (deathGuard?.immune(unit) && changes.xp != null && Number(changes.xp) > unit.xp) throw new Error("Poxwalkers and Plague Legions cannot gain XP except through an explicit faction exception.");
    for (const key of ["xp", "games", "wins", "survived", "kills"]) if (changes[key] != null) unit[key] = count(changes[key], key);
    if (unit.wins > unit.games || unit.survived > unit.games) throw new Error("Victories and games survived cannot exceed games played.");
    if (changes.name != null) {
      unit.name = String(changes.name).trim();
      if (!unit.name) throw new Error("Give this unit a name.");
    }
    if (changes.notes != null) unit.notes = String(changes.notes);
    unit.history.push({ id: uid(), at: new Date().toISOString(), type: "record", before,
      after: { name: unit.name, xp: unit.xp, games: unit.games, wins: unit.wins, survived: unit.survived, kills: unit.kills, notes: unit.notes } });
    result.updatedAt = new Date().toISOString();
    return result;
  }
  function assignAward(force, unitId, award) {
    const result = clone(force);
    const unit = result.units.find(item => item.id === unitId);
    if (!unit) throw new Error("This unit could not be found.");
    if (!award?.id || !award.name) throw new Error("Select an award.");
    const deathGuard = deathGuardRules(force);
    if (deathGuard?.immune(unit) && (award.kind === "scar" || !unit.deathGuard?.spreadingHonourPending)) throw new Error("Poxwalkers and Plague Legions automatically pass Out of Action tests and cannot gain ordinary Honours or Scars.");
    if (unit.awards.some(item => item.id === award.id)) throw new Error("This unit already has that award.");
    unit.awards.push(clone(award));
    if (unit.deathGuard) {
      if (award.kind === "scar" && unit.deathGuard.pendingScars) unit.deathGuard.pendingScars--;
      else if (award.kind !== "scar" && unit.deathGuard.pendingHonours) unit.deathGuard.pendingHonours--;
      if (award.kind !== "scar" && unit.deathGuard.spreadingHonourPending) unit.deathGuard.spreadingHonourPending=false;
    }
    unit.history.push({ id: uid(), at: new Date().toISOString(), type: "award", name: award.name, awardId: award.id });
    result.updatedAt = new Date().toISOString();
    return result;
  }
  function validateForce(value) {
    if (!value || value.kind !== KIND || value.schemaVersion !== 1 || typeof value.id !== "string" || !value.id
      || typeof value.name !== "string" || typeof value.faction !== "string" || !Array.isArray(value.units)
      || !Array.isArray(value.packs) || !value.packs.every(item => typeof item === "string")
      || !Number.isFinite(Date.parse(value.updatedAt)) || !Number.isFinite(Date.parse(value.createdAt))) throw new Error("This is not a supported Order of Battle backup.");
    count(value.supplyLimit, "Supply limit"); count(value.requisitionPoints, "Requisition Points");
    if (value.factionProgression != null) {
      const trackers = global.ArcadienCrusadeTrackers || (typeof require === "function" ? require("./crusade-trackers") : null);
      if (!trackers) throw new Error("Faction tracker support could not be loaded. This backup has not been changed.");
      trackers.validate(value);
    }
    if (value.agendas != null && (!Array.isArray(value.agendas) || value.agendas.some(item => !item || typeof item.id !== "string" || !item.id || typeof item.name !== "string" || !item.name.trim() || typeof item.description !== "string" || typeof item.source !== "string") || new Set(value.agendas.map(item => item.id)).size !== value.agendas.length)) throw new Error("The agenda library is invalid.");
    const ids = new Set();
    if (value.retiredUnits != null && !Array.isArray(value.retiredUnits)) throw new Error("The retired unit records are invalid.");
    for (const unit of [...value.units, ...(value.retiredUnits || [])]) {
      if (!unit || typeof unit.id !== "string" || !unit.id || ids.has(unit.id)
        || typeof unit.name !== "string" || typeof unit.unitType !== "string"
        || !Number.isFinite(unit.points) || unit.points < 0 || !Array.isArray(unit.awards)
        || !Array.isArray(unit.history) || !Array.isArray(unit.enhancements) || !Array.isArray(unit.keywords)) throw new Error("The Order of Battle contains an invalid unit.");
      ids.add(unit.id);
      for (const key of ["xp", "games", "wins", "survived", "kills"]) count(unit[key], key);
      if (unit.wins > unit.games || unit.survived > unit.games) throw new Error("The unit's battle record is invalid.");
      for (const award of unit.awards) if (!award || typeof award.id !== "string" || typeof award.name !== "string"
        || typeof award.description !== "string" || !["honour", "scar", "relic", "weapon"].includes(award.kind)
        || (award.crusadePoints != null && !Number.isFinite(award.crusadePoints))) throw new Error("The unit contains an invalid award.");
      const weaponTargets = new Set();
      if (unit.weaponModifications != null && !Array.isArray(unit.weaponModifications)) throw new Error("Invalid weapon modifications.");
      for (const modification of unit.weaponModifications || []) {
        const target = `${modification.weaponKey}:${modification.copy}`;
        if (!modification.id || typeof modification.weaponKey !== "string" || !Number.isSafeInteger(modification.copy) || modification.copy < 1
          || !Array.isArray(modification.choices) || !(modification.blessing==="seeping-poisons" ? modification.choices.length===1 && modification.choices[0]==="lethal" : modification.choices.length===2 && new Set(modification.choices).size===2)
          || modification.choices.some(id=>!["balanced","brutal","piercing","master","heirloom","precise",...(modification.blessing==="seeping-poisons"?["lethal"]:[])].includes(id)) || weaponTargets.has(target)) throw new Error("Invalid individual weapon modification.");
        weaponTargets.add(target);
      }
      for (const event of unit.history) {
        if (!event || !["record", "award", "removed", "event"].includes(event.type) || !Number.isFinite(Date.parse(event.at))) throw new Error("The unit contains invalid history.");
        if (event.type === "record") {
          for (const snapshot of [event.before, event.after]) {
            if (!snapshot) throw new Error("The unit's record history is incomplete.");
            for (const key of ["xp", "games", "wins", "survived", "kills"]) count(snapshot[key], key);
          }
        } else if (typeof event.name !== "string") throw new Error("The unit's award history is incomplete.");
      }
    }
    if (value.battles != null && !Array.isArray(value.battles)) throw new Error("The game history is invalid.");
    for (const battle of value.battles || []) if (!battle || !["Victory", "Defeat", "Draw"].includes(battle.result)
      || !Number.isFinite(Date.parse(battle.date)) || !Array.isArray(battle.unitIds)
      || !battle.unitIds.every(id => ids.has(id))) throw new Error("The game history contains an invalid record.");
    if (value.bookkeeping || value.requisitions || value.battles?.some(b=>b.snapshot) || [...value.units,...(value.retiredUnits||[])].some(u=>u.progression)) {
      const bookkeeping=global.ArcadienCrusadeBookkeeping||(typeof require==="function"?require("./crusade-bookkeeping"):null);
      bookkeeping?.validate(value);
    }
    return clone(value);
  }
  function summary(force) {
    const extra=deathGuardRules(force)?(global.ArcadienCrusadeTrackers||(typeof require==="function"?require("./crusade-trackers"):null))?.blessingClaims(force).filter(b=>b.claims.length).length||0:0;
    return force.units.reduce((sum, unit) => {
      sum.points += unit.points; sum.xp += unit.xp;
      sum.honours += unit.awards.filter(item => item.kind !== "scar").length;
      sum.scars += unit.awards.filter(item => item.kind === "scar").length;
      sum.crusadePoints += unit.awards.reduce((points, award) => points + Number(award.crusadePoints || 0), 0);
      return sum;
    }, { points: 0, xp: 0, honours: 0, scars: 0, crusadePoints: extra });
  }
  const api = { KIND, RANKS, rankFor, createForce, unitFromRecord, updateUnit, assignAward, validateForce, summary, count, uid, clone, toRosterDocument, applyRosterDocument, battleDocument };
  global.ArcadienCrusadeModel = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
