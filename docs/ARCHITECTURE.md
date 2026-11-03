# Architecture and decisions

## Principles

1. **Data belongs to the user.** There is no server or cloud of our own. Everything is stored in the app's private
   folder, which other apps cannot read. Data leaves the phone only on an explicit user action: sharing an archive,
   Android backup, and in the future sync with the user's own Google Drive.
2. **One UI for two platforms.** The desktop `app/static/index.html` runs both on a PC (via `server.py`) and on the phone
   (via `backend.js`). The shared file contains only hooks: `window.gasFetch`, `gasImgUrl`, `gasReady`, `gasOnRender`.
3. **The same file format.** CSV with a BOM, `;` delimiter, decimal comma, exactly as on the desktop. A tank archive is the
   desktop profile folder. `npm test` checks that files are byte-identical after a read/write round trip.
4. **Minimal permissions and dependencies.** The only third-party JS library is `fflate` (zip). The camera works without
   the CAMERA permission (via the system camera app); the gallery uses the system picker (Photo Picker on Android 13+).

## Storage

```
files/data/profiles.json
files/data/<id>/gas_levels.csv, refuels.csv, settings.json, passport.json   ← Android Auto Backup
files/media/<id>/img/, passport/, .thumbs/                                  ← archives / device transfer only
files/data/.deleted/, files/media/.deleted/                                 ← deleted tanks
cache/export/*.zip                                                          ← temporary archives for sharing
```

Writes go through a `.tmp` file, and all operations run one at a time (like the `lock` in server.py).
160 px thumbnails are created when a photo is added.

## Requirements and decisions

| Requirement | Decision | Status |
|---|---|---|
| Sign-up | Not needed: without a server an account gives nothing. Google sign-in will be needed only for optional Drive sync | — |
| Sync with Google | **Now:** Android Auto Backup (Google One / phone backup), tables only. **Next:** the user's Google Drive with the `drive.file` scope (the app sees only its own files) | partial |
| Gmail | Storing data in the mailbox (Gmail API) is out: the `gmail.modify`/`gmail.insert` scopes are "restricted" and Google requires a paid security assessment (CASA). An archive can be e-mailed via Share → Gmail | ✓ via Share |
| Push notifications | Local notifications (`@capacitor/local-notifications`): the forecast is computed on the phone. FCM push needs a server, which is not needed | ✓ |
| Widget | `GasWidget` (AppWidgetProvider). JS stores the day-by-day level forecast in Preferences; the widget recomputes "now" by itself every 3 h | ✓ |
| Photos and video | Photos: camera and gallery (JPEG/PNG). Video is not used yet: recognition works on a single frame | ✓ photos |
| Sharing with others | A tank `.zip` archive (with or without photos) → any messenger or e-mail → «Загрузить архив» (Import archive) | ✓ |
| Shared access | A shared file on Google Drive (the owner grants access, both apps sync) | planned |
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
Next: build a set of labelled photos and measure the accuracy of the whole pipeline together with ML Kit.

## Security

- CSP in `www/index.html`: only the app's own scripts and images, no eval, no external URLs.
- The WebView loads only the app's files; cleartext HTTP and mixed content are disabled.
- `GasNativePlugin.recognizeText` opens only files inside the app's folders (canonical path check).
- Archive import: only known file names, no `..`, only JPEG/PNG by signature, limits of 40 MB per file and 2 GB per archive;
  an import always creates a new tank and never overwrites existing ones. Tables are re-validated on import.
- The signing key and Play access exist only in GitHub secrets (the `release` environment), never in the repository.
- Dependabot: weekly updates for npm, Gradle and Actions.

## Roadmap (by priority)

1. Test on devices: Android 7, 10, 14, 16; dark theme, large font.
2. Google Drive sync: Credential Manager + Authorization API, `drive.file`, a `gazgolder-<tank>.zip` file;
   merging by record keys (reading id, refuel id).
3. Shared access through a shared Drive file.
4. Icon, splash screen, Play screenshots.
5. Optional automatic recognition right after taking a photo, and accuracy statistics.
