# Arcadien Army Assembler

Offline Warhammer 40,000 roster builder for Windows, mobile browsers, and manually installed Android devices.

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

## Supported Platforms

- Windows desktop is supported through the local installer.
- The mobile web app can be installed as a PWA in a compatible browser. On iPhone or iPad, open the [Arcadien Army Assembler install site](https://zmcrotts.github.io/ArcadienArmyAssembler/) in Safari and choose **Add to Home Screen**.
- Android is distributed only as a manually sideloaded APK. There is no Play Store release at this time.
- Linux packaging and runtime support have been removed. Linux is not currently supported.

## Android Manual Sideload

The production sideload task creates a non-debuggable APK and requires a stable release keystore owned by the distributor. It never falls back to Android's debug certificate. Preserve the same keystore and credentials for every version or Android will not allow an existing installation to be upgraded in place.

Provide these Gradle properties or environment variables without committing them:

```text
ARCADIEN_KEYSTORE_FILE
ARCADIEN_KEYSTORE_PASSWORD
ARCADIEN_KEY_ALIAS
ARCADIEN_KEY_PASSWORD
```

With a compatible Android SDK and Gradle available locally, run:

```powershell
npm run dist:android:sideload
```

The APK is written under `mobile/android/app/build/outputs/apk/sideload/` for direct installation. This process does not publish to the Play Store or any other service.

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
