# Privacy policy of the «Газгольдер» (Gazgolder) app

Effective November 4, 2026.

**In short: the app does not collect or sell your data. The developer has no server where it could end up. Data goes
only where you send it: your own Google Drive, a folder you choose, or an archive you share.**

## What data is processed

Only what you enter yourself: gas level readings, photos of the gauge and of tank documents, refuels and prices,
gas suppliers and their contacts, tank settings. They are stored in the app's internal storage on your phone.

## Where data can go

Only by your action or setting:

- **Share / «Отправить архив» (Send archive)**: the archive goes to the app you choose (e-mail, messenger) and from there
  under that app's rules.
- **Android backup**: if enabled in the phone's settings, tables and settings (without photos) are saved to your Google
  account by Android itself. The developer has no access to them.
- **Google Drive sync** (off until you turn it on): tank data and, if you allow it, photos are stored in a «Gazgolder»
  folder on your own Google Drive. The app asks Google only for the `drive.file` permission, so it can see only the
  files it created and the files you pick in the Google file picker, not the rest of your Drive. The app talks to Google
  directly; the developer has no access to your Drive or to the access token, which is kept only in the phone's memory.
  Turning sync off leaves the files on your Drive; you can delete them there and revoke the app's access in your
  Google account settings (Security → Third-party apps and services).
- **Shared access**: if you share a tank with someone by e-mail, Google gives that person access to the tank's folder
  and sends them an invitation; their copy of the app then reads and writes the same files. You can stop sharing in the
  app or in Google Drive.
- **Archive to a folder** (off until you turn it on): archives are written to the folder you pick through the Android
  system picker, and from there under the rules of that storage (for example, a cloud app that provides the folder).

## Permissions

- **Notifications**: only for the reminders you turn on. They are computed on the phone.
- **Camera**: asked for only when you open the app's camera with the guide circle; the preview and the photo stay on the
  phone. If you decline, photos are taken with the system camera app instead.
- **Photos**: the app does not request access to your whole gallery. Photos are chosen through the system file picker,
  and only the selected photo reaches the app.
- **Internet**: used only for Google Drive sync, when you turn it on, and only to Google's servers.
- **Google account**: the app does not read your contacts or profile. When sync is on, it asks Drive for your e-mail
  address only to show which account is used and to mark you as the owner of a shared tank.

## Photo recognition

Text on gauge photos and receipts is recognised on the phone by the Google ML Kit model bundled with the app. Photos
are not sent anywhere. If «Keep recognition checks» is on (the default), the app keeps a small grayscale copy of each
recognized gauge photo and the values on the phone, to show how accurate recognition is; they are not part of backups
or archives, leave the phone only if you export them yourself, and can be deleted with «Clear».

## Children

The app is not intended for children and does not collect data about them.

## Deletion

Delete a tank in the app, or uninstall the app (all its data is removed with it). Copies you have sent via Share remain
with their recipients.

## Contact

Questions: open an issue in the project's GitHub repository.
