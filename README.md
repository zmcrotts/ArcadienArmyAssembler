# Arcadien Army Assembler

Offline Warhammer 40,000 roster builder for Windows.

Arcadien Army Assembler is a local-first list builder focused on practical roster editing: add units, configure loadouts, assign detachments, choose enhancements, attach Leaders, check warnings, save lists, export text, and print unit or Crusade sheets.

## Current Features

- Offline desktop app. No account or live service required.
- 11th-edition-first roster data pipeline.
- Faction, army/chapter, detachment, Warlord, enhancement, and Leader/bodyguard controls.
- Searchable unit list with configurable unit sizes and wargear options.
- Warning-based validation that keeps questionable rosters editable instead of deleting choices.
- Named saved lists with JSON import/export.
- Text exports for New Recruit-style, WTC, GW, and Discord formats.
- Printable unit sheets, rules references, core/detachment stratagem references, and Crusade sheets.
- Light/dark themes and standard or custom roster grouping.

## Installer

The Windows installer is published from the project release folder:

```text
release/Arcadien Army Assembler Setup.exe
```

The installer is currently unsigned, so Windows SmartScreen may warn before running it. That does not mean it is malware; it means the app does not yet have a paid code-signing certificate. The source is provided so the app can be inspected and built locally.

## Build Locally

Requires Node.js and npm.

```powershell
npm install
npm test
npm run dist:local-installer
```

The installer will be written to `release/`.

Note: ruleset source snapshots are local project inputs. A checkout must include the required ruleset data before the builder can generate a working app bundle.

## Development

```powershell
npm run desktop
```

Useful checks:

```powershell
npm test
npm run health
npm run audit:ruleset-source
```

## License

MIT. Warhammer 40,000 names and rules belong to their respective owners. This is an unofficial fan tool.
