# Death Guard Crusade implementation

The dedicated Death Guard UI follows the user's saved 10th-edition HTML and the linked printable tracker. It replaces free-form counters with six panels: A Grand Plague, Alchemical Pathogen, Battle review & research, Blessings, Boons & ascension, and Badges & reference.

## Source audit

`scripts/audit-death-guard-source.js` extracts the world presets from the HTML's graphic dots and copies the ten original PNGs. `ui/assets/crusade/death-guard/source-manifest.json` records their hashes and the source HTML/PDF hashes. The diagrams, six Path markers and three badges are bundled in both offline runtimes. The printable sheet was inspected visually because its page is a raster image. Its five property/drawback rows are represented by concise mechanical descriptions; the supplied HTML remains the complete prose reference.

Hive starts at 3/5/2, Agri at 5/2/3, and Forge at 2/3/5. The paired display combines world and plague characteristics with an exact-seven target. Suitability is fixed at creation. Old custom records remain saved and can be explicitly mapped to printed choices; configuration corrections retain previous properties.

## Implemented interactions

- World presets or three D6, optional Acceptable Offering rerolls, one active attempt, archived failures/abandonments and four reward tiers.
- Six ordered post-battle steps, both breakthrough checks, victory's +2 Cultivation modifier, double Cultivation, the Casket exception, minimum/maximum values and immediate population-zero failure.
- Four faction Agendas with per-unit XP caps, participating/surviving unit checks, optional already-recorded XP, and earned Brew/Tailor operations.
- Five fixed Pathogen properties, paired Drawbacks and suppression. Duration and Potency are derived from the marks, capped at five and seven. Tailoring requires a reduction before an improvement. Requisitions check timing, victory and RP before mutation.
- Six permanent unique Blessings. The four post-battle effects resolve once per battle; Eye of Nurgle and Fecund Fervour have an XP-already-recorded option. Vile Possession applies to new Vehicles and requires the pending Honour before muster. Seeping Poisons offers Lethal Hits instead of the normal two weapon modifications, affecting only the named physical weapon. Each owned Blessing adds one Crusade point to the muster snapshot.
- D33 Boons, maximum three, duplicate Spawndom, selected configured Spawn/Prince replacements, supply checks, retained retired records, XP transfer and pending replacement awards. Putrid Ascension requires confirmation of the rank advancement and spends 2 RP.
- Wretched Might's selected generated Battle Trait is copied into the next participating battle and cleared when that unit's game is recorded. Spreading Pox explicitly grants the exceptional 6 XP and pending Honour to the confirmed first new Poxwalkers unit. Ordinary Poxwalker/Plague Legion XP, Honours and Scars are blocked.
- Badge illustrations and computed prerequisites.
- Play Mode locks the mustered recipe, lists properties, drawbacks, Blessings and temporary traits, and supports own-Command-phase activation, Duration expiry, persisted activation history and Undo. Final records retain the battle state. No unsupported once-per-battle activation restriction is imposed.

These mechanics require the player to confirm tabletop facts: qualifying kills, the Casket bearer's position, first failed injury test, the actual generated trait, and the rank advancement. Conditional attack effects and ordinary Boon/relic/trait effects remain rules references; they are not a complete automatic combat engine. Pathogen activation does not rewrite weapon base statistics. Permanent individual Weapon Modifications do change their displayed profiles.

## Persistence and checks

Actions use the existing cloned, validated transaction/guarded-undo mechanism. Reviews are linked once to recorded battles; recipe changes and faction undo are blocked while a battle is active. Completed reviews retain their plague characteristics so later battles cannot change their displayed totals.

Dedicated tests cover the source asset hashes, presets, step order, early success, failure, requisitions, XP caps, rerolls, Potency, tailoring, Boons, replacements, immunity exceptions, new Vehicles, Blessings, activation expiry and escaped UI content. Browser verification uses the isolated `127.0.0.1:8768` test origin and a separate `Death Guard — source-matched demo` force. The installed app at `G:\AAA` is not updated by this work.
