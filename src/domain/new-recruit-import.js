"use strict";

(function () {
  const list = value => !value ? [] : Array.isArray(value) ? value : [value];
  const key = value => String(value || "").normalize("NFKD")
    .replace(/[\u2018\u2019\u201b\u2032]/g, "'")
    .replace(/[^a-zA-Z0-9']+/g, " ").toLowerCase().replace(/\s+/g, " ").trim();

  function isNewRecruitRoster(input) {
    const roster = input?.roster;
    return Boolean(roster && !Array.isArray(roster) && Array.isArray(roster.forces)
      && (/newrecruit/i.test(String(roster.generatedBy || ""))
        || roster.battleScribeVersion != null
        || /battlescribe/i.test(String(roster.xmlns || ""))));
  }

  function nested(selection) {
    const result = [];
    (function visit(node) {
      if (!node) return;
      result.push(node);
      for (const child of list(node.selections)) visit(child);
    }(selection));
    return result;
  }

  function categories(selection) {
    return list(selection?.categories).map(item => String(item?.name || ""));
  }

  function entryTokens(selection) {
    return String(selection?.entryId || "").split("::").filter(Boolean);
  }

  function identifyFaction(input, records) {
    if (!isNewRecruitRoster(input)) throw new Error("This is not a New Recruit roster JSON export.");
    if (!/11th edition/i.test(String(input.roster.gameSystemName || ""))) {
      throw new Error(`New Recruit roster uses an unsupported game system (${input.roster.gameSystemName || "unknown"}).`);
    }
    const candidates = [];
    for (const force of input.roster.forces) {
      if (force.catalogueName) candidates.push(force.catalogueName);
      for (const selection of list(force.selections)) {
        for (const category of categories(selection)) {
          if (/^faction\s*:/i.test(category)) candidates.push(category.replace(/^faction\s*:\s*/i, ""));
        }
      }
    }
    const shortened = value => key(value).replace(/^(imperium|chaos|xenos|aeldari|library) /, "");
    let match = null;
    for (const candidate of candidates) {
      for (const record of records || []) {
        const names = [record.id, record.label, ...list(record.modes).flatMap(mode => [mode.id, mode.label])];
        const score = names.reduce((best, name) => {
          if (key(candidate) === key(name)) return Math.max(best, 100);
          if (shortened(candidate) === shortened(name)) return Math.max(best, 90);
          if (shortened(candidate).endsWith(shortened(name)) || shortened(name).endsWith(shortened(candidate))) return Math.max(best, 60);
          return best;
        }, 0);
        if (!match || score > match.score) match = { candidate, record, score };
      }
    }
    if (!match || match.score < 60) throw new Error(`New Recruit faction is unavailable (${candidates.join(", ") || "unknown"}).`);
    const mode = list(match.record.modes).find(item =>
      key(item.id) === key(match.candidate) || shortened(item.id) === shortened(match.candidate)
    );
    return {
      faction: match.record.id,
      subfaction: mode?.id || match.record.defaultMode || match.record.id
    };
  }

  function makeIndex(definition) {
    const all = [];
    const parent = new Map();
    (function visit(node, owner = null) {
      if (!node) return;
      all.push(node);
      if (owner && node.id) parent.set(node.id, owner);
      for (const child of list(node.children)) visit(child, node);
    }(definition.selectionTree));
    return { all, parent };
  }

  function under(ancestor, node, parents) {
    for (let current = node; current; current = parents.get(current.id)) {
      if (current.id === ancestor?.id) return true;
    }
    return false;
  }

  function nodeIds(node) {
    return [node.id, node.sourceId, node.definitionId, node.targetId, ...String(node.id || "").split("/")].filter(Boolean);
  }

  function matchNode(selection, index, owner) {
    const pool = owner ? index.all.filter(node => node !== owner && under(owner, node, index.parent)) : index.all;
    const tokens = entryTokens(selection);
    const ids = pool.filter(node => tokens.some(token => nodeIds(node).includes(token)));
    if (ids.length) {
      const last = tokens[tokens.length - 1];
      return ids.find(node => [node.sourceId, node.definitionId, node.targetId].includes(last)) || ids[0];
    }
    const names = pool.filter(node => !["group", "unit"].includes(node.kind) && key(node.name) === key(selection.name));
    return names.length === 1 ? names[0] : null;
  }

  function unitIds(unit) {
    return [unit.id, unit.source?.linkId, unit.source?.targetId, unit.definition?.id,
      unit.definition?.source?.linkId, unit.definition?.source?.targetId,
      String(unit.selectionKey || "").split(":")[1]].filter(Boolean);
  }

  function matchUnit(selection, force, packages) {
    const tokens = entryTokens(selection);
    return (packages || []).map(unit => {
      let score = key(unit.name) === key(selection.name) ? 40 : 0;
      if (tokens.some(token => unitIds(unit).includes(token))) score += 100;
      if ((unit.source?.catalogueId || unit.definition?.source?.catalogueId) === force.catalogueId) score += 20;
      if (unit.definition?.sourceDisposition === "codex-current") score += 5;
      return { unit, score };
    }).filter(item => item.score >= 40).sort((a, b) => b.score - a.score)[0]?.unit || null;
  }

  function looksLikeUnit(selection) {
    const primary = list(selection.categories).find(item => item?.primary)?.name;
    if (key(primary) === "configuration") return false;
    if (["battle size", "detachment", "force disposition", "show hide options"].includes(key(selection.name))) return false;
    return ["unit", "model"].includes(String(selection.type || "").toLowerCase())
      || list(selection.profiles).some(profile => key(profile.typeName) === "unit");
  }

  function selectedNames(roster, group) {
    return list(roster.forces).flatMap(force => list(force.selections))
      .flatMap(nested)
      .filter(item => Number(item.number || 0) > 0 && key(item.group) === key(group))
      .map(item => item.name);
  }

  function named(records, name) {
    return (records || []).find(item => key(item.name) === key(name)) || null;
  }

  function importUnit(selection, unit, options, instanceId, warnings) {
    const definition = unit.definition || unit;
    const index = makeIndex(definition);
    let entry = options.engine.createDefaultRosterEntry(definition, instanceId);
    (function apply(source, owner = definition.selectionTree) {
      for (const child of list(source.selections)) {
        const metadata = /enhancements?/i.test(String(child.group || ""))
          || categories(child).some(name => key(name) === "warlord");
        const target = metadata ? null : matchNode(child, index, owner);
        if (target && !["group", "unit"].includes(target.kind)) {
          try {
            entry = options.engine.setSelection(definition, entry, target.id, Number(child.number || 0), false);
          } catch (error) {
            warnings.push(`${selection.name}: could not apply ${child.name} (${error.message}).`);
          }
        } else if (!metadata && !target && Number(child.number || 0) > 0
          && (["unit", "model"].includes(String(child.type || "").toLowerCase()) || /wargear/i.test(String(child.group || "")))) {
          warnings.push(`${selection.name}: could not match ${child.name}; the installed default was used.`);
        }
        apply(child, target || owner);
      }
    }(selection));
    return { instanceId, selectionKey: unit.selectionKey || definition.selectionKey, name: unit.name, entry };
  }

  function convertRoster(input, options = {}) {
    if (!isNewRecruitRoster(input)) throw new Error("This is not a New Recruit roster JSON export.");
    const roster = input.roster;
    const identity = options.identity || identifyFaction(input, options.factionRecords);
    const army = options.armyDefinition;
    if (!army) throw new Error(`No army definition is installed for ${identity.subfaction || identity.faction}.`);
    if (!options.engine?.createDefaultRosterEntry || !options.engine?.setSelection) throw new Error("The roster engine is unavailable.");

    const warnings = [];
    const imported = [];
    const missing = [];
    for (const force of list(roster.forces)) {
      for (const selection of list(force.selections)) {
        if (!looksLikeUnit(selection)) continue;
        const unit = matchUnit(selection, force, options.unitPackages);
        if (!unit) {
          missing.push(selection.name || "Unnamed unit");
          continue;
        }
        const copies = Math.max(1, Math.round(Number(selection.number || 1)));
        for (let copy = 0; copy < copies; copy += 1) {
          const base = String(selection.id || unit.id || "unit").replace(/[^a-zA-Z0-9_-]+/g, "-");
          const instanceId = `nr-${base}-${imported.length + 1}`;
          imported.push({ source: selection, record: importUnit(selection, unit, options, instanceId, warnings) });
        }
      }
    }
    if (missing.length) throw new Error(`New Recruit unit${missing.length === 1 ? "" : "s"} not found in the installed rules data: ${[...new Set(missing)].join(", ")}.`);
    if (!imported.length) throw new Error("No importable units were found in the New Recruit roster.");

    const state = options.armyEngine?.createArmyState ? options.armyEngine.createArmyState(army)
      : { schemaVersion: 1, attachments: [], enhancements: [], keywordAssignments: [] };
    const detachmentNames = selectedNames(roster, "Detachment");
    state.detachmentIds = detachmentNames.map(name => named(army.detachments, name)?.id).filter(Boolean);
    state.detachmentId = state.detachmentIds[0] || null;
    for (const name of detachmentNames) if (!named(army.detachments, name)) warnings.push(`Could not match detachment ${name}.`);
    const disposition = selectedNames(roster, "Force Disposition")[0];
    state.forceDispositionId = named(army.forceDispositions, disposition)?.id || null;
    if (disposition && !state.forceDispositionId) warnings.push(`Could not match force disposition ${disposition}.`);

    const nicknames = {};
    for (const item of imported) {
      const instanceId = item.record.instanceId;
      if (item.source.customName) nicknames[instanceId] = String(item.source.customName);
      const selections = nested(item.source);
      if (selections.some(selection => categories(selection).some(name => key(name) === "warlord"))) state.warlordInstanceId = instanceId;
      for (const selected of selections.filter(selection => Number(selection.number || 0) > 0 && /enhancements?/i.test(String(selection.group || "")))) {
        const enhancement = named(army.enhancements, selected.name);
        if (enhancement) state.enhancements.push({ enhancementId: enhancement.id, bearerInstanceId: instanceId });
        else warnings.push(`${item.source.name}: could not match enhancement ${selected.name}.`);
      }
    }

    const pointValue = costs => Number(list(costs).find(cost => key(cost.name) === "pts")?.value || 0);
    return {
      kind: "roster-engine.savedRoster",
      schemaVersion: 2,
      name: roster.name || "Imported New Recruit roster",
      ruleset: { id: army.rulesetId || "wh40k-11e-vflam", source: "new-recruit-json", generatedAt: null },
      faction: identity.faction,
      subfaction: identity.subfaction,
      pointsLimit: Number(list(roster.costLimits).find(cost => key(cost.name) === "pts")?.value || 1000),
      totalPoints: pointValue(roster.costs),
      armyState: state,
      rosterEntries: imported.map(item => item.record),
      rosterDisplay: { unitNicknames: nicknames },
      importSource: {
        format: "new-recruit-json",
        generatedBy: roster.generatedBy || null,
        gameSystemName: roster.gameSystemName || null,
        gameSystemRevision: roster.gameSystemRevision ?? null
      },
      importWarnings: [...new Set(warnings)]
    };
  }

  const api = { convertRoster, identifyFaction, isNewRecruitRoster, normalizeName: key };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.NewRecruitImport = api;
})();
