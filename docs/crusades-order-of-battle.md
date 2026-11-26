# Local Crusades / Order of Battle

The Crusades tab is a local, persistent Order of Battle. Units retain their names,
base unit types, equipment, points, games, victories, XP, ranks, honours, scars,
relics, enhancements, and notes between games. Campaign hosting, participants,
stages, and shared campaign management are outside the requested scope.

Use bundled BSData as the first source for core, faction, Tyrannic War, Pariah
Nexus, Nachmund Gauntlet, and Armageddon content. Keep source labels and stable
source IDs. Do not present reference-only awards as automated stat changes.

## First implementation

- Crusades tab beside Lists and Games, local IndexedDB storage with a localStorage
  fallback, isolated from the normal roster library.
- Create a faction-selected empty force or import a complete saved list, list
  JSON file, or AAA share code. Each copy receives its own persistent identity.
- Add/configure units using the actual List builder: catalogue, squad sizes,
  wargear, enhancements, and calculated points. Unit Name is the first, always
  visible field in Crusade unit details and uses the existing nickname storage.
- Catalogue saves update equipment and names without resetting progression.
  Removed units retain their history as retired records.
- Searchable list/card views: custom unit name, base unit type, points including
  imported enhancements, rank, XP, victories, games, and radial status badges.
- Expanding a unit opens a collapsible full datasheet directly in the OoB:
  model profiles (M/T/SV/W/LD/OC/InSv), composition and equipment, ranged/melee
  weapons, expandable abilities and rules, and keywords. Named individual weapon
  modifications use their highlighted, adjusted profiles and separate counts.
  Older records without configured profiles offer a catalogue save to refresh.
- Edit unit records; record a game for selected participants, with explicit XP,
  kills, survival and result; retain before/after unit history.
- Pick book pools in Force details. Assign/remove source-labelled BSData honours,
  scars, relics and weapon modifications, or add custom reference entries.
- Export/import independent JSON backups without replacing existing forces.
- Desktop and mobile builds include the shared model and generated reference data.

This first pass uses the standard XP display thresholds (0, 6, 16, 31, 51).
Unit-specific rank restrictions, requisition costs, non-weapon award
effects and automatic post-game progression remain future work. Imported
enhancements are retained and editable in the shared builder. Recorded Crusade games
are stored inside the Order of Battle; they do not create normal Games scorecards.
Crusade records are local and are not yet part of OneDrive roster/game sync.
Test fixtures belong only to the local browser preview, never the installed app.

## Battles and agendas

- Play battle opens a muster checklist with participating units and battle size.
  Only selected units, enhancements and valid attachments enter the locked game
  snapshot. Custom names and individual weapon modifications carry into Play Mode.
- One active Play Mode battle per force can be resumed without selecting a new
  force or agendas. Leaving or completing it returns to the Crusades screen.
- Agendas include the imported user-supplied 10th-edition faction and campaign pages, plus a
  reusable custom library per force. Imported agendas retain their complete rule
  wording, flavour, source section, filename/hash provenance, and edition labels.
  Faction and chapter filters follow the participating units; bonus/special
  agendas are explicitly labelled for review. Agenda allowances and detailed
  eligibility are reviewed against the source rather than assumed universal.
- Core Crusade rules are always available. Campaign agenda pools and references
  follow the books enabled in Force details. The reader filters by source book
  as well as full-text search. Tyrannic War's explicit Tyranids presence/absence
  restrictions use the mustered units; special and Tactical tables are labelled
  for checking their source conditions rather than treated as ordinary agendas.
- Selected agendas are copied into each game. Play Mode provides per-unit tallies
  and notes, autosaved as edited, retained on resume and in completed game records.
  Crusade agendas are the default own mission mode; Tactical/Fixed remain optional.
  Existing disposition/primary/terrain setup is reused; no Crusade mission library
  or campaign management is added. Agendas do not automatically award XP or VP.
- OoB game counters, XP and victory updates still use Record game. Play Mode
  results remain Games scorecards; finishing does not apply progression twice.
- Desktop Crusades uses its own scroll area inside the library. Unit stat columns
  have equal compact widths, without the weapon name column's minimum width.

## Supplied HTML import

`node scripts/import-local-crusade-html.js <folder>` reads saved faction HTML
and discovers the five named core/campaign books in subfolders,
without executing scripts or fetching linked pages. It generates
`data/manual-rules/wh40k10-local-crusade.json`; builds bundle that data into the
Crusade catalogue. Whitespace and list/table layout are normalized for text display;
rules wording is preserved. Navigation-only blocks and duplicate tooltip copies
are excluded. Crusade rules opens the imported text inside the OoB.
The reader splits outline headings into searchable sections and renders structured
paragraphs, lists, nested rule cards and tables. Source dice faces and RP costs
appear as separate badges. Agenda cards keep selection, rules and source links
together, with a single-column phone layout and visible dialog actions. Unit
details use separate service-record, datasheet and Crusade-record panels.

The supplied snapshot contains 25 faction pages: 148 agendas across 22 pages and
45 Crusade reference sections. Adeptus Titanicus, Chaos Daemons, and Unaligned
Forces have no Crusade section in these supplied files. It also includes Core
Crusade Rules and four campaign books: Tyrannic War (11 agendas), Pariah Nexus
(12), Nachmund Gauntlet (5), and Armageddon (23). There are 199 imported agendas
in total and no missing core/campaign books. The imported books are formatted
text references; campaign management and automatic mission setup are not added.

## Award picker and individual weapon modifications

- Awards are scoped to the actual unit's source faction and compatible libraries;
  imported allies do not inherit the host army's award pools.
- Honours, scars and relics are separated by type and originating table. BSData
  keyword, primary-catalogue, XP and inherited visibility restrictions are used
  to hide known ineligible entries by default. Unsupported conditions are
  labelled CHECK CONDITIONS, with an explicit same-faction restricted override.
- Relics are grouped by rarity: Artificer (any rank), Antiquity (Heroic+), and
  Legendary (Legendary). Character and uniqueness restrictions are considered.
- Weapon Modifications target a persistent individual copy of an equipped
  weapon. Pick two different upgrades, or roll two D6 and reroll BOTH dice if
  the results match. One award records the pair. D6 order: Finely Balanced,
  Brutal, Armour Piercing, Master-worked, Heirloom, Precise.
- Profile rendering splits N identical weapons into N-1 ordinary weapons and
  one highlighted modified weapon. All modes of that physical weapon share the
  modification; no other copies inherit it. Raw configured equipment remains
  unchanged, so reopening the builder cannot double-apply the effects.
- Weapon upgrades appear in the OoB weapon table and catalogue editor statlines.
  Removed equipment leaves an explicit orphaned modification, rather than
  transferring the upgrade to a different weapon. Removing its award restores
  the ordinary profiles. Manual bearer/replacement-weapon eligibility review
  remains necessary when source data does not identify it reliably.

Weapon D6 table, duplicate rerolls, conditional Precision, and relic ranks were
verified against the official free Crusade rules, pages 11–12:
https://assets.warhammer-community.com/warhammer40000_crusade_crusaderules_eng_24.09-x7lpyyilc9.pdf

## Requested follow-up: stratagem timing labels

Add compact phase icons and explicit usage labels to stratagem cards in general
review/reference areas: e.g. Your Movement phase, Your Command phase, Charge or
Fight phase, either player's turn. Pair icons with text, retain CP badges, and
derive timing from the stratagem rules. Reference: user's Echelon screenshot,
2026-11-24. This is a later task, separate from the first Crusades implementation.
