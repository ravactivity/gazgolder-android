# Architecture and decisions

## Principles

1. **Data belongs to the user.** There is no server or cloud of our own. Everything is stored in the app's private
   folder, which other apps cannot read. Data leaves the phone only on an explicit user action: sharing an archive,
   Android backup, an archive folder the user picked, and sync with the user's own Google Drive (off by default).
2. **One UI for two platforms.** The desktop `app/static/index.html` runs both on a PC (via `server.py`) and on the phone
   (via `backend.js`). The shared file contains only hooks: `window.gasFetch`, `gasImgUrl`, `gasReady`, `gasOnRender`.
3. **The same file format.** CSV with a BOM, `;` delimiter, decimal comma, exactly as on the desktop. A tank archive is the
   desktop profile folder. `npm test` checks that files are byte-identical after a read/write round trip.
4. **Minimal permissions and dependencies.** The only third-party JS library is `fflate` (zip). The guided camera asks for
   the CAMERA permission when it is first opened; if the user declines (or turns the guided camera off), photos are
   taken with the system camera app, which needs no permission. The gallery uses the system picker (Photo Picker on
   Android 13+).

## Storage

```
files/data/profiles.json, suppliers.json                                    ← suppliers: one list for all tanks
files/data/<id>/gas_levels.csv, refuels.csv, settings.json, passport.json   ← Android Auto Backup
files/media/<id>/img/, passport/, .thumbs/                                  ← archives / device transfer only
files/data/.sync/config.json, <id>.json                                     ← Drive sync settings and per-tank merge base
files/data/.deleted/, files/media/.deleted/                                 ← deleted tanks
files/media/.gauge/samples.json, <id>.gray                                  ← recognition checks (local only, not backed up)
cache/export/*.zip, cache/camera/, cache/receipt/                           ← temporary files for sharing, the camera, receipts
```

Other settings of the phone app (reminders, archive folder, theme, language) are in WebView `localStorage`; the archive
settings are also copied to Capacitor Preferences (`gas-archive`) for the background job, which writes its state to
`gas-archive-state`.

Writes go through a `.tmp` file, and all operations run one at a time (like the `lock` in server.py).
160 px thumbnails are created when a photo is added.

## Requirements and decisions

