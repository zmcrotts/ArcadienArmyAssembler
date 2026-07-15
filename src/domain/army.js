"use strict";

function createArmyState(armyDefinition) {
  return {
    schemaVersion: 1,
    rulesetId: armyDefinition?.rulesetId || "wh40k-10e-bsdata",
    armyId: armyDefinition?.id || null,
    detachmentId: null,
    detachmentIds: [],
    forceDispositionId: null,
    opponentForceDispositionId: null,
    primaryMissionName: null,
    warlordInstanceId: null,
    attachments: [],
    enhancements: []
  };
}

function selectedDetachmentIds(armyState) {
  const ids = (armyState?.detachmentIds || []).filter(Boolean);
  return [...new Set(ids.length ? ids : [armyState?.detachmentId].filter(Boolean))];
}

function selectedDetachment(armyDefinition, armyState) {
  return selectedDetachments(armyDefinition, armyState)[0] || null;
}

function selectedDetachments(armyDefinition, armyState) {
  const ids = new Set(selectedDetachmentIds(armyState));
  return (armyDefinition?.detachments || []).filter(item => ids.has(item.id));
}

function availableForceDispositions(armyDefinition, armyState) {
  const byId = new Map((armyDefinition?.forceDispositions || []).map(item => [item.id, item]));
  return [...new Map(selectedDetachments(armyDefinition, armyState)
    .map(detachment => detachment.forceDisposition)
    .filter(Boolean)
    .map(disposition => {
      const full = byId.get(disposition.id) || disposition;
      return [full.id || full.name, full];
    })).values()];
}

function selectedForceDisposition(armyDefinition, armyState) {
  const available = availableForceDispositions(armyDefinition, armyState);
  return available.find(item => item.id === armyState?.forceDispositionId)
    || (available.length === 1 ? available[0] : null);
}

function selectedOpponentForceDisposition(armyDefinition, armyState) {
  return (armyDefinition?.forceDispositions || []).find(item => item.id === armyState?.opponentForceDispositionId) || null;
}

function selectedPrimaryMission(armyDefinition, armyState) {
  const forceDisposition = selectedForceDisposition(armyDefinition, armyState);
  const opponentDisposition = selectedOpponentForceDisposition(armyDefinition, armyState);
  if (!forceDisposition || !opponentDisposition) return null;
  return (forceDisposition.missionMap || []).find(mission =>
    normalizeName(mission.opponentDisposition) === normalizeName(opponentDisposition.name)
  ) || null;
}

function enhancementAvailable(enhancement, armyState) {
  const selected = selectedDetachmentIds(armyState);
  return selected.some(detachmentId => (enhancement.detachmentIds || []).includes(detachmentId));
}

function canSelectWarlord(entry) {
  return Boolean(entry?.rosterRules?.canBeWarlord && entry?.roles?.character && !entry?.alliedFor);
}

