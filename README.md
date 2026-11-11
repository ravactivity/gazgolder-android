# Gazgolder — LPG tank tracker for Android

Track the gas level in an LPG tank (gasholder) from photos of its gauge, log refuels with prices, and get a forecast
of when, and at what price, to order the next delivery. This is the mobile version of the local desktop app «Газгольдер».
The app is available in Russian and English, with light and dark themes.

**No sign-up and no server:** data stays on the user's phone, unless the user turns on sync with their own Google Drive.

## Features

- Readings from gauge photos (camera or gallery; the capture time comes from EXIF) or entered manually.
- **Photos from messengers and other apps**: Share → Gazgolder adds one or many photos; without EXIF the date is
  taken from the file name, otherwise the user enters it.
- **Guided camera**: a preview with a circle to fit the gauge into, a torch button; falls back to the system camera app.
- **On-device level recognition** from a photo (ML Kit + a custom needle detector), optionally right after the photo
  is taken. The result is a suggestion shown with an overlay; the user confirms the value. The phone can keep the
  recognition checks (photo copy, digits found, final level) to show the accuracy and to test new versions offline.
- **Refuel from a receipt photo**: liters, price and total are read on the phone and filled into the form.
- Refuels, prices, consumption forecast, order planning, a "one refill per year" mode, several tanks, a tank passport:
  the same as the desktop version.
- **Reminders**: time to order gas (on the best day and again on the last comfortable day), level approaching the
  minimum, no photo for a while (repeated every N days). Computed on the phone, no server needed.
- **Home-screen widgets**: current level, liters, days until the minimum and a camera button; a small 1×1 widget.
- **Quick actions** on the app icon: photo, new reading, refuel.
- **Share a tank**: a `.zip` archive (with or without photos) via e-mail, a messenger, etc.; the recipient imports it as a
  new tank. The format matches the desktop version's data folder.
