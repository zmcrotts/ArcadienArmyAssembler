# Arcadien Army Assembler Mobile

This directory preserves the mobile prototype as a separate code path. Mobile UI and domain changes belong here and must not be made in the desktop project's root `ui/`, `src/`, or `scripts/` directories.

The mobile build owns copies of its application code. To avoid duplicating more than 150 MB of generated faction data, it reads the root project's generated `ui/engine-data-manifest.js`, `ui/engine-data/`, and `ui/assets/` as read-only build inputs.

Build and test from this directory:

```powershell
npm.cmd run build
npm.cmd test
```

Serve `mobile/dist-user/` with a static web server for browser or device testing. The generated `dist-user/` directory is intentionally ignored.

## iPad and GitHub Pages app

The mobile web app is published from `main` by `.github/workflows/mobile-pages.yml`. On a supported iPad, open the GitHub Pages address in Safari, choose **Add to Home Screen** and **Open as Web App**, then use **Download for offline use**. Do not rely on the app away from a connection until it reports **Offline ready**.

## Android

The native wrapper lives under `android/`. Run `npm.cmd run android:assets` before an Android build to refresh its bundled offline website. The generated Android assets, local toolchain, build outputs, and APK release folder are intentionally ignored.
