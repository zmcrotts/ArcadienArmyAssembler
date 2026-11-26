# Crusade bookkeeping

The Order of Battle has a shared between-battles toolbar: Post-battle wrap-up, Requisitions & supply, Crusade Blessings calculator, and Undo bookkeeping. Every save uses validated cloned data with guarded undo; later edits are never silently overwritten. Shared redraws preserve scroll, focus and expanded sections.

## Post-battle wrap-up

One screen records participating units, result, kills, agenda XP, other bonus XP, Battle Experience, Marked for Greatness and Out of Action. XP is calculated from participation, cumulative every-third-kill thresholds, entered agenda XP, greatness and other bonuses. Extra greatness selections require a named rule. Units normally unable to gain XP automatically pass Out of Action. Non-Characters cap at 30 XP until Legendary Veterans. The battle grants one RP, capped at ten.

A failed Out of Action roll offers a Scar, loss of an existing Honour under the supplied core rules, a documented house-rule XP reduction, forced retirement where required, or deferred resolution. Deferred injuries block muster. Removing an upgraded weapon's Honour also removes that one weapon's modifications. The XP reduction option is explicitly a house rule: the user's supplied core HTML uses Honour loss for Devastating Blow.

The entire wrap-up is atomic and reversible. A subsequent injury resolution, Honour assignment, purchase, equipment update or retirement is another independently reversible action. Core wrap-ups mark agenda XP as already included; Death Guard's subsequent Path of Contagion review defaults accordingly to avoid duplicate XP.

## Progression, purchases and history

Unclaimed rank advancements appear on unit rows and in unit details. The award picker scopes entries by faction, book, table, keywords and rank, explains encoded restrictions, checks unknown conditions, and enforces Honour/Scar limits. At the Honour limit, choose an existing Honour to replace. Confirmed mission/faction bonus Honours are separate from rank claims. House-rule overrides require a saved reason. Correcting a mistaken rank award returns its advancement; losing an Honour to an injury does not.

Core requisitions include Increase Supply Limit (+200 for 1 RP), Repair and Recuperate, Legendary Veterans, Rearm and Resupply, Fresh Recruits, and Renowned Heroes, plus a named custom purchase. Costs and RP balances are recorded. Equipment purchases show a Configure unit action and stay pending until the catalogue changes the unit. The existing catalogue preserves XP, tallies, awards and history; replaced modified weapons lose their upgrades. Paid changes cannot exceed Supply Limit. Undo can reverse the equipment edit and then the purchase. Faction tracker RP spending is also shown in the requisition ledger and is reversed from its faction Undo control.

Unit history lists battles, promotions, awards, injuries, requisitions, equipment updates and retirement. Retired units retain their records, datasheets and earlier battle references, and can return to service. Removing a unit through the catalogue also retains it as retired.

## Frozen rosters and saved games

Muster records full unit records, XP/ranks, awards, equipment, named individual weapon modifications, selected agendas and Crusade points. Completed Crusade Play Mode records retain the full roster, rather than discarding its entries. Wrap-up can select a saved game and uses that game's frozen roster and agenda tallies. A game cannot be wrapped up twice. Manual games freeze current loadouts before applying results. Historical archives show the frozen units and post-battle results. Older games without snapshots are labelled as legacy; their old loadouts are not fabricated from the current OoB.

## Crusade Blessings reference calculator

Two independent numeric inputs take the armies' actual mustered Crusade points, not Command Points. No opponent Order of Battle connection is required. The underdog receives 0, 1, 2 or 4 Blessings for differences of 0–4, 5–9, 10–19 or 20+. These identical bands are checked against all four supplied war-zone books. The calculator includes each book's available Blessings and conditions as a reference; it does not automatically apply a chosen benefit to Play Mode.

Tests cover atomic wrap-up, kill thresholds, XP caps, injury alternatives and deferment, guarded undo, rank claims, limits and overrides, named weapon snapshots, duplicate saved-game protection, requisition costs, equipment preservation and upgrade removal, retirement, malformed snapshot imports, source Blessings tables and final Play Mode record preservation. Browser checks use the isolated test origin and restore test changes afterwards. This work does not update the installed app at `G:\AAA`.
