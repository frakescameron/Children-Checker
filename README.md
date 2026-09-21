# Rock Church Kids Check-In

Two Android tablets, synced over your church wifi, no third device, no cloud,
no accounts. Once this one-time setup is done, your Sunday volunteers just
turn the tablets on and tap an icon — nothing to type, nothing to run.

## How it works

One of your two tablets becomes the **host**. It quietly runs the check-in
server in the background (using a free app called Termux — think of it as
the "engine," invisible to the volunteers). The other tablet is just a
**client** — its browser points at the host.

- Both tablets show the exact same live check-in list, kept in sync instantly.
- Beeper numbers 1–30 are assigned automatically, lowest first, and can never
  be handed out twice, even if both tablets check kids in at the same second.
- Kids you add are saved for future Sundays. Beeper numbers reset each time
  everyone's checked out.
- After setup, both tablets get a home-screen icon, just like a normal app.
  Tap it, it opens straight to the check-in hub, already connected.

**Honest tradeoff to know about:** the host tablet needs to stay powered on
and connected to wifi to keep things synced (screen can be off, just not
fully shut down). Cheap Android tablets sometimes get aggressive about
killing background apps to save battery — the steps below turn that off for
this app specifically. Keep the host tablet plugged into power during
service and this is extremely reliable. If it's ever not, the fix is: turn
the host tablet back on and reconnect it to wifi — nothing needs to be
reinstalled or reconfigured.

---

## ONE-TIME SETUP (about 20–30 minutes, do this once, ever)

### Step 1 — Pick your host tablet
Doesn't matter which one. Whichever tablet you set up first is the host,
forever. Label it if you want ("Host") so nobody swaps it out accidentally.

### Step 2 — Give the host tablet a permanent address
On the **host tablet**:
1. Settings → Wi-Fi → long-press your church network → **Modify network**
   → Advanced options → IP settings → change **DHCP** to **Static**.
2. Note the IP address currently shown (e.g. `192.168.1.147`) before you
   switch it, and just re-enter that same number as the static IP — this
   locks it in place so it never changes again. Leave gateway/DNS as they
   already are.
3. Save. This IP address is now permanent — write it down
   (e.g. **192.168.1.147**), you'll use it once more in Step 5.

### Step 3 — Install Termux on the host tablet
Go to the **F-Droid** app store (not Google Play — Google's Termux listing is
outdated) at f-droid.org, install F-Droid, then use it to install:
- **Termux**
- **Termux:Boot**

Open Termux once, then run:
```
pkg update && pkg install nodejs git -y
```

### Step 4 — Copy the app onto the host tablet
Easiest way: on the host tablet, download the zip of this project (from
wherever you saved it — email it to yourself, Google Drive, USB, whatever's
easiest), then in Termux:
```
termux-setup-storage
```
(tap Allow when prompted), then unzip it into Termux's home folder so you
end up with `~/kids-checkin/` containing `server.js`, `package.json`, etc.
If the zip landed in your Downloads folder, something like:
```
cd ~
unzip /sdcard/Download/rock-church-kids-checkin.zip
mv rock-church-kids-checkin kids-checkin
cd kids-checkin
npm install
```

### Step 5 — Auto-start the server on boot
Still in Termux:
```
mkdir -p ~/.termux/boot
cp ~/kids-checkin/termux-setup/start-checkin-server.sh ~/.termux/boot/
chmod +x ~/.termux/boot/start-checkin-server.sh
```
Now open the **Termux:Boot** app once (just launch it, nothing to configure)
— this registers it so Android will run the boot script automatically from
now on.

Reboot the tablet. After it powers back on, wait about 15 seconds, then open
a browser on the host tablet and go to:
```
http://localhost:3000
```
If the check-in app loads, it worked — the server is now running
automatically in the background and will keep doing so every time the
tablet is turned on.

### Step 6 — Stop Android from killing it in the background
On the host tablet:
- Settings → Apps → Termux → Battery → set to **Unrestricted** (wording
  varies by tablet brand — look for "no restrictions" or turn off "battery
  optimization" for Termux specifically).
- Settings → Developer options → enable **Stay awake while charging**
  (if Developer options isn't visible: Settings → About tablet → tap
  "Build number" 7 times to unlock it).
- Keep the host tablet **plugged into power** during church use.

### Step 7 — Add home-screen icons on both tablets
**On the host tablet**, open Chrome, go to `http://localhost:3000`, tap the
**⋮** menu → **Add to Home screen**. Name it "Kids Check-In."

**On the second tablet**, connect it to the same church wifi, open Chrome,
go to `http://192.168.1.147:3000` (use the IP address you wrote down in
Step 2), confirm the app loads, then tap **⋮** → **Add to Home screen**,
same name.

That's it. Setup is done forever, unless you replace a tablet.

---

## EVERY SUNDAY (for your volunteers — this is all they need to know)

1. Turn both tablets on.
2. Tap the **Kids Check-In** icon on the home screen.
3. It's ready. Use it like any app.

No addresses, no typing, no "starting" anything.

---

## Using the app

- **Hub** — every child currently checked in, with their beeper number. Any
  flagged note (like a severe allergy) shows in a red banner at the very top
  so it can't be missed. Tap "Check Out" when a parent picks up their kid —
  that frees the beeper number for reuse.
- **Check In** — search a saved child, tap "Check In," it assigns the lowest
  open beeper number and shows it big on screen. Not saved yet? Tap
  "+ Add New Kid" right there.
- **Manage Kids** — the saved roster. Add/edit/remove kids. Required: child's
  name, parent's name. Optional: birthday, parent's phone, address, and any
  number of notes (allergies, medical info, etc.) — each with a "Flag on Hub"
  toggle.

## Data & backups

Everything lives in one file on the host tablet:
`~/kids-checkin/checkin.db` (inside Termux's storage). Beeper numbers are
**not** saved between weeks — only the saved child/parent roster is. If you
want a backup, you (or anyone comfortable in Termux) can copy that one file
somewhere safe occasionally.

## If something ever breaks

- **Second tablet won't load the app:** make sure it's on the church wifi
  (not cellular data), and double check the IP address from Step 2 hasn't
  drifted — re-check host tablet's wifi settings.
- **Host tablet was fully powered off and back on:** just wait ~15 seconds
  after it boots, then open the app — Termux:Boot restarts the server
  automatically.
- **Nothing loading anywhere:** restart the host tablet, wait 15 seconds,
  try again.