| Requirement | Decision | Status |
|---|---|---|
| Sign-up | Not needed: without a server an account gives nothing. Google authorization (no separate sign-in) is asked only when the user turns Drive sync on | — |
| Sync with Google | Opt-in sync with the user's Google Drive: Authorization API with the `drive.file` scope (the app sees only its own files and the ones the user picked), a data file per tank plus photo files, three-way merge by record keys. Android Auto Backup keeps the tables as before. See [GOOGLE_DRIVE.md](GOOGLE_DRIVE.md) | ✓ (needs the Google Cloud setup) |
| Archive to a folder | Opt-in: a folder chosen through the system picker (persistable SAF permission); a `.zip` per tank when the app opens, if the period has passed and the data changed; the newest N are kept | ✓ |
| Gmail | Storing data in the mailbox (Gmail API) is out: the `gmail.modify`/`gmail.insert` scopes are "restricted" and Google requires a paid security assessment (CASA). An archive can be e-mailed via Share → Gmail | ✓ via Share |
| Push notifications | Local notifications (`@capacitor/local-notifications`): the forecast is computed on the phone. FCM push needs a server, which is not needed. Reminders are scheduled ahead (the photo reminder is repeated every N days, the order reminder again on the last comfortable day), so they arrive without opening the app; the plugin restores them after a reboot (`BOOT_COMPLETED`) | ✓ |
| Widget | `GasWidget` (2×1, with a camera button) and `GasWidgetSmall` (1×1). JS stores the day-by-day level forecast in Preferences; the widgets recompute "now" by themselves every 3 h | ✓ |
| Phone UI | `shell.js` turns the shared page into a Material 3 app on the phone: app bar with the tank picker, bottom navigation (Home, Log, Analytics, More), sub-screens with a back stack (Android back button). Home: level ring, status, days left, consumption per chosen period, «Add reading», order card with the last supplier and price, 6-month chart. Log: readings and refuels by month. More: settings list, suppliers with call / message / e-mail buttons. The desktop layout is unchanged; icons are a bundled Material Symbols subset | ✓ |
| Quick actions | Static shortcuts (`res/xml/shortcuts.xml`) and the widget button open `gazgolder://photo`, `reading`, `refuel`; `applink.js` routes them | ✓ |
| Photos and video | Photos: the guided camera (`GasCameraActivity`, CameraX, a guide circle and a torch; EXIF time is added), the system camera, the gallery (JPEG/PNG). Video is not used: recognition works on a single frame | ✓ photos |
| Photos from other apps | Share → Gazgolder (`ACTION_SEND`/`SEND_MULTIPLE`, `image/*`): `SharedInbox` copies the images into `cache/shared/` on a background thread (only `content://`, up to 50 files of 40 MB; WebP/HEIC are re-encoded to JPEG, names sanitized by `SharedNames`), then `GasNativePlugin` fires `shared`; `mobile.js` takes them with `takeShared`, deletes the copies and opens the reading editor. Messenger photos usually have no EXIF: the date comes from the file name (`IMG-20261108-WA0003`, `photo_2026-11-08_18-21-03`) or is entered by hand | ✓ |
| Receipts | A receipt photo goes through the same on-device ML Kit OCR; `receipt.js` finds liters × price = total among the numbers (the Latin model reads numbers reliably, Cyrillic words less so) and the date | ✓ (beta) |
| Material You | Optional: `GasNativePlugin.systemColors` (Android 12+ `system_accent1/3`) replaces `--accent` and the chart colours | ✓ |
| Sharing with others | A tank `.zip` archive (with or without photos) → any messenger or e-mail → «Загрузить архив» (Import archive) | ✓ |
| Shared access | The owner shares the tank's Drive folder by e-mail; the other person opens the data file through the Google Picker; both phones sync the same file. Photos uploaded by the other side need a one-time Picker grant (`drive.file`) | ✓ |
| Recognition from photos | On-device ML Kit Text Recognition (model bundled in the APK, offline) → scale digits → circle and non-linear scale → needle as a thin dark ridge | ✓ (beta) |
| Android versions | minSdk 24 (7.0) … targetSdk 36 (16). Polyfills for older WebViews; with Chrome WebView < 80 the app asks to update it | ✓ |
| CI/CD, Google Play | GitHub Actions: debug APK on push; signing, AAB and Play upload on a tag | ✓ (secrets required) |

## Languages and themes

The UI source (shared with the desktop version) is written in Russian. `www/js/i18n.js` translates it to English without
touching that source:

- a Russian → English dictionary; a text matches either as a whole or phrase by phrase (longest first, at word
  boundaries), so composed strings like «через 12 дн.» become «in 12 days»;
- a `MutationObserver` translates every text node and the `placeholder`, `title`, `aria-label` and `alt` attributes
  as the page renders; `alert`, `confirm` and `prompt` are translated too;
- `Number`/`Date` `toLocale*` calls with `ru-RU` switch to `en-US`, so numbers and dates follow the language;
- user data is never translated: notes (`.note`), text areas, file names and tank names (except the default «Основной»).

Mobile-only strings use `gasI18n.t(key, params)` with the same dictionary. The widget gets its labels from JS; the app and
widget names come from Android resources (`values/` English, `values-ru/` Russian). The language is chosen on first
launch and kept in sync with the Android 13+ per-app language setting (`locales_config.xml`, `AppCompatDelegate`).
When a Russian UI string is added, add its English translation to `i18n.js`; the dev check is to open
`www/index.html?lang=en&demo` and look for Cyrillic left on the page.

Themes: «System», «Light», «Dark» set `data-theme` on `<html>` (the CSS already defines both palettes) and the status bar
icon colour via Capacitor `SystemBars`.

## Level recognition (`gauge.js`)

1. ML Kit returns words with bounding boxes. We keep the numbers of the gauge scale: 5, 10, 20…80, 85, 90, 95.
2. A circle is fitted through triples of digits (RANSAC) and refined by least squares, so the photo's rotation does not matter.
3. Digits are ordered by angle; those that break the order are dropped. Float gauges have a non-linear scale,
   so the angle is converted to percent piecewise-linearly between the detected digits.
4. The needle is searched within the scale sector: at every radius from the hub to the digits, the point on the ray must be
   darker than its neighbours to the left and right. This rejects the wide counterweight of the needle, shadows and dark
   lettering. The hub threshold is relative, so it also works on dark photos taken through a cloudy cover.
5. The user sees the overlay (scale, needle) and confirms the value.

On two real photos (scale digits marked by hand instead of OCR) the error was 1–2%.

