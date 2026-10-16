# Implementation status — 16 October 2026

The user subsequently authorized 40k.app as the more accurate source for **all 111 linked Blood Angels datasheets**, including shared Marines and Legends. The website snapshot now overrides their stats, weapons, unit abilities, printed keywords, attachment eligibility and points within the Blood Angels faction. Other chapters are unchanged by this overlay. The audit below records the original comparison; its requests to verify the official app or retain MFM attachment conflicts are superseded by that authorization.

Implemented loadout changes include the merged Sanguinary Guard weapon and removed banner; independent foot Death Company weapon choices and rifle/launcher options; jump captain shield bundles; and the consolidated Sicaran turret choices. Old unit selection keys/names are retained as recovery aliases for consolidated Death Company, Sicaran and bike-captain sheets. Changed or illegal saved equipment can still require review during roster recovery. Unlisted legacy datasheets have been retained rather than inferred retired from absence on the website.

The following source oddities are intentionally preserved: Mephiston’s supercharged plasma lacks Hazardous; the jump Death Company Captain’s supercharged plasma lacks Close-quarters and his printed keywords omit Imperium; and the Apothecary’s Reductor Pistol appears in the ranged section with Melee range. Astorath’s broken hyperlink markup is repaired typographically to [DEVASTATING WOUNDS: NON-MONSTER/VEHICLE], retaining the charge condition and his axe’s separately printed native Devastating Wounds. Scouts follow the site at T4. Judiciar and Astraeus invulnerable saves keep their melee-only and ranged-only restrictions respectively.

Source snapshot: `data/manual-rules/wh40k-11e-blood-angels-website.json`. Regression coverage: `test/blood-angels-website.test.js`. This is a local data update; no version bump or public release is included.

---

# Blood Angels datasheet audit — 16 October 2026

**Result:** all 14 Blood Angels-specific datasheets have at least one substantive discrepancy against the linked reference. Their effective MFM prices are current; many abilities, weapons and equipment options are older. Fixing Toughness alone did not reconcile these datasheets.

