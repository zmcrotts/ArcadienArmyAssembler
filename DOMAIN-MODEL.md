# Core Domain Model

The builder separates immutable imported rules from a player's configured
roster choices. The executable JSON contracts are in `schemas/`.

The current default ruleset is selected through `src/rulesets/sources.js`.
`wh40k-11e-vflam` is the primary source, while the original 10e BSData XML
snapshot remains available as a scaffold/reference ruleset.

## UnitDefinition

`UnitDefinition` is a normalized, edition-specific view of one selectable
BSData unit. It is generated from source data and is never mutated by the UI.

Identity uses two fields:

- `id` is the stable BSData target/definition ID.
- `selectionKey` combines the selecting catalogue and entry-link ID. This
  distinguishes the same shared definition when it is selectable in multiple
  factions or through different links.

Composition contains model selections with their BSData IDs, minimums,
maximums, default counts, and per-selection point costs. Group constraints
preserve rules such as “these model variants must total 10.”

`selectionTree` preserves the resolved BSData loadout hierarchy. Each
selectable occurrence has a path-stable ID plus its original definition ID,
allowing the same shared weapon or model definition to appear legally in more
than one option group.

Pricing contains:

- unit-level and faction-link base costs
- per-model/selection costs
- ordered `set`, `increment`, and `decrement` modifiers
- normalized condition trees for model counts and catalogue context
- raw BSData records for provenance and debugging

Project-owned auxiliary rule files are layered outside the base unit
definition. They should not mutate imported unit defaults.

## ArmyDefinition and ArmyState

`ArmyDefinition` is the normalized roster-level companion to `UnitDefinition`.
It preserves BSData detachments, detachment rules and costs, enhancement costs,
detachment visibility, detachment points, stratagem collections, core stratagem
collections, source provenance, and eligible unit selection keys. Chapter
catalogues use their primary-catalogue context when resolving inherited
Astartes detachments.

`ArmyState` stores the selected detachment, Warlord, Leader attachments, and
enhancement-to-roster-entry assignments. The pure engine in
`src/domain/army.js` validates roster-level legality and returns structured
warnings. Illegal choices remain representable and editable; changing a
detachment, for example, preserves stale enhancement selections and flags them.
The legality engine covers points, copy and role limits, Epic Hero uniqueness,
allied selection keys, Warlords, attachments, detachments, and enhancements.
Leader/bodyguard attachments are presented through derived roster groups rather
than by merging the underlying entries. A grouped attached unit has one display
row and a merged datasheet-style view, but each Leader and bodyguard keeps its
own instance ID, loadout selections, enhancement assignment, points, warnings,
and export record. Detaching the relationship or removing a member prunes only
the relevant army-state references and leaves surviving unit configuration
intact.

The active 11e catalogue source does not currently carry complete structured
detachment stratagem records. The ruleset registry layers New Recruit and local
manual sources into `ArmyDefinition` after extraction. The schema and UI
preserve stratagem collections with source metadata instead of inventing
catalogue content.

## RosterEntry

`RosterEntry` is one configured occurrence of a unit in a roster. It stores:

- a unique instance ID
- the referenced unit-definition ID
- selected counts keyed by stable BSData selection ID
- future wargear counts keyed by stable choice ID
- optional roster/catalogue context

It does not copy a full unit definition or store a mutable cached point total.
Points are calculated from the entry and its referenced definition.

## Loadout configuration

The loadout engine is in `src/domain/loadout.js`. It provides:

```js
createDefaultRosterEntry(unitDefinition)
listSelectableOptions(unitDefinition)
setSelection(unitDefinition, rosterEntry, optionId, count)
validateLoadout(unitDefinition, rosterEntry)
getConfiguredProfiles(unitDefinition, rosterEntry)
```

Defaults follow BSData `defaultSelectionEntryId` values and minimum selection
constraints. When no explicit default exists, the engine selects the basic
option with enough capacity to satisfy the group. A deterministic repair pass
resolves interacting nested constraints.

Changing a specialist model in a fixed-size or replacement group decreases
the default/basic sibling by the same amount. This keeps units such as Battle
Sisters at their configured squad size while exchanging an ordinary model for
a banner or special-weapon model.

Constraint modifiers and repeat rules are evaluated dynamically. A BSData
maximum that increments once for every ten models therefore permits one
Termagant special weapon at ten models and two at twenty.

Configured profiles contain only profiles reached through selected options.
Unselected Hive Tyrant weapons, for example, are not returned for display.

Crusade weapon modifications, enhancements, and Warlord infrastructure are
kept out of the base loadout tree. They belong to campaign and army-level
layers and can be added separately without contaminating unit defaults.

The printable Crusade sheet generator currently derives blank bookkeeping
fields from roster entries. Persistent Crusade state should be modeled as a
campaign/order-of-battle layer that references roster entry identity without
changing base `UnitDefinition` defaults.

## Point calculation

The pure calculation function is:

```js
calculateEntryPoints(unitDefinition, rosterEntry)
```

It lives in `src/domain/pricing.js` and:

1. validates direct model and group limits;
2. starts with BSData unit/faction-link base costs;
3. adds BSData per-selection costs;
4. evaluates ordered BSData point modifiers;
5. returns the effective points and a provenance list of applied operations.

Invalid entries throw `INVALID_ROSTER_ENTRY` unless the caller explicitly
requests diagnostic calculation with `{ allowInvalid: true }`.

## BSData extraction and audit

`src/bsdata/unit-definitions.js` reads the active ruleset source through the
registry pipeline. It resolves shared entries and shared groups, preserves
model-count conditions, and produces normalized unit definitions.

Run the repeatable audit with:

```text
npm.cmd run audit:bsdata-pricing
```

Run the current ruleset health check with:

```text
npm.cmd run health
```

Outputs:

```text
data/audits/bsdata-unit-definitions.json
data/audits/bsdata-pricing-audit.json
data/audits/bsdata-pricing-audit.md
data/audits/bsdata-loadout-audit.json
data/audits/bsdata-loadout-audit.md
```

BSData-focused audits are still useful when extractor, pricing, or constraint
logic changes. The health check is the cheaper first pass for project status.