- **Backup**: tables and settings are included in Android Auto Backup (the phone's Google account).
- **Google Drive sync** (opt-in): tanks, readings, refuels, passport and photos in a folder on the user's own Drive,
  merged record by record between phones. Only the `drive.file` scope. See [docs/GOOGLE_DRIVE.md](docs/GOOGLE_DRIVE.md).
- **Shared access**: share a tank by e-mail; the other person opens it from Drive in their copy of the app and you both
  keep the same log.
- **Archive to a folder** (opt-in): a `.zip` of each tank saved daily, weekly or monthly to a folder the user picks,
  keeping the newest N; it runs in the background (WorkManager) as well.

- **Russian and English**: chosen on first launch (preselected from the system or the Android 13+ per-app language setting) and changeable later in the «App» panel.
- **Light and dark themes**, or follow the system; optional wallpaper colours (Material You, Android 12+).

Supports Android 7.0 (API 24) through Android 16 (API 36).

## Building

You need Node.js ≥ 22 and Android Studio (it bundles the Android SDK and JDK 21; JDK 25 is too new for Gradle 8.14).

```sh
npm install            # dependencies + copy fflate into www/vendor
npm test               # all tests: unit tests in Node and end-to-end tests in headless Chrome/Edge
npm run coverage       # unit tests with coverage thresholds for www/js
npm run build          # copy www/ into android/ (and refresh the UI from the desktop version if it is next to this repo)
npm run open           # open android/ in Android Studio → Run
```

Other scripts: `npm run demo-data` writes synthetic demo data to `www/demo/` (open `www/index.html?demo`),
`npm run store-assets` renders the launcher icons, the Play icon, the feature graphic and phone screenshots in both
languages into `fastlane/metadata/android/`, `npm run gauge-eval -- <export.zip>` re-runs recognition on exported
recognition checks.

## Tests

- **Unit tests** (`test/*.test.mjs`, Node): the backend (routes, validation, CSV round trips of the real desktop files
  when present), Drive sync against a fake Drive that enforces `drive.file` visibility, the Drive REST client, storage,
  the gauge reader on synthetic dials, the receipt parser, reminders, recognition checks, translations. `npm run
  coverage` requires 100% of lines in `www/js` (except `mobile.js`, which needs a page).
- **End-to-end tests** in headless Chrome or Edge (`CHROME_PATH` to choose one; skipped if none is found):
  `e2e.test.mjs` (browser demo), `e2e-native.test.mjs` (the app in phone mode with fake Capacitor plugins and a fake
  Drive; fails below 90% line coverage of `mobile.js`), `e2e-ui.test.mjs` (the shared UI on two years of synthetic
  data; fails below 90% line coverage of its script).
- **Parity with the desktop server**: `parity.test.mjs` runs the desktop `server.py` (when it is next to this
  repository and Python with Pillow is installed) and sends the same requests to both backends.
- **Java unit tests** (`android/app/src/test`, JUnit): archive naming and pruning, widget math, names of shared photos; run in CI with
  `./gradlew testDebugUnitTest`.

Without Android Studio, from the command line (with `ANDROID_HOME` set):

```sh
cd android && ./gradlew assembleDebug    # → app/build/outputs/apk/debug/app-debug.apk
```

You can also open `www/` in a regular browser: that is a demo mode where data lives only in memory.

## How it works

The UI is shared with the desktop version (which is not part of this repository): `scripts/sync-ui.mjs` builds
`www/index.html` from its `app/static/index.html` when this repository sits in a folder next to it;
otherwise the script leaves the file alone and `www/index.html` is edited directly. On the phone, `www/js/backend.js`
replaces the desktop server: the same `/api/…` routes, the same validation, the same file format.
See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

| File | Purpose |
|---|---|
| `www/js/backend.js` | local replacement for the desktop `server.py` (readings, refuels, settings, profiles, passport, export/import) |
| `www/js/sync.js` | Google Drive REST client, three-way merge, sync of tanks and photos, shared access |
| `www/js/storage.js` | files: the app's private folder on Android (Capacitor Filesystem) or memory (tests, browser) |
| `www/js/exif.js` | capture time from EXIF, no dependencies |
| `www/js/gauge.js` | level recognition: dial scale from OCR digits, needle from pixels |
| `www/js/samples.js` | recognition checks: storage, accuracy stats, re-evaluation |
| `www/js/receipt.js` | liters, price, total and date from receipt OCR (liters × price = total) |
| `www/js/reminders.js` | which reminders to schedule and when |
| `www/js/shell.js` | the phone UI: app bar, bottom navigation, Home, Log, More, suppliers screens (Material 3); moves the shared page's sections into tabs |
| `www/js/home.js` | numbers for Home and the Log: status, days left, consumption per period, journal groups, supplier stats and contact links |
| `www/js/applink.js` | `gazgolder://photo`, `reading`, `refuel` links from shortcuts and the widget |
| `www/js/i18n.js` | Russian → English dictionary and the DOM translator, English number and date formats |
| `www/js/mobile.js` | the «App» panel, first-run language and theme choice, reminders, widget, archives, Drive sync UI, camera, back button |
| `android/app/src/main/java/io/rav/gazgolder/` | `GasNativePlugin` (ML Kit, guided camera, widget refresh, system colours), `GasCameraActivity` (CameraX), `GasDrivePlugin` (Google authorization and Picker), `GasFolderPlugin` + `ArchiveJob` + `ArchiveWorker` (archive folder, background), `GasWidget`, `GasWidgetSmall`, `SharedInbox` + `SharedNames` (photos shared from other apps) |

Google Drive sync needs a Google Cloud project with Android OAuth clients for the signing keys:
[docs/GOOGLE_DRIVE.md](docs/GOOGLE_DRIVE.md#1-google-cloud-setup-required-once-before-sync-can-work).

## Releases

GitHub Actions: `.github/workflows/android.yml` builds a debug APK on every push; `release.yml` builds a signed AAB and
APK on a `vX.Y.Z` tag and publishes them to GitHub Releases and the Google Play internal testing track.
Setup: [docs/RELEASE.md](docs/RELEASE.md).

## License

[MIT](LICENSE) © 2026 rav. Privacy policy: [docs/PRIVACY.md](docs/PRIVACY.md).

Icons: a subset of [Material Symbols](https://github.com/google/material-design-icons) by Google (`www/fonts/symbols.woff2`,
Apache License 2.0).