function normalizeTargetName(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function leaderCanTarget(leader, target) {
  if (!leader || !target) return false;
  const rules = leader.rosterRules || {};
  if ((rules.leaderTargetSelectionKeys || []).includes(target.selectionKey)) return true;
  const targetName = normalizeTargetName(target.name);
  return Boolean(targetName && (rules.leaderTargetNames || []).some(name => normalizeTargetName(name) === targetName));
}

function effectiveKeywordsForEntry(item, armyState) {
  const definition = item?.definition || item?.unitPackage?.definition || {};
  const selectedIds = new Set(selectedDetachmentIds(armyState));
  const keywords = new Map((item?.keywords || item?.unitPackage?.keywords || definition.keywords || definition.categories || [])
    .map(keyword => [normalizeTargetName(keyword), keyword]));
  for (const grant of item?.conditionalKeywords || definition.conditionalKeywords || []) {
    if (!(grant.detachmentIds || []).some(id => selectedIds.has(id))) continue;
    if (grant.keyword) keywords.set(normalizeTargetName(grant.keyword), grant.keyword);
  }
  return [...keywords.values()];
}

function normalizeRosterEntries(rosterEntries, armyState = null) {
  return (rosterEntries || []).map(item => {
    const definition = item.definition || item.unitPackage?.definition || {};
    const keywords = effectiveKeywordsForEntry(item, armyState);
    const roles = { ...(item.roles || definition.roles || {}) };
    if (keywords.some(keyword => normalizeTargetName(keyword) === "battleline")) roles.battleline = true;
    if (keywords.some(keyword => normalizeTargetName(keyword) === "character")) roles.character = true;
    return {
      instanceId: item.instanceId || item.entry?.instanceId,
      selectionKey: item.selectionKey || item.unitPackage?.selectionKey || definition.selectionKey,
      name: item.name || item.unitPackage?.name || definition.name || "Unknown unit",
      faction: item.faction || item.unitPackage?.faction || definition.faction || null,
      points: Number(item.points ?? 0),
      roles,
      categories: [...new Set([...(item.categories || definition.categories || []), ...keywords])],
      keywords,
      rosterRules: item.rosterRules || definition.rosterRules || {},
      alliedFor: item.alliedFor || item.unitPackage?.alliedFor || null
    };
  });
}

function getEnhancementStates(armyDefinition, armyState, rosterEntries) {
  const entries = normalizeRosterEntries(rosterEntries, armyState);
  const assignments = armyState?.enhancements || [];
  return (armyDefinition?.enhancements || [])
    .filter(item => enhancementAvailable(item, armyState))
    .map(enhancement => {
      const selectedAssignments = assignments.filter(item => item.enhancementId === enhancement.id);
      return {
        ...enhancement,
        selected: selectedAssignments.length > 0,
        selectedCount: selectedAssignments.length,
        bearerInstanceIds: selectedAssignments.map(item => item.bearerInstanceId),
        bearerInstanceId: selectedAssignments[0]?.bearerInstanceId || null,
        bearerOptions: entries.map(entry => ({
          ...entry,
          eligible: canBearEnhancement(enhancement, entry)
        })),
        selectable: selectedDetachmentIds(armyState).length > 0 && entries.length > 0
      };
    });
}

function canBearEnhancement(enhancement, entry) {
  if (!entry || !(enhancement?.eligibleSelectionKeys || []).includes(entry.selectionKey)) return false;
  if (enhancement.kind === "upgrade") return true;
  return Boolean(entry.roles?.character && !entry.roles?.epicHero);
}

function getUnitAssignmentState(armyDefinition, armyState, rosterEntries, rosterEntry) {
  const entries = normalizeRosterEntries(rosterEntries, armyState);
  const selected = normalizeRosterEntries([rosterEntry], armyState)[0] || entries.find(entry => entry.instanceId === rosterEntry?.instanceId);
  if (!selected) {
    return {
      showWarlord: false,
      isWarlord: false,
      leaderAssignment: null,
      leaderTargets: [],
      ledBy: [],
      eligibleLeaders: [],
      enhancements: []
    };
  }

  const attachments = armyState?.attachments || [];
  const selectedId = selected.instanceId;
  const leaderAssignment = attachments.find(item => item.leaderInstanceId === selectedId) || null;
  const ledBy = attachments.filter(item => item.targetInstanceId === selectedId);
  const leaders = entries.filter(entry => entry.instanceId !== selectedId && entry.roles?.leader);
  const currentEnhancementIds = new Set((armyState?.enhancements || [])
    .filter(item => item.bearerInstanceId === selectedId)
    .map(item => item.enhancementId));

  const enhancements = getEnhancementStates(armyDefinition, armyState, entries)
    .filter(state => {
      const bearer = state.bearerOptions.find(item => item.instanceId === selectedId);
      return Boolean(bearer?.eligible || currentEnhancementIds.has(state.id));
    });

  return {
    showWarlord: Boolean(canSelectWarlord(selected) || armyState?.warlordInstanceId === selectedId),
    isWarlord: armyState?.warlordInstanceId === selectedId,
    leaderAssignment,
    leaderTargets: selected.roles?.leader
      ? entries.filter(entry => entry.instanceId !== selectedId)
      : [],
    ledBy,
    eligibleLeaders: leaders.filter(leader =>
      leaderCanTarget(leader, selected)
      || ledBy.some(item => item.leaderInstanceId === leader.instanceId)
    ),
    enhancements
  };
}

function selectDetachment(armyDefinition, armyState, detachmentId) {
  const next = structuredClone(armyState);
  next.detachmentId = detachmentId || null;
  next.detachmentIds = detachmentId ? [detachmentId] : [];
  return normalizeMissionState(armyDefinition, next);
}

function setSelectedDetachments(armyDefinition, armyState, detachmentIds) {
  const validIds = new Set((armyDefinition?.detachments || []).map(item => item.id));
  const ids = [...new Set((detachmentIds || []).filter(id => validIds.has(id)))];
  const next = structuredClone(armyState);
  next.detachmentIds = ids;
  next.detachmentId = ids[0] || null;
  return normalizeMissionState(armyDefinition, next);
}

function normalizeMissionState(armyDefinition, armyState) {
  const next = structuredClone(armyState || createArmyState(armyDefinition));
  const available = availableForceDispositions(armyDefinition, next);
  const forceDisposition = available.find(item => item.id === next.forceDispositionId)
    || (available.length === 1 ? available[0] : null);
  next.forceDispositionId = forceDisposition?.id || null;

  const opponentDisposition = selectedOpponentForceDisposition(armyDefinition, next);
  if (!opponentDisposition) next.opponentForceDispositionId = null;

  const mission = selectedPrimaryMission(armyDefinition, next);
  next.primaryMissionName = mission?.name || null;
  return next;
}

function setForceDisposition(armyDefinition, armyState, forceDispositionId) {
  const next = structuredClone(armyState);
  const available = availableForceDispositions(armyDefinition, next);
  const selected = available.find(item => item.id === forceDispositionId) || null;
  next.forceDispositionId = selected?.id || null;
  next.primaryMissionName = selectedPrimaryMission(armyDefinition, next)?.name || null;
  return normalizeMissionState(armyDefinition, next);
}

function setOpponentForceDisposition(armyDefinition, armyState, forceDispositionId) {
  const next = structuredClone(armyState);
  const selected = (armyDefinition?.forceDispositions || []).find(item => item.id === forceDispositionId) || null;
  next.opponentForceDispositionId = selected?.id || null;
  next.primaryMissionName = selectedPrimaryMission(armyDefinition, next)?.name || null;
  return normalizeMissionState(armyDefinition, next);
}

function setWarlord(armyState, instanceId) {
  return { ...structuredClone(armyState), warlordInstanceId: instanceId || null };
}

function setLeaderAttachment(armyState, leaderInstanceId, targetInstanceId) {
  const next = structuredClone(armyState);
  next.attachments = (next.attachments || []).filter(item => item.leaderInstanceId !== leaderInstanceId);
  if (targetInstanceId) next.attachments.push({ leaderInstanceId, targetInstanceId });
  return next;
}

function detachBodyguard(armyState, targetInstanceId) {
  const next = structuredClone(armyState);
  next.attachments = (next.attachments || []).filter(item => item.targetInstanceId !== targetInstanceId);
  return next;
}

function pruneArmyStateForRoster(armyState, rosterEntries) {
  const next = structuredClone(armyState || createArmyState(null));
  next.detachmentIds = selectedDetachmentIds(next);
  next.detachmentId = next.detachmentIds[0] || null;
  const instanceIds = new Set(normalizeRosterEntries(rosterEntries).map(item => item.instanceId));
  next.attachments = (next.attachments || []).filter(item =>
    instanceIds.has(item.leaderInstanceId) && instanceIds.has(item.targetInstanceId)
  );
  next.enhancements = (next.enhancements || []).filter(item => instanceIds.has(item.bearerInstanceId));
  if (next.warlordInstanceId && !instanceIds.has(next.warlordInstanceId)) next.warlordInstanceId = null;
  return next;
}

function setEnhancement(armyDefinition, armyState, rosterEntries, enhancementId, bearerInstanceId, enabled = undefined) {
  const next = structuredClone(armyState);
  const enhancement = (armyDefinition?.enhancements || []).find(item => item.id === enhancementId);
  const repeatable = Number(enhancement?.maxSelections || 1) > 1 || enhancement?.kind === "upgrade";
  if (repeatable) {
    const alreadySelected = (next.enhancements || []).some(item =>
      item.enhancementId === enhancementId && item.bearerInstanceId === bearerInstanceId
    );
    const shouldSelect = enabled === undefined ? !alreadySelected : Boolean(enabled);
    next.enhancements = (next.enhancements || []).filter(item =>
      !(item.enhancementId === enhancementId && item.bearerInstanceId === bearerInstanceId)
    );
    if (bearerInstanceId && shouldSelect) next.enhancements.push({ enhancementId, bearerInstanceId });
    return next;
  }

  next.enhancements = (next.enhancements || []).filter(item => item.enhancementId !== enhancementId);
  if (bearerInstanceId && enabled !== false) next.enhancements.push({ enhancementId, bearerInstanceId });
  return next;
}

function warning(code, message, affectedInstanceIds = [], details = {}) {
  return { severity: "warning", code, message, affectedInstanceIds, details };
}

const DAEMON_DETACHMENT_GATES = {
  "Chaos - Death Guard": { detachmentName: "Tallyband Summoners", daemonKeyword: "Nurgle", daemonFactionCategory: "Faction: Plague Legions" },
  "Chaos - Emperor's Children": { detachmentName: "Carnival of Excess", daemonKeyword: "Slaanesh", daemonFactionCategory: "Faction: Legions of Excess" },
  "Chaos - Thousand Sons": { detachmentName: "Changehost of Deceit", daemonKeyword: "Tzeentch", daemonFactionCategory: "Faction: Scintillating Legions" },
  "Chaos - World Eaters": { detachmentName: "Khorne Daemonkin", daemonKeyword: "Khorne", daemonFactionCategory: "Faction: Blood Legions" }
};

function normalizeName(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function selectedDaemonGate(armyDefinition, armyState) {
  const config = DAEMON_DETACHMENT_GATES[armyDefinition?.faction];
  if (!config) return null;
  return {
    requiredDetachmentName: config.detachmentName,
    daemonKeyword: config.daemonKeyword,
    daemonFactionCategory: config.daemonFactionCategory,
    selected: selectedDetachments(armyDefinition, armyState)
      .some(detachment => normalizeName(detachment.name) === normalizeName(config.detachmentName))
  };
}

function daemonDetachmentAllowsSummons(armyDefinition, armyState) {
  const gate = selectedDaemonGate(armyDefinition, armyState);
  return !gate || gate.selected;
}

function canAddUnitForSelectedDetachment(armyDefinition, armyState, entry) {
  const gate = selectedDaemonGate(armyDefinition, armyState);
  if (!gate) return true;
  if (entry?.alliedFor?.type === "chaosDaemons" || entry?.unitPackage?.alliedFor?.type === "chaosDaemons") {
    return gate.selected && daemonUnitMatchesGate(entry, gate);
  }
  return gate.selected || !isNativeSummonedDaemon(armyDefinition, entry);
}

function daemonUnitMatchesGate(entry, gate) {
  const definition = entry?.definition || entry?.unitPackage?.definition || {};
  const categories = entry?.categories || entry?.keywords || entry?.unitPackage?.keywords || definition.categories || definition.keywords || [];
  return categories.some(category => normalizeName(category) === normalizeName(gate.daemonKeyword));
}

function isNativeSummonedDaemon(armyDefinition, entry) {
  const definition = entry?.definition || entry?.unitPackage?.definition || {};
  const config = DAEMON_DETACHMENT_GATES[armyDefinition?.faction];
  if (!config) return false;
  if (entry?.alliedFor?.type || entry?.unitPackage?.alliedFor?.type) return false;
  const faction = entry?.faction || entry?.unitPackage?.faction || definition.faction;
  if (faction && faction !== armyDefinition.faction) return false;
  const categories = entry?.categories || entry?.keywords || entry?.unitPackage?.keywords || definition.categories || definition.keywords || [];
  return categories.includes("Daemon") && (
    categories.includes("Summoned")
    || categories.includes(config.daemonFactionCategory)
  );
}

function validateRosterLegality(armyDefinition, armyState, rosterEntries, options = {}) {
  const entries = normalizeRosterEntries(rosterEntries, armyState);
  const byInstance = new Map(entries.map(entry => [entry.instanceId, entry]));
  const warnings = [];
  const detachments = selectedDetachments(armyDefinition, armyState);
  const daemonGate = selectedDaemonGate(armyDefinition, armyState);

  if (!detachments.length) warnings.push(warning("DETACHMENT_REQUIRED", "Select at least one valid detachment."));
  const detachmentPoints = detachments.reduce((sum, item) => sum + Number(item.detachmentPoints || 0), 0);
  const pointsLimit = Number(options.pointsLimit || 0);
  const detachmentPointLimit = detachmentPointLimitFor(pointsLimit);
  if (detachments.length && detachmentPointLimit > 0) {
    const allowedBySoloIncursion = pointsLimit > 0 && pointsLimit <= 1000 && detachments.length === 1 && detachmentPoints <= 3;
    if (detachmentPoints > detachmentPointLimit && !allowedBySoloIncursion) {
      warnings.push(warning(
        "DETACHMENT_POINTS_EXCEEDED",
        `${detachmentPoints} Detachment Points selected; this battle size allows ${detachmentPointLimit}.`,
        [],
        { detachmentPoints, detachmentPointLimit, selectedDetachmentIds: detachments.map(item => item.id) }
      ));
    }
  }

  if (entries.length) {
    const warlord = byInstance.get(armyState?.warlordInstanceId);
    if (!warlord) warnings.push(warning("WARLORD_REQUIRED", "Select one unit to be your Warlord."));
    else if (warlord.alliedFor) {
      warnings.push(warning("ALLY_CANNOT_BE_WARLORD", `${warlord.name} is an allied unit and cannot be your Warlord.`, [warlord.instanceId]));
    } else if (!canSelectWarlord(warlord)) {
      warnings.push(warning("WARLORD_INELIGIBLE", `${warlord.name} cannot be selected as Warlord.`, [warlord.instanceId]));
    }
  }

  const counts = new Map();
  for (const entry of entries) {
    if (!counts.has(entry.selectionKey)) counts.set(entry.selectionKey, []);
    counts.get(entry.selectionKey).push(entry);
    if (!(armyDefinition?.allowedSelectionKeys || []).includes(entry.selectionKey)) {
      warnings.push(warning("ALLY_NOT_ALLOWED", `${entry.name} is not an allowed unit or ally for this army.`, [entry.instanceId]));
    }
  }
  for (const copies of counts.values()) {
    const unit = copies[0];
    const limit = unit.roles.epicHero ? 1 : (unit.roles.battleline || unit.roles.dedicatedTransport)
      ? 6
      : Number(unit.rosterRules.maxCopies || 3);
    if (copies.length <= limit) continue;
    const code = unit.roles.epicHero ? "EPIC_HERO_UNIQUE" : unit.roles.battleline
      ? "BATTLELINE_LIMIT_EXCEEDED" : unit.roles.dedicatedTransport
        ? "DEDICATED_TRANSPORT_LIMIT_EXCEEDED" : "UNIT_COPY_LIMIT_EXCEEDED";
    if (code === "UNIT_COPY_LIMIT_EXCEEDED" && ["imperialKnights", "chaosKnights"].includes(unit.alliedFor?.type)) continue;
    warnings.push(warning(code, `${unit.name}: ${copies.length} selected; the limit is ${limit}.`, copies.map(item => item.instanceId), { count: copies.length, limit }));
  }

  const alliedGroups = new Map();
  for (const entry of entries.filter(item => item.alliedFor?.type)) {
    if (!alliedGroups.has(entry.alliedFor.type)) alliedGroups.set(entry.alliedFor.type, []);
    alliedGroups.get(entry.alliedFor.type).push(entry);
  }
  if (daemonGate && !daemonGate.selected) {
    const gatedNativeDaemons = entries.filter(entry => isNativeSummonedDaemon(armyDefinition, entry));
    if (gatedNativeDaemons.length) {
      warnings.push(warning(
        "DAEMON_DETACHMENT_REQUIRED",
        `Summoned Daemon units in ${armyDefinition.faction.replace(/^Chaos - /, "")} require the ${daemonGate.requiredDetachmentName} detachment.`,
        gatedNativeDaemons.map(item => item.instanceId),
        { requiredDetachmentName: daemonGate.requiredDetachmentName }
      ));
    }
  }
  const battleSizeSlots = Math.max(1, Math.min(3, Math.ceil(Number(options.pointsLimit || 1000) / 1000)));
  for (const [type, allied] of alliedGroups) {
    const ids = allied.map(item => item.instanceId);
    if (type === "agents") {
      const characters = allied.filter(item => item.roles.character).length;
      const retinue = allied.filter(item => item.categories.includes("Retinue")).length;
      if (characters > battleSizeSlots || retinue > battleSizeSlots) {
        warnings.push(warning("AGENTS_ALLY_LIMIT_EXCEEDED", `Agents allies include ${characters} Character and ${retinue} Retinue units; this battle size allows ${battleSizeSlots} of each.`, ids));
      }
    } else if (["imperialKnights", "chaosKnights"].includes(type)) {
      const titanic = allied.filter(item => item.categories.includes("Titanic")).length;
      const armigers = allied.filter(item => item.categories.includes("Armiger") || item.name.startsWith("War Dog ")).length;
      if (titanic > 1 || armigers > 3 || (titanic && armigers)) {
        warnings.push(warning("KNIGHT_ALLY_LIMIT_EXCEEDED", `Knight allies may be either 1 Titanic model or up to 3 Armiger/War Dog models.`, ids, { titanic, armigers }));
      }
    } else if (type === "chaosDaemons") {
      if (daemonGate && !daemonGate.selected) {
        warnings.push(warning(
          "DAEMON_DETACHMENT_REQUIRED",
          `Chaos Daemons allies require the ${daemonGate.requiredDetachmentName} detachment.`,
          ids,
          { requiredDetachmentName: daemonGate.requiredDetachmentName }
        ));
      } else if (daemonGate) {
        const mismatched = allied.filter(entry => !daemonUnitMatchesGate(entry, daemonGate));
        if (mismatched.length) warnings.push(warning(
          "DAEMON_ALLEGIANCE_MISMATCH",
          `${armyDefinition.faction.replace(/^Chaos - /, "")} may only include ${daemonGate.daemonKeyword} Daemons via ${daemonGate.requiredDetachmentName}.`,
          mismatched.map(entry => entry.instanceId),
          { requiredDetachmentName: daemonGate.requiredDetachmentName, daemonKeyword: daemonGate.daemonKeyword }
        ));
      }
      const alliedPoints = allied.reduce((sum, item) => sum + item.points, 0);
      const pointCap = Number(options.pointsLimit || 0) * 0.25;
      if (pointCap > 0 && alliedPoints > pointCap) {
        warnings.push(warning("DAEMON_ALLY_POINTS_EXCEEDED", `Daemon allies cost ${alliedPoints} points; the allied allowance is ${pointCap} points.`, ids, { alliedPoints, pointCap }));
      }
      for (const god of ["Khorne", "Tzeentch", "Nurgle", "Slaanesh"]) {
        const godUnits = allied.filter(item => item.categories.includes(god));
        const battleline = godUnits.filter(item => item.roles.battleline).length;
        const other = godUnits.length - battleline;
        if (other > battleline) warnings.push(warning("DAEMON_ALLY_BATTLELINE_REQUIRED", `${god} Daemon allies need at least one Battleline unit for each non-Battleline unit.`, godUnits.map(item => item.instanceId), { god, battleline, other }));
      }
    } else if (type === "astraMilitarum") {
      const alliedPoints = allied.reduce((sum, item) => sum + item.points, 0);
      const pointCap = Number(options.pointsLimit || 0) * 0.5;
      if (pointCap > 0 && alliedPoints > pointCap) warnings.push(warning("BROOD_BROTHERS_POINTS_EXCEEDED", `Astra Militarum allies cost ${alliedPoints} points; the Brood Brothers allowance is ${pointCap} points.`, ids));
    }
  }

  const attachedLeaders = new Set();
  const targetCounts = new Map();
  for (const attachment of armyState?.attachments || []) {
    const leader = byInstance.get(attachment.leaderInstanceId);
    const target = byInstance.get(attachment.targetInstanceId);
    if (!leader || !target) {
      warnings.push(warning("ATTACHMENT_UNIT_MISSING", "A leader attachment refers to a unit that is no longer in the roster.", [attachment.leaderInstanceId, attachment.targetInstanceId].filter(Boolean)));
      continue;
    }
    if (attachedLeaders.has(leader.instanceId)) warnings.push(warning("LEADER_ATTACHED_TWICE", `${leader.name} is attached more than once.`, [leader.instanceId]));
    attachedLeaders.add(leader.instanceId);
    targetCounts.set(target.instanceId, (targetCounts.get(target.instanceId) || 0) + 1);
    if (!leader.roles.leader || !leaderCanTarget(leader, target)) {
      warnings.push(warning("LEADER_ATTACHMENT_INVALID", `${leader.name} cannot lead ${target.name}.`, [leader.instanceId, target.instanceId]));
    }
  }
  for (const [targetId, count] of targetCounts) {
    const target = byInstance.get(targetId);
    const targetAttachments = (armyState?.attachments || []).filter(item => item.targetInstanceId === targetId);
    const allowsMultiple = Boolean(target?.rosterRules?.allowsMultipleLeadersAsBodyguard)
      || targetAttachments.some(item => {
        const leader = byInstance.get(item.leaderInstanceId);
        return Boolean(leader?.rosterRules?.allowsAdditionalLeader || leader?.roles?.support);
      });
    if (count > 1 && !allowsMultiple) warnings.push(warning("BODYGUARD_HAS_MULTIPLE_LEADERS", `${target?.name || "A unit"} has ${count} Leaders attached.`, [targetId, ...targetAttachments.map(item => item.leaderInstanceId)], { count }));
  }

  const seenBearers = new Set();
  const assignments = armyState?.enhancements || [];
  if (assignments.length > 3) warnings.push(warning("ENHANCEMENT_LIMIT_EXCEEDED", `${assignments.length} enhancements selected; the limit is 3.`));
  const enhancementCounts = new Map();
  for (const assignment of assignments) {
    const enhancement = (armyDefinition?.enhancements || []).find(item => item.id === assignment.enhancementId);
    const bearer = byInstance.get(assignment.bearerInstanceId);
    if (!enhancement || !enhancementAvailable(enhancement, armyState)) {
      warnings.push(warning("ENHANCEMENT_NOT_AVAILABLE", "An enhancement is not available for the selected detachment.", [assignment.bearerInstanceId].filter(Boolean)));
    } else if (!bearer || !canBearEnhancement(enhancement, bearer)) {
      warnings.push(warning("ENHANCEMENT_BEARER_INELIGIBLE", `${enhancement.name} has an ineligible bearer.`, [assignment.bearerInstanceId].filter(Boolean)));
    }
    const count = (enhancementCounts.get(assignment.enhancementId) || 0) + 1;
    enhancementCounts.set(assignment.enhancementId, count);
    const maxSelections = Number(enhancement?.maxSelections || 1);
    if (count > maxSelections) {
      warnings.push(warning("ENHANCEMENT_DUPLICATE", `${enhancement?.name || "An enhancement"} selected ${count} times; the limit is ${maxSelections}.`));
    }
    if (seenBearers.has(assignment.bearerInstanceId)) warnings.push(warning("BEARER_HAS_MULTIPLE_ENHANCEMENTS", `${bearer?.name || "A unit"} has more than one enhancement.`, [assignment.bearerInstanceId]));
    seenBearers.add(assignment.bearerInstanceId);
  }

  const points = Number(options.totalPoints || 0);
  if (pointsLimit > 0 && points > pointsLimit) warnings.push(warning("POINTS_LIMIT_EXCEEDED", `Roster is ${points} points; the limit is ${pointsLimit}.`, [], { points, pointsLimit }));

  return { legal: warnings.length === 0, warnings, points, pointsLimit, detachmentPoints, detachmentPointLimit };
}

function detachmentPointLimitFor(pointsLimit) {
  const limit = Number(pointsLimit || 0);
  if (limit <= 0) return 0;
  if (limit <= 1000) return 2;
  if (limit <= 2000) return 3;
  return 4;
}

function validateArmyState(armyDefinition, armyState, rosterEntries, options) {
  return validateRosterLegality(armyDefinition, armyState, rosterEntries, options).warnings;
}

function calculateArmyOptionPoints(armyDefinition, armyState) {
  const detachmentPoints = selectedDetachments(armyDefinition, armyState)
    .reduce((sum, detachment) => sum + Number(detachment.points || 0), 0);
  return detachmentPoints + (armyState?.enhancements || []).reduce((sum, assignment) => {
    const enhancement = (armyDefinition?.enhancements || []).find(item => item.id === assignment.enhancementId);
    return sum + Number(enhancement?.points || 0);
  }, 0);
}

function enhancementPointsByBearer(armyDefinition, armyState) {
  const byBearer = new Map();
  for (const assignment of armyState?.enhancements || []) {
    const enhancement = (armyDefinition?.enhancements || []).find(item => item.id === assignment.enhancementId);
    const points = Number(enhancement?.points || 0);
    if (!assignment.bearerInstanceId || !points) continue;
    byBearer.set(assignment.bearerInstanceId, (byBearer.get(assignment.bearerInstanceId) || 0) + points);
  }
  return byBearer;
}

function getRosterPresentation(armyDefinition, armyState, rosterEntries, options = {}) {
  const entries = normalizeRosterEntries(rosterEntries, armyState);
  const byInstance = new Map(entries.map(entry => [entry.instanceId, entry]));
  const enhancementPoints = enhancementPointsByBearer(armyDefinition, armyState);
  const displayPoints = entry => Number(entry?.points || 0) + Number(enhancementPoints.get(entry?.instanceId) || 0);
  const warnings = options.warnings || validateRosterLegality(armyDefinition, armyState, entries, options).warnings;
  const warningFor = instanceIds => warnings.filter(item =>
    (item.affectedInstanceIds || []).some(instanceId => instanceIds.includes(instanceId))
  );
  const attachmentsByTarget = new Map();
  const attachedLeaderIds = new Set();

  for (const attachment of armyState?.attachments || []) {
    const leader = byInstance.get(attachment.leaderInstanceId);
    const bodyguard = byInstance.get(attachment.targetInstanceId);
    if (!leader || !bodyguard) continue;
    if (!attachmentsByTarget.has(bodyguard.instanceId)) attachmentsByTarget.set(bodyguard.instanceId, []);
    attachmentsByTarget.get(bodyguard.instanceId).push({ leader, bodyguard, attachment });
    attachedLeaderIds.add(leader.instanceId);
  }

  return entries
    .filter(entry => !attachedLeaderIds.has(entry.instanceId))
    .map(entry => {
      const relationships = attachmentsByTarget.get(entry.instanceId) || [];
      if (!relationships.length) {
        return {
          id: entry.instanceId,
          kind: "unit",
          title: entry.name,
          totalPoints: displayPoints(entry),
          basePoints: entry.points,
          enhancementPoints: Number(enhancementPoints.get(entry.instanceId) || 0),
          memberInstanceIds: [entry.instanceId],
          bodyguard: null,
          leaders: [],
          entries: [entry],
          warnings: warningFor([entry.instanceId])
        };
      }

      const leaders = relationships.map(item => item.leader);
      const memberInstanceIds = [entry.instanceId, ...leaders.map(item => item.instanceId)];
      return {
        id: `attached:${entry.instanceId}`,
        kind: "attached",
        title: `${entry.name} + ${leaders.map(item => item.name).join(" + ")}`,
        totalPoints: [entry, ...leaders].reduce((sum, item) => sum + displayPoints(item), 0),
        basePoints: [entry, ...leaders].reduce((sum, item) => sum + Number(item.points || 0), 0),
        enhancementPoints: memberInstanceIds.reduce((sum, instanceId) => sum + Number(enhancementPoints.get(instanceId) || 0), 0),
        memberInstanceIds,
        bodyguard: entry,
        leaders,
        entries: [entry, ...leaders],
        warnings: warningFor(memberInstanceIds)
      };
    });
}

const armyApi = {
  calculateArmyOptionPoints,
  canAddUnitForSelectedDetachment,
  canSelectWarlord,
  createArmyState,
  detachBodyguard,
  daemonDetachmentAllowsSummons,
  detachmentPointLimitFor,
  availableForceDispositions,
  enhancementPointsByBearer,
  effectiveKeywordsForEntry,
  getEnhancementStates,
  getRosterPresentation,
  getUnitAssignmentState,
  leaderCanTarget,
  pruneArmyStateForRoster,
  selectDetachment,
  selectedForceDisposition,
  selectedDetachment,
  selectedDetachments,
  selectedDetachmentIds,
  selectedOpponentForceDisposition,
  selectedPrimaryMission,
  setForceDisposition,
  setSelectedDetachments,
  setOpponentForceDisposition,
  setEnhancement,
  setLeaderAttachment,
  setWarlord,
  validateArmyState,
  validateRosterLegality
};

if (typeof module !== "undefined" && module.exports) module.exports = armyApi;
if (typeof window !== "undefined") window.ArmyEngine = armyApi;
