"use strict";
(function install(global) {
  const normal = value => String(value || "").toLowerCase().replace(/^faction:\s*/, "").replace(/[^a-z0-9]+/g, " ").trim();
  const combine = (values, type = "and") => type === "or"
    ? values.includes(true) ? true : values.includes(null) ? null : false
    : values.includes(false) ? false : values.includes(null) ? null : true;
  function unitContext(unit, force, data) {
    const keywords = new Set((unit.keywords || []).map(normal));
    for (const [key, value] of Object.entries(unit.roles || {})) if (value) keywords.add(normal(key));
    const source = unit.record?.source || {};
    const identityIds = new Set([source.targetId, unit.record?.definitionId, unit.selectionKey?.split(":").at(-1)].filter(Boolean));
    const catalogueIds = new Set([source.catalogueId, source.selectionCatalogueId].filter(Boolean));
    const factionKeywords = (unit.keywords || []).filter(key => /^faction:/i.test(key)).map(normal);
    const matches = catalogue => factionKeywords.some(key => normal(catalogue.name).includes(key))
      || normal(catalogue.name.replace(/library/ig, "")) === normal((data.catalogues?.[source.catalogueId]?.name || force.faction).replace(/library/ig, ""));
    // Imported allies use their own catalogue; do not inherit their host army's awards.
    if (source.selectionCatalogueId !== source.catalogueId && data.catalogues?.[source.selectionCatalogueId]
      && !matches(data.catalogues[source.selectionCatalogueId])) catalogueIds.delete(source.selectionCatalogueId);
    if (!catalogueIds.size) for (const [id, catalogue] of Object.entries(data.catalogues || {})) {
      if (catalogue.name === force.faction || catalogue.file === source.sourceFile || matches(catalogue)) catalogueIds.add(id);
    }
    for (const id of catalogueIds) for (const linked of data.catalogues?.[id]?.links || []) {
      if (data.catalogues[linked] && matches(data.catalogues[linked])) catalogueIds.add(linked);
    }
    return { keywords, source, identityIds, catalogueIds, primary: source.selectionCatalogueId || source.catalogueId };
  }
  function assess(record, unit, force, data) {
    const context = unitContext(unit, force, data);
    if (record.catalogueId && !context.catalogueIds.has(record.catalogueId)) return { status: "foreign", reason: "Different faction" };
    const reasons = [];
    let ownershipUnknown = false;
    if (record.allowedUnitIds?.length && !record.allowedUnitIds.some(id=>context.identityIds.has(id) || normal(data.references?.[id])===normal(unit.unitType))) {
      if (context.source.targetId) reasons.push("This table belongs to a different unit type");
      else ownershipUnknown = true;
    }
    if ((unit.awards || []).some(award => award.id === record.id)) reasons.push("Already assigned to this unit");
    if (record.kind === "relic") {
      if (!context.keywords.has("character")) reasons.push("Character models only");
      const xp = record.rarity === "Legendary" ? 51 : record.rarity === "Antiquity" ? 31 : 0;
      if (unit.xp < xp) reasons.push(`${record.rarity === "Legendary" ? "Legendary" : "Heroic"} rank required`);
      if ([...force.units, ...(force.retiredUnits || [])].some(other => other.id !== unit.id && other.awards.some(award => award.id === record.id))) reasons.push("This relic is already in your Order of Battle");
    }
    function condition(item) {
      const scope = item.scope;
      const ref = data.references?.[item.childId] || "";
      const category = data.categories?.[item.childId];
      let actual = null;
      if (/experience/i.test(data.costTypes?.[item.field] || "") && ["root-entry","ancestor","parent","model-or-unit"].includes(scope)) actual = unit.xp;
      else if (scope === "primary-catalogue" && data.catalogues?.[item.childId]) {
        if (!context.primary) return null;
        actual = context.primary === item.childId ? 1 : 0;
      } else if (scope === "roster" && /^Show (.+) content$/i.test(ref)) actual = force.packs.includes(/^Show (.+) content$/i.exec(ref)[1]) ? 1 : 0;
      else if (category && ["ancestor","parent","root-entry","model-or-unit"].includes(scope)) actual = context.keywords.has(normal(category)) ? 1 : 0;
      else if (["ancestor","parent","root-entry","model-or-unit"].includes(scope) && item.field === "selections" && ref) {
        if (context.identityIds.has(item.childId) || normal(unit.unitType) === normal(ref)) actual = 1;
        else if (["instanceOf","notInstanceOf"].includes(item.type)) actual = context.keywords.has(normal(ref)) ? 1 : 0;
        else {
          actual = (unit.awards || []).filter(award => award.sourceId === item.childId).length;
          for (const [key, count] of Object.entries(unit.record?.entry?.selections || {})) if (key.includes(item.childId)) actual += Number(count || 0);
          if (/Legendary Veterans/i.test(ref)) actual = null; // A requisition state not yet tracked.
        }
      }
      if (actual == null) return null;
      const target = Number(item.value || 0);
      return ({ instanceOf: actual > 0, notInstanceOf: actual === 0, equalTo: actual === target,
        notEqualTo: actual !== target, lessThan: actual < target, greaterThan: actual > target,
        atLeast: actual >= target, atMost: actual <= target })[item.type] ?? null;
    }
    function test(group) {
      if (group.childId) return condition(group);
      return combine([...(group.conditions || []).map(condition), ...(group.conditionGroups || []).map(test)], group.type);
    }
    let unknown = ownershipUnknown;
    for (const layer of record.visibility || []) {
      let hidden = layer.hidden, uncertain = false;
      for (const rule of layer.rules) {
        const applies = test(rule.test);
        if (applies === true) { hidden = rule.value; uncertain = false; }
        else if (applies === null) uncertain = true;
      }
      if (hidden && !uncertain) reasons.push(`Restricted by ${layer.name}`);
      if (uncertain) unknown = true;
    }
    return reasons.length ? { status: "restricted", reason: [...new Set(reasons)].join("; ") }
      : unknown ? { status: "review", reason: "Some source conditions need manual review" }
      : { status: "eligible", reason: "Matches the recorded unit and source restrictions" };
  }
  function tableLabel(record, data) {
    const own = record.visibility?.at(-1);
    const required = new Set(), excluded = new Set();
    function visit(value) {
      if (!value || typeof value !== "object") return;
      const category = data.categories?.[value.childId];
      if (category && value.type === "notInstanceOf") required.add(category);
      if (category && value.type === "instanceOf") excluded.add(category);
      for (const child of Object.values(value)) if (child && typeof child === "object") visit(child);
    }
    if (own?.name === record.name) visit(own.rules);
    const suffix = required.size ? [...required].join(" / ") + (excluded.size ? ` (excluding ${[...excluded].join(", ")})` : "") : "";
    return `${record.table || record.tableName || "Other table"}${suffix ? ` — ${suffix}` : ""}`;
  }
  function agendaPages(force, unitIds, data) {
    const selected = new Set(unitIds || force.units.map(unit=>unit.id));
    const identities = force.units.filter(unit=>selected.has(unit.id)).flatMap(unit=>{
      const source = unit.record?.source || {};
      const explicit = [...(unit.keywords || []).filter(key=>/^faction:/i.test(key)), data.catalogues?.[source.catalogueId]?.name].filter(Boolean);
      return explicit.length ? explicit.map(normal) : [normal(force.faction)];
    });
    if (!identities.length) identities.push(normal(force.faction));
    const matches = name => identities.some(identity=>` ${identity} `.includes(` ${normal(name)} `));
    return (data.localRules?.pages || []).filter(page=>{
      const aliases = page.faction === "Space Marines" ? ["Space Marines","Adeptus Astartes"] : page.faction === "Imperial Agents" ? ["Imperial Agents","Agents of the Imperium"] : [page.faction];
      return aliases.some(matches);
    }).map(page=>({...page,agendas:page.agendas.filter(agenda=>!agenda.chapter || matches(agenda.chapter)),sections:page.sections.filter(section=>{
      const chapter = /^(Black Templars|Dark Angels|Blood Angels|Space Wolves)/i.exec(section.name)?.[1];
      return !chapter || matches(chapter);
    })}));
  }
  function crusadeBooks(force,data,unitIds=null) {
    const units=unitIds?force.units.filter(unit=>unitIds.includes(unit.id)):force.units;
    const identities=units.flatMap(unit=>(unit.keywords || []).map(normal));
    const hasFaction=faction=>identities.includes(normal(faction)) || (!units.length && normal(force.faction).includes(normal(faction)));
    return (data.localRules?.books || []).filter(book=>book.pack==="Core" || (force.packs || []).includes(book.pack)).map(book=>({...book,agendas:book.agendas.filter(agenda=>(!agenda.requiresFaction||hasFaction(agenda.requiresFaction))&&(!agenda.excludesFaction||!hasFaction(agenda.excludesFaction)))}));
  }
  const api = { assess, tableLabel, agendaPages, crusadeBooks };
  global.ArcadienCrusadeEligibility = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