Reference: [40k.app Blood Angels roster](https://www.40k.app/factions/blood-angels). This is an independent, unofficial reference, not the Games Workshop app. Differences below are **our current local data → the website**. No rules, points, keywords, loadouts, installed app files or releases were changed for this audit.

## Scope and evidence

Read all **111** linked datasheets: **14** Blood Angels-specific, **97** shared/Legends; **28** are in the site's Legends section. Compared against the rebuilt local Blood Angels bundle, including the unpublished standard-Marine T5 correction. All 111 have a local counterpart after resolving the Sicaran consolidation and Defence/Defense spelling alias.

- [Complete unit-by-unit register](../reports/40k-app-ba-audit-2026-10-16/complete-register.md): every source URL, stat/weapon differences, keyword differences, rule-text review flags, and local entries absent from the source index.
- [Structured comparison](../reports/40k-app-ba-audit-2026-10-16/comparison.json): machine-readable findings, scope, source caveats and the SHA-256 of the local bundle audited.
- Mechanical review is detailed below for all 14 chapter-specific units. Shared-unit rule-text flags are a review queue, not a claim that every wording change alters mechanics. Every possible shared-unit wargear permutation was not validated.

## Priority Blood Angels corrections

### Sanguinary Priest

[Source](https://www.40k.app/factions/blood-angels/units/sanguinary-priest)

- **Blood Chalice:** our melee AP improvement while leading is replaced by **+1 Toughness for the unit**.
- **Narthecium:** source has a Command-phase **D3+1 wound heal**, once per turn per unit. Missing locally.
- The local ability granting the led unit **Feel No Pain 5+** is not on the source sheet.
- Chainsword **S4 → S5**. Other printed basic stats and the pistol match after the T5 correction.
- Support targets: source adds **Company Heroes** and omits **Devastator Squad** and **Tactical Squad**. Local data already identifies Support; the attachment list and old leading-dependent rule text still need revision.
- Current effective price **60** matches. Do not mistake the stale raw pricing.base field for the price actually charged by the MFM overlay.

### Sanguinary Guard

[Source](https://www.40k.app/factions/blood-angels/units/sanguinary-guard)

- **OC1 → OC2** before optional equipment. T5 already matches the recent local correction.
- Angelus boltgun: **12" → 18"; A2 → A3; BS3+ → BS2+; S4 → S5; AP0 → AP-1**. Source has Assault and Close-quarters.
- Inferno pistol: **6" → 9"; BS3+ → BS2+; AP-4 → AP-3; D3 → D3+2; Melta 2 → Melta 1**.
- Source combines melee into **Encarmine Weapon** with Lance, matching the old Spear profile. The separate AP-3 Blade choice is absent.
- **Heirs of Azkaellon:** local protection requires a Character and only affects melee; source protects against attacks whose Strength exceeds the unit's Toughness, with no listed Character requirement.
- **Angelic Visage** is substantively equivalent. The local optional Sanguinary Banner is not listed on the source sheet; do not add its old OC bonus on top of the new baseline without verification.
- Source keyword list includes **Tacticus**, missing locally. Points match: **135/275**, third copy onward **+15**.

### Chief Librarian Mephiston

[Source](https://www.40k.app/factions/blood-angels/units/chief-librarian-mephiston)

- **M7" → M8"; T5 → T6; invulnerable save 5+ → 4+**.
- Fury of the Ancients, witchfire/focused: **S4/5 → S5/6**, damage **D3 → 2/3**. Source replaces the local Sustained Hits profiles with Assault/Close-quarters psychic profiles.
- Vitarus **S9 → S10**, damage **D3 → 3**.
- Local Quickening is automatic advance-and-charge eligibility. Source Quickening is a **Command-phase psychic roll** that activates Assault Doctrine; rolling 1 battle-shocks the unit.
- Transfixing Gaze changes from a passive fall-back aura to a psychic roll at the start of the opponent's Movement phase. Failure/scope/timing need the new text.
- Source explicitly lists psyker level 3 and the two psychic abilities. Plasma keyword anomalies are flagged below.
- Effective price **175** matches.

### Commander Dante

[Source](https://www.40k.app/factions/blood-angels/units/commander-dante)

- Perdition becomes Perdition Pistol: **6" → 9"; S9 → S10; AP-4 → AP-3; D6 → D3+2; Sustained Hits D3 → Sustained Hits 1**. Melta 2 remains; source uses Close-quarters.
- Local **Lord Regent** gives a led unit +1 Advance/Charge and +1 hit. Source **Warden of the Imperium Nihilus** instead keeps **Assault and Tactical Doctrines** active alongside other doctrines.
- Death Mask of Sanguinius is substantively equivalent: Fight-phase battle-shock within 6", at -1. His statline and Axe Mortalis match after T5.
- Effective Leader targets match; an older printed Leader ability still mentions Assault Squad with Jump Packs and should be reconciled with the effective list.
- Effective price **140** matches.

### Astorath

[Source](https://www.40k.app/factions/blood-angels/units/astorath)

- **Mass of Doom:** source restricts the charge-triggered Devastating Wounds effect to non-MONSTER/VEHICLE targets; local text is unrestricted. The source has broken inline markup here, so this restriction needs official-app confirmation.
- **Redeemer of the Lost:** source checks whether the unit has been selected to fight, adds **+1 to the roll** when the destroyed model was engaged with an enemy of at least equal Toughness, and changes the delayed-removal timing. Local text lacks the Toughness bonus and uses a per-model fought check.
- Source adds **Tacticus**. Statline, axe profile and effective **90** points match.

### Lemartes

[Source](https://www.40k.app/factions/blood-angels/units/lemartes)

- **W4 → W5**.
- Absolvor bolt pistol **AP-1 → AP-2**; source uses Close-quarters.
- Blood Crozius **A5 → A6**, gains **Cleave 1**.
- Fury Unbound and Guardian of the Lost no longer say “while leading”; source states their unit-wide effects directly. This matters for the model operating alone.
- Source adds **Death Company** and **Tacticus**. Effective **110** points match.

### The Sanguinor

[Source](https://www.40k.app/factions/blood-angels/units/the-sanguinor)

- Aura of Fervour changes from **6" → 12"**, and the source lists **Leadership rerolls only**; local text also includes battle-shock rerolls.
- Miraculous Saviour appears substantively equivalent. British/American spelling and the usage limit moving into the ability title are not missing abilities.
- Source adds **Tacticus**. Stats, broadsword and **120** points match.

### Blood Angels Captain

[Source](https://www.40k.app/factions/blood-angels/units/blood-angels-captain)

- Heavy bolt pistol and master-crafted chainsword **S4 → S5**; relic weapon **S5 → S6**.
- Inferno pistol: **6" → 9"; AP-4 → AP-3; D3 → D3+2; Melta 2 → Melta 1**; Close-quarters replaces Pistol.
- Source omits Tactical Squad from the Captain's attachments.
- Strategic Acumen and Finest Hour appear substantively aligned; punctuation and the presentation of the once-per-battle limit differ.
- Effective **90** points match.

### Death Company Captain

[Source](https://www.40k.app/factions/blood-angels/units/death-company-captain)

- Master-crafted chainsword **A7 → A8, S4 → S5**, gains Sustained Hits 1; power fist **A5 → A6**; relic weapon **A6 → A7, S5 → S6**; heavy bolt pistol **S4 → S5**.
- Inferno pistol changes as on the Blood Angels Captain.
- **Forlorn Hero:** source simply grants Scouts 6"; the old leading and starting-embarked conditions are absent.
- **Black Rage:** full melee hit rerolls become **rerolls of 1**. The proximity-based fall-back/OC restriction remains.
- Death Visions is present under a slightly different name locally, but its Fight-phase timing and engaged-Warlord condition need reconciliation.
- Separate Death Company Marines with Bolt Rifles is not a source attachment target. Effective **80** points match.

### Death Company Captain with Jump Pack

[Source](https://www.40k.app/factions/blood-angels/units/death-company-captain-with-jump-pack)

- Chainsword **A7 → A8, S4 → S5**, gains Sustained Hits 1; relic weapon **S5 → S6**; heavy bolt pistol **S4 → S5**.
- Both plasma pistol profiles **BS3+ → BS2+**.
- Source includes **Thunder Hammer / Relic Shield equipment combinations**, missing locally; Relic Shield gives its bearer +1 W. Source thunder hammer: A5, WS3+, S8, AP-2, D3.
- Black Rage rerolls change to 1s. Lost to Fury loses the explicit leading condition; Death Visions timing/condition changes as above.
- Source plasma and keyword omissions need confirmation below. Effective **85** points match.

### Death Company Marines

[Source](https://www.40k.app/factions/blood-angels/units/death-company-marines)

- Source consolidates bolt-rifle Marines into this sheet: two bolt-rifle modes, combat blade, and frag/krak grenade-launcher profiles/options are absent from the local melee entry.
- Bolt-rifle modes: focused A1/S6/D2 with Heavy, saturation A2/S5/D1 with Assault; both 24", BS3+, AP-1 and Rapid Fire 1.
- Eviscerator **WS4+ → WS3+**, swaps Sustained Hits 1 for **Cleave 1**. Inferno pistol changes to the new 9"/AP-3/D3+2/Melta 1 profile.
- Black Rage uses rerolls of 1, not full rerolls.
- An Honourable Death in Combat appears substantively equivalent.
- Source has **5–10 models**. The old separate Intercessor/Bolt Rifle/Marines entries need identity and saved-roster migration review, not blind deletion. Points **90/170**, third copy onward **+15**, match.

### Death Company Marines with Jump Packs

[Source](https://www.40k.app/factions/blood-angels/units/death-company-marines-with-jump-packs)

- **Savage Fury:** local charge rerolls become **+1 to charge rolls**.
- Black Rage changes to melee hit rerolls of 1.
- Inferno pistol and Eviscerator have the changes above.
- Source options per five models are independent: one fist, up to two power weapons, one eviscerator, one hand flamer, one inferno pistol and up to two plasma pistols. The existing repaired selection tree needs a quota-by-quota audit against this list before reuse.
- Points **130/260**, third copy onward **+30**, match.

### Baal Predator

[Source](https://www.40k.app/factions/blood-angels/units/baal-predator)

- Flamestorm cannon **A D6+3 → 6**; heavy flamer **A D6 → 3**. Both replace Ignores Cover with **Blast 2**, retaining Assault/Torrent.
- Twin assault cannon **AP0 → AP-2**, swaps Devastating Wounds for **Sustained Hits 1**.
- Heavy bolter gains **Rapid Fire 2**. Hunter-killer missile and storm bolter gain Assault on this sheet.
- Overcharged Engines appears equivalent. Effective **135**, third copy onward **+15**, match.

### Death Company Dreadnought

[Source](https://www.40k.app/factions/blood-angels/units/death-company-dreadnought)

- **M8" → M10"**.
- Blood fist bolt rifles **S4 → S5**. Blood fists **AP-2 → AP-3, D3 → D3+3**.
- Local Blood Talons Strike/Sweep profiles become one source profile: **A8, WS3+, S10, AP-2, D2**, with Cleave 2, Twin-linked and conditional Sustained Hits 1 against non-MONSTER/VEHICLE targets.
- Twin multi-melta: **S9 → S10, AP-4 → AP-3, D6 → D3+2, Melta 2 → Melta 3**. Source twin heavy bolter omits Rapid Fire 2.
- **Driven by Fury:** trigger changes from losing a wound to **being hit**; surge **D6+2" → D6+1"**.
- Black Rage rerolls become 1s. Effective **165**, third copy onward **+20**, match.

## Shared roster findings

The complete register records all 97 shared/Legends pages. Examples of substantive differences beyond the Blood Angels-specific sheets:

| Unit | Our data → source |
|---|---|
| Apothecary Biologis | OC3 → OC1 |
| Captain in Phobos Armour | T5 → T4 |
| Librarian in Phobos Armour | M6" → M8" |
| Incursors and Reivers | M6" → M8" for squad and sergeant |
| Scout Squad | T5 → T4; this conflicts with the recent blanket T5 correction and is not applied automatically |
| Thunderhawk Gunship | M20+" → M14"; inspect the old Aircraft interaction before changing |
| Land Raider Excelsior | Source has a 5+ invulnerable save absent locally |
| Ancient | Ceramite fists A5 → A4 |
| Captain with Jump Pack | Heavy/plasma pistol BS3+ → BS2+ |
| Lieutenant | Plasma pistol BS3+ → BS2+; master-crafted power weapon A6 → A5 |
| Lieutenant in Phobos Armour | Carbine S5 → S4, AP-1 → AP0; source has no listed Assault/Rapid Fire |
| Reiver Squad | Carbine 24"/A2 → 18"/A3; pistol AP-1 → AP-2 |
| Scout Squad | Combat knife A4 → A3 |
| Land Raider Crusader | Multi-melta D3+2 → D3+3; twin assault cannon AP-1 → AP-2 |
| Firestrike Servo-turrets | Autocannon A3 → A4 |
| Vindicator [Legends] | Demolisher A D6+3 → D3+3, D D6 → 4, Blast → Blast 1 |
| Whirlwind [Legends] | A D6+3 → 6, Blast → Blast 2 |

Many older Legends weapon profiles still use random flamer/plasma attacks and old melta/lascannon damage. These are individually listed in the register; do not perform one global weapon-name replacement because profiles differ by bearer.

Two false “missing unit” matches were resolved manually:

- **Sicaran:** source consolidates the Battle Tank, Arcus, Omega, Punisher and Venator onto one sheet. Current local entries are separate Legends units. Its weapon options and Armoured Spearhead need consolidation/migration review.
- **Tarantula Air Defence Battery:** local spelling is Air **Defense**. Source missiles A D6 → 3 and Blast → Blast 2; Overwatch changes from the old once-per-turn/0CP wording to once-per-phase/-1CP wording.

## Attachment differences that affect Blood Angels lists

Only source targets present in the Blood Angels roster are included here. The source's universal Marine attachments also name other chapters' units; those must not be added to Blood Angels automatically.

| Attaching unit | Source additions to our list | Our targets absent from source |
|---|---|---|
| Sanguinary Priest | Company Heroes | Devastator Squad; Tactical Squad |
| Blood Angels Captain | — | Tactical Squad |
| Death Company Captain | — | Death Company Marines with Bolt Rifles |
| Ancient | Vanguard Veteran Squad | Devastator Squad; Tactical Squad |
| Apothecary | Company Heroes | Devastator Squad; Tactical Squad |
| Apothecary Biologis; Gravis Captain | Both named Eradicator variants | — |
| Captain | Desolation Squad; Vanguard Veteran Squad | Tactical Squad |
| Chaplain | Vanguard Veteran Squad | Tactical Squad; Death Company Marines with Bolt Rifles |
| Judiciar | Vanguard Veteran Squad | Tactical Squad |
| Librarian | Vanguard Veteran Squad | Devastator Squad; Tactical Squad |
| Phobos Librarian | Scout Squad | — |
| Lieutenant | Desolation Squad; Vanguard Veteran Squad | Tactical Squad |
| Phobos Lieutenant | Eliminator Squad | — |
| Techmarine | — | Devastator Squad; Tactical Squad |

These are observed site-versus-local differences. Existing user instructions make the official MFM authoritative for attachment eligibility. Recheck the MFM before implementing any conflicting site attachment list.

## Items needing confirmation

1. **Astorath:** Mass of Doom has broken inline markup around non-MONSTER/VEHICLE. Do not guess the final legal wording.
2. **Mephiston:** source supercharged plasma pistol lacks Hazardous, despite his focused psychic attack having it. Verify the official app before removing Hazardous.
3. **Jump Pack Death Company Captain:** source supercharged plasma pistol lacks Close-quarters; the unit keyword list also omits Imperium. These look suspicious and are not assumed correct.
4. **Apothecary:** source displays Reductor Pistol with a Melee range in its ranged section. Verify the official sheet.
5. **Scout exception:** source explicitly says T4. The recent local blanket standard-infantry T5 overlay includes Scouts; this needs an explicit exception decision.
6. **Conditional saves:** Judiciar 4+* and Astraeus 5+* versus plain saves are not ordinary numeric changes. Inspect conditions before stripping asterisks.
7. **Text-only flags:** Finest Hour, Angelic Visage, Dante's Death Mask, Overcharged Engines, An Honourable Death in Combat and Miraculous Saviour have apparent formatting/name/paraphrase differences that should not be counted as new mechanics.
8. **Keyword metadata:** the site uses Explosives where many old profiles say Grenades, and omits catalogue-only model-name/Leader/Support tags. Do not strip functional internal metadata just to make strings identical.
9. **Name matching:** the register says “no exact name match” for some renamed/split profiles. That is not proof the weapon or ability is genuinely missing. Known Blood Angels aliases were manually resolved in this report.
10. **Legends and extra local entries:** not being indexed on this site does not prove a unit must be removed. Preserve saved-roster identities pending a retirement/consolidation decision.

## Suggested implementation order

1. Reconcile Priest, Sanguinary Guard and Mephiston from the official app, resolving the flagged website anomalies.
2. Update the shared Black Rage rule once, then reconcile each captain/Death Company sheet and its independent equipment quotas.
3. Replace chapter-specific weapons and abilities without changing unit selection keys; plan migrations for consolidated Death Company and Sicaran entries.
4. Verify attachment changes against the MFM, then reconcile shared Marine/Legends discrepancies.
5. Add regressions for conditional effects, bearer-only bonuses, usage limits, squad sizes and saved-roster recovery before publishing.

This audit does not publish or implement those changes.