**Recognition checks.** When the user recognizes a photo and then saves the reading, the phone stores a downscaled
(≤1000 px) grayscale copy of the photo (zlib), the OCR result scaled to it and both values in `files/media/.gauge/`
(at most 200, the oldest are dropped). The «Recognition» card shows the mean error and the share within ±2%; «Export
checks» shares a zip that `npm run gauge-eval -- file.zip` re-runs with the current `gauge.js`, so an algorithm change
can be measured on real photos without putting them into the repository. `test/gauge.test.mjs` checks the geometry on
synthetic dials (rotations, both directions, noise, stray OCR words).

## Security

- CSP in `www/index.html`: only the app's own scripts and images, no eval; the only external URL is
  `https://www.googleapis.com` in `connect-src` (Drive REST API).
- The WebView loads only the app's files; cleartext HTTP and mixed content are disabled.
- `GasNativePlugin.recognizeText` opens only files inside the app's folders (canonical path check).
- Drive sync: only the `drive.file` scope; access tokens are kept in memory only, never on disk. Data and photos
  downloaded from Drive go through the same validation as an archive import (known table names, JPEG/PNG by signature,
  40 MB limit, safe file names); a data file with an unknown format or a newer version is rejected.
- `GasFolderPlugin.save` copies only files from the app's cache folder and deletes only archives matching the tank's
  own `gazgolder-<name>-<id>-YYYY-MM-DD…zip` pattern in the chosen folder.
- Archive import: only known file names, no `..`, only JPEG/PNG by signature, limits of 40 MB per file and 2 GB per archive;
  an import always creates a new tank and never overwrites existing ones. Tables are re-validated on import.
- The signing key and Play access exist only in GitHub secrets (the `release` environment), never in the repository.
- `GasNativePlugin.capture` returns only a file the app's own camera activity wrote to its cache folder; receipts are
  copied to the cache folder before OCR and deleted afterwards.
- Dependabot: weekly updates for npm, Gradle and Actions.

## Tests

`npm test` runs everything that does not need a device; CI runs it on every push, plus the JVM unit tests.

| Level | What | Where |
|---|---|---|
| Unit (Node) | backend routes and validation, CSV round trips, sync and merge against a fake Drive with `drive.file` rules, Drive REST client, storage, gauge geometry, receipts, reminders, recognition checks, translations | `test/*.test.mjs`; `npm run coverage` requires 100% of lines in `www/js` |
| Parity | `backend.js` against the real desktop `server.py`: the same requests, the same answers, byte-identical CSV | `test/parity.test.mjs` (skipped without `../app/server.py` or Pillow) |
| End-to-end, browser | the demo page in Russian and English, first launch, settings, no Cyrillic left in English | `test/e2e.test.mjs` |
| End-to-end, phone mode | the page with fake Capacitor plugins (files, preferences, notifications, camera, OCR, Google authorization and Picker, folder, share, app links) and a fake Drive: reminders, widget data, Drive sync, sharing, joining, photo access, archive, camera → recognition → checks, receipts, links, Material You, archive export/import | `test/e2e-native.test.mjs`; fails below 90% of `mobile.js` lines (now 100%) |
| End-to-end, shared UI | all panels of the shared page on two years of synthetic data: forecast, plan, annual plan, charts and tooltips, settings, boiler mode log, scenarios, refuels, readings with photos, passport, tanks | `test/e2e-ui.test.mjs`; fails below 90% of the page script |
| JVM | archive names and pruning, widget math | `android/app/src/test` (`./gradlew testDebugUnitTest`) |

Not covered automatically: the Android code that needs a device (CameraX, ML Kit, the Authorization API and Picker,
SAF folders, WorkManager, widgets on a launcher). It is checked by hand, see the device checklist in
[GOOGLE_DRIVE.md](GOOGLE_DRIVE.md#5-testing-on-a-device).

## Roadmap (by priority)

1. Test on devices: Android 7, 10, 14, 16; dark theme, large font; Drive sync and shared access with two accounts
   (checklist in [GOOGLE_DRIVE.md](GOOGLE_DRIVE.md)).
2. Background Drive sync while the app is closed (needs the merge in Java or a headless JS runtime; archives already
   run in the background).
3. A larger set of real recognition checks; tune `gauge.js` on it with `npm run gauge-eval`.
4. Instrumented Android tests on an emulator in CI.
