# Marine chapter website update — 16 October 2026

Applied the captured 40k.app datasheets to Dark Angels, Black Templars, Ultramarines, Space Wolves, Raven Guard and Salamanders: 635 roster entries from 161 distinct website sheets. Shared Marines and listed Legends are included. Units absent from the website were retained. Source snapshots are pinned in `data/manual-rules/wh40k-11e-marine-chapters-website.json`; the earlier audit is `docs/space-marine-six-chapter-audit-2026-10-16.md`.

Updated model and weapon profiles, keywords, datasheet/core/faction abilities, leader/support targets and points. Added Kaius Konorius; consolidated duplicate Headtakers and Sicaran identities with migration aliases. Headtaker prices distinguish optional Hunting Wolves from Headtakers; Crusaders support the website's 10/20-model bands. Wardens retain individual model statlines. Dark Angels retain army-level Deathwing/Ravenwing grants and internal enhancement matching aliases. All matched website entries are included in chapter roster eligibility.

Relic Shield's wound effect is bound to its bearer profile, including attached units. Imperium's Sword now adds its A6 WS2+ S7 AP-3 D3 melee weapon to the enhancement bearer while retaining their existing weapons. Repeated effect calculation does not duplicate it.

Website oddities remain as captured: Tigurius lacks Imperium; Azrael's Watcher has no printed expiry; the Apothecary Reductor Pistol is listed as ranged with Melee range. Broken inline keyword markup was normalized. These remain source questions, not invented corrections. Existing selection structures were retained where compatible; not every possible equipment combination has been manually exercised.

Validation: full root suite 456/456 before the last focused eligibility/browser adjustments; focused final tests 12/12; mobile tests 95/95. Additional regression and installed package results are recorded in `reports/marine-chapters-last-regression.log` and `reports/marine-chapters-local-install.json`.

Desktop and mobile web packages rebuilt. Local installation target: G:\AAA, with an app.asar backup and unchanged roster/export/user-data directories. No public release, version bump or publication was performed.

Installed verification completed: 1,270 packaged default loadouts checked (635 in each runtime); 296 other application files preserved byte-for-byte. Installed archive SHA-256: `1963b56ff2898665aa6d0dc710313a5c9379f946efb6b35ae91892c165133ad8`. A previous name-only Black Templars restriction assertion was corrected to distinguish chapter vehicle sheets from prohibited shared Codex sheets.
