# Local faction progression

Each Order of Battle now has Units and faction tabs. Faction panels are defined in `src/domain/crusade-trackers.js`; their editors and actions are in `mobile/ui/crusade-trackers-ui.js`. They share the existing Crusade storage, backup validation, rules reader, and catalogue builder.

## Coverage

The 22 bespoke faction rule sets present in the supplied 10th-edition HTML have panel definitions. Black Templars, Dark Angels, Blood Angels, and Space Wolves add panels to the shared Marine rules. Other Marine chapters inherit the Marine panels. The supplied Daemons, Titanicus and Unaligned pages contain no bespoke Crusade section; the UI explicitly reports that gap.

Every defined panel supports persistent typed fields, unit references where applicable, named records, notes, and a faction action history. Completed and abandoned records stay available. Single resource banks are singleton panels. Linked progression also appears in unit details.

## Guided actions

- Sisters: choose a Saint Potentia, record Trials, Saint and Martyr Points, claim unique Saintly Rewards, resolve martyrdom, retire the martyr with selected witness XP, and start a successor. Glorious Redemption uses a chosen, already configured new unit of an allowed type, checks final supply, spends RP, retains the retired Repentia and transfers appropriate awards. Individual weapon modifications require equipment review. The extra Battle Trait is explicitly claimed in the existing awards picker.
- Tyranids: roll or choose world type, review generated thresholds, track cumulative biomass and per-stage battles, apply a recorded battle once, advance stages, record once-per-stage requisition spending, perform Biogenesis, archive or abandon a world, and generate the next. Supply, XP and RP Biogenesis effects apply directly; requisition-based upgrades retain a review note for the catalogue/equipment step.
- T’au: generate 4/6/8 planets, roll or choose temperament, apply starting power modifiers, resolve Trade Contacts, name planets and adjust power, spend points on takeovers tied to distinct recorded victories, enforce Core World prerequisites, record razing, purchase supply lines, archive systems and generate another. Military Base supply lines apply supply directly. Other Assimilation and Supply Line effects remain explicit manual resolutions using the reference and saved panels.
- Custodes and Guard: setup generators for distinct Imperatives and Tour requirements. Other progress is entered in the corresponding panel.
- World Eaters: record per-unit skull pools, resolve a Judgement roll, record the reward-table instruction and reset the offered skulls. Conditional tests and selected rewards are resolved separately.
- Grey Knights: interactive 3×3 vision states and Malefic-line detection; positions refer to the source tracker. Incursion and reward records have separate panels.

Other factions currently use editable tracker panels rather than automatic resolution of every table, crafting recipe, promotion, faction test or battle reward. Stash limits represented by images in the supplied source are not guessed. No automatic post-battle agenda parser or campaign-management service has been added.

Death Guard has a dedicated rules sheet and ordered workflow, detailed in `docs/death-guard-crusade.md`. The older generic panel data remains readable; opening it does not rewrite existing records.

## Data and undo

`factionProgression` is optional, versioned data inside the existing Order of Battle schema. Viewing an old force does not initialize or rewrite it. Unit builder saves preserve it; muster snapshots copy the panels without the action log.

Each action clones the force, validates its result and records the affected panels, resources and individual units. Undo checks the recorded after-state before restoring a field, so it rejects a rollback that would overwrite newer changes. Retired units remain valid tracker references. Actions are persisted through the existing save queue and storage transaction.

Tests cover faction coverage, backup round trips, catalogue preservation, generation, progression gates, chosen replacement types, once-only spending, retirement, battle snapshots, invalid inputs, UI escaping and undo conflicts. Browser checks use a separate loopback origin and test forces, leaving the existing preview library and the installed `G:\AAA` copy unchanged.
