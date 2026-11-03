# Gazgolder — LPG tank tracker for Android

Track the gas level in an LPG tank (gasholder) from photos of its gauge, log refuels with prices, and get a forecast
of when, and at what price, to order the next delivery. This is the mobile version of the local desktop app «Газгольдер».
The app is available in Russian and English, with light and dark themes.

**No sign-up and no server:** all data stays on the user's phone.

## Features

- Readings from gauge photos (camera or gallery; the capture time comes from EXIF) or entered manually.
- **On-device level recognition** from a photo (ML Kit + a custom needle detector). The result is a suggestion
  shown with an overlay; the user confirms the value.
- Refuels, prices, consumption forecast, order planning, a "one refill per year" mode, several tanks, a tank passport:
  the same as the desktop version.
- **Reminders**: time to order gas, level approaching the minimum, no photo for a while. Computed on the phone, no server needed.
- **Home-screen widget**: current level, liters, days until the minimum.
- **Share a tank**: a `.zip` archive (with or without photos) via e-mail, a messenger, etc.; the recipient imports it as a
  new tank. The format matches the desktop version's data folder.
- **Backup**: tables and settings are included in Android Auto Backup (the phone's Google account).

- **Russian and English**: chosen on first launch (preselected from the system or the Android 13+ per-app language setting) and changeable later in the «App» panel.
- **Light and dark themes**, or follow the system.

Supports Android 7.0 (API 24) through Android 16 (API 36).

## Building

You need Node.js ≥ 22 and Android Studio (it bundles the Android SDK and JDK 21; JDK 25 is too new for Gradle 8.14).

```sh
npm install            # dependencies + copy fflate into www/vendor
npm test               # tests of the local storage backend (Node)
npm run build          # copy www/ into android/ (and refresh the UI from the desktop version if it is next to this repo)
npm run open           # open android/ in Android Studio → Run
```

Without Android Studio, from the command line (with `ANDROID_HOME` set):

```sh
cd android && ./gradlew assembleDebug    # → app/build/outputs/apk/debug/app-debug.apk
```

You can also open `www/` in a regular browser: that is a demo mode where data lives only in memory.

## How it works

The UI is shared with the desktop version (which is not part of this repository): `scripts/sync-ui.mjs` builds
`www/index.html` from its `app/static/index.html` when this repository sits in a `mobile/` folder next to it;
otherwise the script leaves the file alone and `www/index.html` is edited directly. On the phone, `www/js/backend.js`
replaces the desktop server: the same `/api/…` routes, the same validation, the same file format.
See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

| File | Purpose |
|---|---|
| `www/js/backend.js` | local replacement for the desktop `server.py` (readings, refuels, settings, profiles, passport, export/import) |
| `www/js/storage.js` | files: the app's private folder on Android (Capacitor Filesystem) or memory (tests, browser) |
| `www/js/exif.js` | capture time from EXIF, no dependencies |
| `www/js/gauge.js` | level recognition: dial scale from OCR digits, needle from pixels |
| `www/js/i18n.js` | Russian → English dictionary and the DOM translator, English number and date formats |
| `www/js/mobile.js` | the «App» panel, first-run language and theme choice, reminders, widget, archives, camera, back button |
| `android/app/src/main/java/io/rav/gazgolder/` | `GasNativePlugin` (ML Kit, widget refresh), `GasWidget` |

## Releases

GitHub Actions: `.github/workflows/android.yml` builds a debug APK on every push; `release.yml` builds a signed AAB and
APK on a `vX.Y.Z` tag and publishes them to GitHub Releases and the Google Play internal testing track.
Setup: [docs/RELEASE.md](docs/RELEASE.md).

## License

[MIT](LICENSE) © 2026 rav. Privacy policy: [docs/PRIVACY.md](docs/PRIVACY.md).
