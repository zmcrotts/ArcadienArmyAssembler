'use strict';
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { extractNormalizedRuleset } = require('../src/rulesets/sources');
const loadout = require('../src/domain/loadout');
const { calculateEntryPoints } = require('../src/domain/pricing');
const { normalizeMfmName, canonicalUnitName } = require('../src/rulesets/mfm-normalization');
function audit(ruleset) {
  const units = ruleset.units.filter(u => u.faction.startsWith('Imperium - Adeptus Astartes'));
  const failures = [], defaults = [], schedules = [], options = [];
  for (const unit of units) {
    const entry = loadout.createDefaultRosterEntry(unit);
    const errors = loadout.validateLoadout(unit, entry);
    if (errors.length) defaults.push({ name: unit.name, faction: unit.faction, errors });
    const rows = unit.pricing?.mfmRows || [];
    const seen = new Set();
    for (const row of rows) {
      if (!row.modelCount || unit.name.includes('[Legends]')) continue;
      const key = [row.modelCount, row.copies.min, row.context].join(':');
      if (seen.has(key)) continue;
      seen.add(key);
      try {
        const sized = loadout.setUnitSize(unit, entry, row.modelCount);
        sized.context = { ...sized.context, previousCopies: row.copies.min, mfmContext: row.context };
        const actual = calculateEntryPoints(unit, sized);
        const result = { name: unit.name, faction: unit.faction, size: row.modelCount, previousCopies: row.copies.min, expectedBase: row.points, actualBase: actual.applied?.[0]?.value, total: actual.points, actualSize: loadout.getUnitSizeState(unit, sized).current, errors: actual.validationErrors };
        schedules.push(result);
        if (result.actualBase !== row.points || result.actualSize !== row.modelCount || result.errors?.length) failures.push(result);
      } catch (error) { failures.push({ name: unit.name, faction: unit.faction, row, error: error.message }); }
    }
    for (const option of loadout.listSelectableOptions(unit)) options.push({ unit: unit.name, faction: unit.faction, ...option, profiles: undefined });
  }
  const document = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../data/manual-rules/wh40k-11e-mfm-points.json')));
  const slugs = new Set(document.marineReconciliation.pages);
  const paidRows = document.changes.filter(c => slugs.has(c.factionSlug) && c.kind === 'wargear' && !c.legends);
  const gearFailures = [];
  for (const row of paidRows) {
    const faction = 'Imperium - Adeptus Astartes - ' + row.faction;
    const candidates = options.filter(o => (o.faction === faction || row.faction === 'Space Marines') && canonicalUnitName(o.unit) === canonicalUnitName(row.unitName) && normalizeMfmName(o.name) === normalizeMfmName(row.label).replace(/^per /, ''));
    if (!candidates.length || candidates.some(o => o.points !== row.points)) gearFailures.push({ row, candidates });
  }
  const missing = ruleset.sourceIssues.filter(i => i.change && slugs.has(i.change.factionSlug) && ['unit', 'wargear'].includes(i.change.kind));
  return { source: ruleset.spaceMarineUnitSource, summary: { marineDefinitions: units.length, chapterCatalogues: new Set(units.map(u => u.faction)).size, validatedSchedules: schedules.length, invalidDefaults: defaults.length, pricingFailures: failures.length, paidWargearRows: paidRows.length, wargearFailures: gearFailures.length, missingRows: missing.length }, defaults, failures, gearFailures, missing, schedules, options };
}
if (require.main === module) {
  const cached = process.argv.indexOf('--cached');
  const ruleset = cached >= 0 ? JSON.parse(zlib.gunzipSync(fs.readFileSync(process.argv[cached + 1]))) : extractNormalizedRuleset();
  const result = audit(ruleset);
  const destination = process.argv[process.argv.indexOf('--out') + 1];
  if (process.argv.includes('--out')) fs.writeFileSync(destination, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result.summary, null, 2));
  if (result.summary.invalidDefaults || result.summary.pricingFailures || result.summary.wargearFailures) process.exitCode = 1;
}
module.exports = { audit };
