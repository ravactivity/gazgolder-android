# Releasing: GitHub Actions and Google Play

## 0. Before the first release

- The **appId `io.rav.gazgolder`** (in `capacitor.config.json`, `android/app/build.gradle`, `release.yml`) cannot be changed
  after the first upload to Google Play.
- The repository root contains `package.json`, `android/` and `.github/`.
- A Google Play developer account costs a one-time $25. New personal accounts must run a closed test with at least
  12 testers for 14 days before publishing to production.

## 1. Upload key

Google Play keeps the app signing key itself (Play App Signing); you sign only with an upload key.
If the upload key is lost, it can be reset through Play support.

```sh
keytool -genkeypair -v -keystore upload.jks -alias upload -keyalg RSA -keysize 4096 -validity 10000
```

Keep `upload.jks` and the passwords outside the repository (in a password manager). For a local release build, create
`android/keystore.properties` (it is git-ignored):

```properties
storeFile=C:/path/to/upload.jks
storePassword=...
keyAlias=upload
keyPassword=...
```

## 2. GitHub secrets

Settings → Environments → create the **`release`** environment (you can enable "Required reviewers" so that every
release is approved manually) and add these secrets to it:

| Secret | Value |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | `base64 -w0 upload.jks` (PowerShell: `[Convert]::ToBase64String([IO.File]::ReadAllBytes("upload.jks"))`) |
| `ANDROID_KEYSTORE_PASSWORD` | keystore password |
| `ANDROID_KEY_ALIAS` | `upload` |
| `ANDROID_KEY_PASSWORD` | key password |
| `PLAY_SERVICE_ACCOUNT_JSON` | service account JSON key (step 3); without it the Play step is skipped |

## 3. CI access to Google Play

1. Google Cloud Console → create a project → enable the **Google Play Android Developer API**.
2. IAM → Service Accounts → create an account → Keys → Add key → JSON. This is `PLAY_SERVICE_ACCOUNT_JSON`.
3. Play Console → Users and permissions → invite the service account's e-mail with access to the app
   ("Release to testing tracks" and view access).

## 4. The first upload is manual

The Play API cannot create an app. Once:
1. Play Console → Create app («Газгольдер», free).
2. Build an AAB: run the **Release** workflow manually (Actions → Release → Run workflow) or push a tag,
   then download `gazgolder-release` from the artifacts.
3. Testing → Internal testing → Create release → upload the `.aab`.
4. Fill in the store listing: description, screenshots, 512×512 icon, category, **privacy policy**
   (the texts, the 512 px icon, the 1024×500 feature graphic and seven phone screenshots per language are in
   `fastlane/metadata/android/{ru-RU,en-US}/`; `npm run store-assets` re-renders them from synthetic demo data, and
   `fastlane supply --skip_upload_apk --skip_upload_aab` can upload them); the privacy policy is a link to
   `docs/PRIVACY.md` (e.g. via GitHub Pages); then Data safety, content rating, target audience.
   Permissions to declare: camera (guided camera, optional), notifications, internet (Google Drive sync, optional).
   Data safety: the developer collects nothing; Drive sync sends data from the phone straight to the user's own
   Google Drive at the user's request, encrypted in transit (HTTPS). Describe it the same way in the form.
5. Google Drive sync: register the **Play App Signing** SHA-1 (Play Console → App integrity) as an Android OAuth
   client, and publish the OAuth consent screen, see [GOOGLE_DRIVE.md](GOOGLE_DRIVE.md#1-google-cloud-setup-required-once-before-sync-can-work).
   Without it, sign-in fails in the builds installed from Google Play.

## 5. After that — by tag

```sh
git tag v0.2.0 && git push origin v0.2.0
```

The workflow builds the AAB and APK (`versionCode` = major·10000 + minor·100 + patch, so `v0.2.0` → 200), creates a
GitHub Release with the APK and uploads the AAB to internal testing. While the app is a draft in Play, uploads use
the `draft` status. After the first publication, set the repository variable `PLAY_RELEASE_STATUS=completed`.
Promote to production in Play Console (or add a separate workflow with `track: production`).
