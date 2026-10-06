# Space Marine points and wargear reconciliation — 5 October 2026

All twelve Marine chapter catalogues now use a pinned BSData Codex snapshot for unit selection trees, followed by the official MFM points overlay. Non-Marine points tables were retained. Existing chapter army rules and detachment rules from the supplied screenshots remain in place.

## Sources

- [Official MFM](https://mfm.warhammer-community.com/en/space-marines), with the Black Templars, Blood Angels, Dark Angels, Deathwatch and Space Wolves pages. Saved on 5 October 2026 at 23:26 UTC. The scraper now also resolves streamed price sections; this recovered Mephiston’s 175-point row.
- [BSData Space-Marine-Codex snapshot](https://github.com/BSData/wh40k-11e/tree/fec1542af46159845a3522ac4514b99d8979b9e9), committed on 5 October. This branch is still unmerged; it contains the new core Codex equipment trees that main lacks.
- [BSData main comparison](https://github.com/BSData/wh40k-11e/tree/ed8c3b09bc5eae7c30eb659f739b09c0f36381b4). The older codex-space-marines-11e-wip branch was inspected but not installed.
- Older Legends rows retain their 30 September MFM provenance; they are not presented as newly verified data.

## Corrections

- Standard Chaplain: 70 → 60 points across all chapters. Other Chaplain variants use their separate MFM prices.
- Replaced stale Marine weapon choices and constraints with the Codex branch’s trees, including Vanguard Veterans and the separate one- or two-model Invader ATVs unit.
- Corrected later-copy cost bands such as “YOUR 3RD + UNIT COSTS.”
- Applied all 51 current paid-wargear rows from the six Marine MFM pages. Removed the obsolete free Space Wolves storm-shield overrides.
- Preserved repeat conditions inherited through BSData modifier groups. Dropping those conditions incorrectly constrained ten-model Jump Intercessor squads.
- Repaired upstream structure: Invader ATVs were incorrectly classified as an upgrade; Terminator Ancient had a one-choice group containing two mandatory weapons; Inner Circle Companions lacked a six-model group maximum; heavy-bolter Eradicators had a five-model group maximum; Victrix defaulted to one model; Wolf Scout bundle labels were counted as nine/sixteen models instead of six/twelve.
- Used the updated Calgar in Armour of Antilochus entry for MFM’s “Marneus Calgar” price. The old Calgar-plus-retinue entry is superseded.
- Retained verified Blood Angels weapon-option corrections and MFM attachment roles. Updated the chainsword profile lookup for the new shared weapon name.

## Definite missing entry

**Kaius Konorius:** a current MFM price exists, but no usable entry exists in the inspected BSData branches. Please provide the complete datacard, including composition, weapons, wargear options, abilities, keywords and Leader restrictions. Its points have not been guessed.

## Datacards that would resolve remaining uncertainty

**Centurion Assault Squad, Hammerfall Bunker and Thunderhawk Gunship** have no additional unit-profile or option changes in the Codex branch compared with current main. That alone does not prove they are outdated. Their current datacards would confirm whether they should remain unchanged.

For completeness, the following native chapter entries also have no additional profile/option changes in this branch. They retain the existing main-branch data and any verified local corrections; these are comparison gaps, not a claim that every listed card is wrong.

- **Blood Angels:** Astorath; Commander Dante; Lemartes; Sanguinary Guard; The Sanguinor; Death Company Captain.
- **Dark Angels:** Azrael; Belial; Sammael; Asmodai; Lion El'Jonson; Lazarus; Nephilim Jetfighter; Ravenwing Dark Talon; Ravenwing Darkshroud; Deathwing Knights; Inner Circle Companions.
- **Deathwatch:** Watch Master; Watch Captain Artemis; Corvus Blackstar; Deathwatch Veterans; Decimus Kill Team.
- **Imperial Fists:** Darnath Lysander; Tor Garadon; Pedro Kantor.
- **Raven Guard:** Kayvaan Shrike.
- **Salamanders:** Adrax Agatone.
- **Space Marines:** Centurion Assault Squad; Hammerfall Bunker; Thunderhawk Gunship.
- **Space Wolves:** Arjac Rockfist; Ulrik the Slayer; Wulfen; Fenrisian Wolves; Iron Priest; Wulfen with Storm Shields.
- **Ultramarines:** Captain Sicarius; Cato Sicarius; Victrix Honour Guard.

## Units without a current active MFM schedule

These entries remain in BSData but have no matching price row in the saved active MFM pages. Their available BSData fallback prices were retained rather than inventing new points or declaring them Legends solely because they are absent. Confirmation of current availability and an official current price is needed; a Codex card alone may not establish the latest points.

- Crusader Squad
- Emperor's Champion (Anointed)
- Hammerfall Bunker
- Lieutenant in Reiver Armour
- Tactical Squad
- Suppressor Squad
- Devastator Squad
- Death Company Intercessors
- Death Company Marines with Bolt Rifles
- Pedro Kantor
- Captain Sicarius
- Uriel Ventris

The three [Crucible] custom-character entries are also outside the ordinary active MFM schedules. Their existing bespoke build costs were preserved. The Tarantula Sentry Battery [Legends] has older two/three-model MFM rows but its source definition only permits one model; an updated Legends datasheet is needed to resolve that composition discrepancy.

## Verification

Current active Marine price bands are checked at each listed squad size and copy band, including chapter overrides. Paid options are checked against MFM, and regression tests exercise actual vehicle/sergeant selections, per-model shields and six/twelve-model Wolf Scouts. No unresolved raw BSData links were found.

Full machine-readable audit: reports/sm-reconcile-2026-10-05/final-audit.json. Re-run with `node scripts/audit-space-marine-reconciliation.js --out reports/sm-reconcile-2026-10-05/final-audit.json`.

Verified results: 2,083 Marine definitions across twelve catalogues; 1,826 size/copy price bands and all 51 paid-wargear rows checked with zero pricing, default-loadout or wargear failures. Kaius Konorius is the sole unmatched current Marine unit price row.

The full root suite passed 363/363 tests. The final saved-roster compatibility check passed 27/27, mobile tests passed 86/86, and the offline-package test passed 1/1. Desktop and mobile packages built successfully; git diff --check passed.

The local runtime at G:\AAA was updated after backing up app.asar. All 203 built runtime files were verified inside the replacement archive, and all non-runtime archive files were preserved. The installed archive SHA-256 is aa4e49ab6a26ae95811ce341dabbc7156dc36d2dc6f2b6bb54086753b9590ad6. Rosters, exports and user-data were untouched. Reopen the installed app to load the updated data.
