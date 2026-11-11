# Google Drive sync, shared access and folder archives

All three features are **off by default**. The user turns them on in the «App» panel.

## 1. Google Cloud setup (required once, before sync can work)

The app has no client secret and no client ID in the code. Google recognises the app by its package name plus the
SHA-1 fingerprint of the signing certificate, so every key that signs an APK/AAB needs its own Android OAuth client.

1. [Google Cloud Console](https://console.cloud.google.com/) → select or create a project (the one with the Play
   Android Developer API is fine).
2. APIs & Services → Library → enable **Google Drive API** and **Google Picker API**.
3. Google Auth Platform (OAuth consent screen):
   - Branding: app name «Газгольдер» / Gazgolder, support e-mail, a link to the privacy policy (`docs/PRIVACY.md`).
   - Audience: External. While the app is in **Testing**, only the listed test users (up to 100) can sign in.
     Press **Publish app** before a public release.
   - Data access: add the scope `https://www.googleapis.com/auth/drive.file` (non-sensitive: the app sees only the
     files it created or the user picked).
4. Clients → Create client → **Android**, package `io.rav.gazgolder`, one client per SHA-1:
   - debug key: the permanent debug key that signs CI debug APKs (see [RELEASE.md](RELEASE.md#permanent-debug-key)),
     `keytool -list -v -keystore gazgolder-debug.jks -storepass android`; builds signed with another key (for example
     Android Studio's own `~/.android/debug.keystore`) need their own client;
   - upload key: `keytool -list -v -keystore upload.jks -alias upload`;
   - **Play App Signing key**: Play Console → Test and release → App integrity → App signing key certificate → SHA-1.
     The builds users install from Google Play are signed with this key.

No `google-services.json` is needed. Sign-in errors such as `API_10` (DEVELOPER_ERROR) mean that the package/SHA-1 pair
is not registered in the project.

## 2. How sync works

### Authorization

`GasDrivePlugin` uses the Google Identity Services Authorization API (`play-services-auth`):
`AuthorizationClient.authorize()` with the single scope `drive.file` returns a short-lived access token, and the JS side
calls the Drive REST API v3 directly (`www/js/sync.js`, CSP `connect-src https://www.googleapis.com`). There is no
separate "sign-in" and no refresh token: when a token expires (HTTP 401), the plugin clears it and asks for a new one
silently. If Google wants the user to confirm again, the status line says so and «Sync now» shows the consent screen.

The **Google Picker** is the same API with the `PICKER_OAUTH_TRIGGER` resource parameter; it returns `picked_file_ids`.
With `drive.file`, picking a file is what lets the app open a file that someone else created.

### Files on Drive

```
Gazgolder/                          folder, appProperties {gazgolder: root}
  Основной/                         folder per tank, {gazgolder: tank}
    Gazgolder — Основной.json       data file, {gazgolder: data, pid}
    IMG_2024….jpg                   photos, {gazgolder: photo, kind: img|passport}
  Дача/
    Gazgolder — Дача.json
```

The root folder is always «Gazgolder»; each tank's folder and data file carry the tank's own name, exactly as it is in
the app. Names are only labels: tanks are told apart by Drive file ids, so two tanks with the same name are two
separate folders. When a tank is renamed, the data file is renamed on the next upload and the owner's phone renames
the folder.

The data file holds the four tank files as text, exactly as they are on disk (CSV with BOM, JSON), plus a photo manifest:

```json
{ "format": "gazgolder-sync", "version": 1, "name": "Основной", "owner": "a@gmail.com", "members": ["b@gmail.com"],
  "updated": "2026-11-04T10:00:00.000Z",
  "tables": { "gas_levels.csv": "…", "refuels.csv": "…", "settings.json": "…", "passport.json": "…" },
  "photos": { "img/IMG_1.jpg": { "id": "<Drive file id>" }, "passport/plate.jpg": { "id": "…" } } }
```

Photos are separate Drive files, uploaded once and never re-uploaded, so a sync after a small change costs one small
download and one small upload.

### Merge

For every synced tank the phone keeps `files/data/.sync/<id>.json`: the Drive file id, the Drive `version` seen last,
and the **base**, the tables as they were after the last successful sync. A sync is a three-way merge:

- readings are matched by id (photo name or `manual:<date>T<time>`), refuels by id, passport photos by file name;
- a row changed or deleted on one side only takes that change; a row added on either side is kept;
- settings are merged key by key; the passport parameters and the passport text are merged as whole values;
- if both sides changed the same row or key, the phone that is syncing keeps its own value;
- the tank name is merged the same way (rename on one phone, the other one follows).

The merged tables are written locally only if the local files did not change while the merge was running, and uploaded
only if the Drive `version` is still the one that was downloaded; otherwise the merge is repeated (up to 3 times).
Uploaded photos are recorded as "pending" first, so an interrupted sync never uploads the same photo twice.

The first sync of a phone links its tanks to the files that already exist on Drive: the main tank by its id, other
tanks by name; tanks on Drive without a local match are created on the phone. A tank deleted on the phone is not
deleted on Drive and is not downloaded again. A data file deleted on Drive stops sync for that tank; «Upload again»
creates a new file. Each tank can be excluded from sync with its own checkbox.

`files/data/.sync/` is part of Android Auto Backup, so a restored phone continues with the same Drive files.

### When it runs

On app start, when the app returns to the foreground (at most once a minute), 8 seconds after any change, and on
«Sync now». There is no background sync while the app is closed. Photos can be limited to Wi-Fi
(`navigator.connection.type`; unknown connection types are treated as Wi-Fi).

## 3. Shared access

1. The owner enters the other person's e-mail in «Shared access». The app gives that address **writer** access to
   the tank folder (Drive sends the invitation e-mail) and records it in `members`.
2. The other person installs the app, turns sync on and taps «Open a shared tank…». The Picker shows Drive JSON files;
   they pick «Gazgolder — <name>.json» from «Shared with me». The app creates a new local tank linked to that file.
   Shared files are never matched with the person's own tanks by name.
3. From then on all members' phones read and write the same data file.

There is no limit on members, and the roles are symmetric:

- **Any member can invite more people.** A member who is not the owner cannot change the owner's folder, so the app
  gives the new person writer access to the data file and reader access to the photos listed in it, and adds the
  address to `members`. The next time the **owner's** phone syncs, it sees the new address in `members` and gives it
  access to the folder too, so later photos are visible to them as well.
- **Any member can have their own tanks** in their own Drive and share them with anyone, including the person who
  invited them. A phone can hold own tanks and tanks shared by different people side by side; each is a separate
  local tank linked to its own data file.

**Only the owner can stop sharing.** Other members see the list without the remove buttons, and `unshare` refuses on
their phones. The owner's phone treats the permissions on its own folder as the truth: whoever still has access to the
folder stays in `members`, so an address dropped from the list on someone else's phone comes back on the owner's next
sync, while a removal made on any of the owner's own phones (which deletes the permission) is not undone.

Because of `drive.file`, a phone cannot read a photo file that another member's phone uploaded until the user grants
access to it once: the status shows «Allow access to photos (N)…», which opens the Picker preset to those file ids.
Photos uploaded by a member who cannot write to the owner's folder go to the member's own «Gazgolder» folder and are
shared as readers with the owner and every member, including members added later.

«Stop sharing» (owner only) deletes the person's permissions on the folder and the data file, including a direct
permission on the data file given by another member, and removes the address from `members`. A phone that has lost
access shows that sync for this tank has stopped; its local copy of the data stays on that phone.

## 4. Archive to a folder

`GasFolderPlugin` asks for a folder with `ACTION_OPEN_DOCUMENT_TREE` and keeps a persistable read/write permission.
When the app opens (and on «Save now»), every tank whose data changed and whose last archive is older than the chosen
period (day, week, month) is exported to `cache/autoarch/` with the same code as «Send tank archive» and copied to the
folder as `gazgolder-<name>-<id>-YYYY-MM-DD.zip`; only the newest N archives of each tank are kept. The plugin reads only
files inside the app's cache folder and deletes only files matching that tank's own name pattern. Google Drive does not
offer folders to `ACTION_OPEN_DOCUMENT_TREE`; local storage, SD cards and some cloud apps (e.g. Nextcloud) do.

## 5. Testing on a device

- turn sync on → choose an account → the folder appears in Drive; add a reading → it appears in the data file;
- second phone (or clear app data) with the same account → data and photos arrive;
- share with a second account → join from the second phone → add readings on both, grant photo access;
- airplane mode → change → the change is synced later; revoke access in the Google account → the status asks to confirm;
- archive folder on internal storage and on an SD card; «Keep 2» deletes older archives.
