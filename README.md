# Children Check In

A small, standalone Android app for a tablet. Install `Children-Check-In.apk`;
see `START-HERE.txt` for the short setup and usage instructions.

## What changed

- Replaced the Express/Socket.IO server and network setup with a self-contained
  Android application. No server process or internet access is required.
- App name and screens say **Children Check In**.
- Select several children and assign one beeper to their pickup parent.
- Tap Check In to assign the next available beeper immediately, using the saved
  parent names. No beeper dropdown, session field, or parent confirmation step.
- The compact Hub shows individual child cards in one grid. Check out individually
  or together. A number is held until the last member checks out. There are 30
  available beepers; a group can contain multiple children.
- Added **Check-In History** next to **Manage Kids**: dates, names, parents,
  beeper numbers, session labels, check-in times, and checkout times.
- History includes checked-out visits. Editing/deleting a profile preserves
  its previous attendance. Each new arrival creates a separate visit.
- Print filtered attendance or the current Hub list, save a PDF through Android,
  export CSV, and save/restore full backups.
- Preserved birthday, parent phone, address, notes, and flagged allergy alerts.
- Touch controls and navigation fit a small tablet in portrait or landscape.

## Data and operation

The Android app saves synchronously to a private atomic file. The screen only
shows a successful change after the durable write completes. App restarts and
normal APK updates preserve records. Uninstalling or clearing app data removes
local records; make a backup first. Separate tablets maintain independent data.

The APK requests no network or storage permissions. The system document picker
handles backup, restore, and CSV saving. Android's print service handles printers
and PDF output. A printer may require its normal print service and connection.

This private build includes the uploaded ZIP's **7 saved kids and 15 visits** as
its first-launch data, including its 7 active check-ins. New installations receive
that starting snapshot; updates never re-seed existing data. The JSON backup in
this folder also retains those original records. Treat the APK, backup, and ZIP
as containing that data. The old app did not save historical copies of names and
notes, so imported past visits use the profile information available in the old
database. New visits retain their own snapshots.

The tablet's local timezone is used for display and date filters; timestamps
are saved in UTC. “Present during dates” includes visits spanning midnight.
“Status now” describes whether the visit has since been checked out, not its
status at a historical instant. Session labels from older records remain searchable in history. New check-ins
do not ask for a session label.

## Source and rebuilding

- `www/`: lightweight, dependency-free UI and attendance logic.
- `android/`: Java WebView wrapper, local storage, print and document actions.
- `android/seed.json`: original records for first launch only.
- `tests/`: business rules and browser workflow checks.
- `build-android.py`: APK packaging and signing without Gradle/npm.

To rebuild on a development computer, install Python 3, JDK 17, Android SDK
Platform 34, and Android SDK Build-Tools 35.0.0. Set `ANDROID_SDK_ROOT`, put the
JDK tools on PATH, and run:

```sh
python3 build-android.py
```

Optional overrides: `ANDROID_BUILD_TOOLS`, `ANDROID_PLATFORM_JAR`, and
`CHECKIN_COMPILER_JAR` (an Eclipse ECJ compiler JAR when javac is unavailable).
Increment `android:versionCode` and `android:versionName` in the manifest for
future releases. Install over the existing app to retain data.

Keep `android/signing/` private and retain it for future updates. It contains
this app's signing key and its generated credentials. Reusing that key is
necessary to update the existing installation without uninstalling it.

To make a blank first-install variant, replace `android/seed.json` before
building with:

```json
{"version":2,"revision":0,"kids":[],"checkins":[]}
```

This only changes first-install data; it never clears data in an existing app.

## Verification

Run `TZ=UTC node --test tests/store.test.js` for the 11 core tests. The UI test
uses Playwright; set `PLAYWRIGHT_MODULE` and `CHROMIUM_PATH` if installed outside
normal module locations, then run `node tests/ui.test.cjs`.

Verified the signed APK and manifest; the packaged app requests no permissions.
Browser checks passed with networking disabled: immediate multi-child check-in, the compact Hub, individual and group checkout,
reopening data,
profile edits/deletion, history search, printable report, CSV, backup/restore,
and layouts at 600×960, 1024×600, and 360×640. The page’s Android bridge
contract also passed mocked save/reload, print, export, and import checks. No HTTP requests or JavaScript errors
were observed. Reviewed the generated report and screen captures.

The APK was built and signature-verified here. Installation, the Android native
file picker, Android print services, and physical-tablet behavior have not been
exercised on an Android device in this environment.
