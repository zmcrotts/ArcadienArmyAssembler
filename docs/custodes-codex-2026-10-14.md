# Custodes codex replacement - 2026-10-14

The active 11th-edition Custodes range now comes from `data/manual-rules/wh40k-11e-custodes-codex.json`, replacing the old catalogue's Custodes units, army rules, detachments, enhancements and stratagems. Historical source snapshots remain archival inputs; their Custodes definitions do not enter the active runtime.

Sources: user-supplied codex photographs (printed pages 91-120), eight army-rule cards, user-confirmed corrections, and the [official Custodes MFM v1.6](https://mfm.warhammer-community.com/en/adeptus-custodes) captured on 2026-10-14. MFM is authoritative for all Leader/Support eligibility.

## Included

- 27 current datasheets, 91 weapon-profile rows, and 45 named datasheet ability entries.
- All default loadouts, optional Vexilla/missile selections, individual weapon replacements and joint replacement bundles.
- Six army/reference rules including the six Ka'tah abilities and readied cycle, Aegis, Daughters, Aquila Commander, Anathema inclusion and shock disembark movement.
- 13 detachments, 41 stratagem entries and 29 enhancements/upgrades, with MFM points, DP costs, force-disposition labels and shared Shield Host restrictions.
- All copy-count and model-size price bands. Shield-Captain Praesidium Shield is +25 points, included only for loadouts retaining that shield.
- Null Maiden Vigil's conditional Prosecutor Battleline and Sisters Warlord permission; Trajann's mandatory Warlord requirement.
- Permanent stat/weapon bonuses apply to printed sheets, including Memento Moritoi's combined +1 A, S and D. Conditional combat rules remain conditional.
- Eagle's Eye has no invented expiry. Superior Creation has no invented use limit. Coronus carries eight Custodes Infantry and excludes Jump Pack models. Archeotech Teleport-Shunter spelling is confirmed.

## Retired and retained entries

The old detachments, enhancements and unsupported active datasheets are removed from the selectable Custodes range. Old Custodes faction-pack amendments are retained only in the historical overlay audit archive and no longer applied. Ares Gunship and Orion Assault Dropship retain their unchanged datasheets and current MFM prices under the Legends toggle, per the user's instruction.

Ordinary unchanged unit identities and the clear Guard/Sisters renames retain selection keys where available. Old rosters involving retired or split units require review against the new range; the update does not invent a new loadout to make an obsolete roster legal. Retired dictionary share codes fail explicitly instead of silently importing different units. Saved roster files, exports and user data are not deleted.

## Local and build scope

The desktop and mobile offline packages are rebuilt. The local installation patch targets only `G:/AAA/resources/app.asar`, with a recoverable original archive under `reports/custodes-local-update-*`. It merges only the Custodes army entry in the installed manifest, replaces the Custodes faction bundle, updates the necessary shared army/sheet handlers, and patches the conditional Warlord label. Every other installed archive file is checked for byte equality. No public release, package version bump or deployment is part of this data update.

## Validation

- `test/custodes-codex.test.js`: all printed unit sizes and copy tiers, loadout replacement counts, shield costs, Leader/conditional roles, Unique tags, RAW limits and permanent sheet effects.
- Root and mobile suites, including built offline-package validation. Logs are in `reports/custodes-root-tests-final.log`, `reports/custodes-focused-tests.log` and `reports/custodes-mobile-tests-final.log`.
- Shared source audit confirms non-Custodes records are unchanged.
