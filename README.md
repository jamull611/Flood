# Adjuster Claim Tracker

A claim tracker for flood adjusters: follow-ups, inspections, route planning, fees and report checklists.
It runs in the browser, installs as an app on a computer or phone, works offline, and syncs your claims
across devices through Supabase.

| File | What it is |
|---|---|
| `adjuster-claim-tracker.html` | The app, including cloud sync and its Supabase settings (`TRACKER_CONFIG`) |
| `sw.js`, `manifest.webmanifest`, `icons/` | Make it installable and usable offline |
| `supabase/schema.sql` | Database tables and security rules for sync |
| `claim-tracker-adstrat-extension/` | Chrome extension that pulls your claim list from AdStrat |
| `READ ME FIRST.txt` | How to use the tracker day to day |

## One-time setup

### 1. Create the sync database (Supabase, free)
1. Create a project at supabase.com.
2. **SQL Editor → New query**: paste all of `supabase/schema.sql` and click **Run**. Then do the same with
   `supabase/2-backups.sql` (daily cloud backups).
3. **Project Settings → API**: copy the **Project URL** (Data API) and the **publishable** key (API Keys) into `TRACKER_CONFIG` near the bottom of `adjuster-claim-tracker.html`.
   (The anon key is designed to be public. Your data is protected by sign-in and the row-level security rules.)
4. **Authentication → URL Configuration**: set **Site URL** to the address where the app is hosted (step 2),
   and add `https://jamull611.github.io/Flood/**` under **Redirect URLs**, so confirmation and
   password-reset emails come back to the app.
5. **On my way reminders** (optional): deploy the `reminders` Edge Function and run
   `supabase/3-reminders.sql`. See *On my way reminders* below.
6. While it's being tried out: **Authentication → Sign In / Providers → turn off "Allow new users to sign up"**,
   and add people under **Authentication → Users → Add user**.

### 2. Host the app
The app is static files, so any static host works. With GitHub Pages:
**Settings → Pages → Build and deployment → Deploy from a branch → `main` / `(root)`**.
It's then at `https://jamull611.github.io/Flood/`.
(GitHub Pages for a private repo needs a paid GitHub plan. Otherwise make the repo public, which is safe
because no claim data or passwords are stored in it, or use Netlify or Cloudflare Pages.)

If you host it somewhere else, update the address in `claim-tracker-adstrat-extension/manifest.json`
(`matches`) and in `background.js` (`TRACKER_PAGES`).

### 3. Install it
- **Computer (Chrome/Edge):** open the site and click the install icon in the address bar.
- **Android (Chrome):** menu ⋮ → **Install app** / **Add to Home screen**.
- **iPhone (Safari):** Share → **Add to Home Screen**.

Then go to **Settings → Cloud sync**, create an account on one device, and sign in with the same email and
password on the others.

## How sync works
- Everything is saved on the device first, so the app works offline. Changes go up to the cloud
  about a second later, or as soon as you're back online.
- Other open devices get changes right away. Devices also check when the app comes back to the
  front, and every 2 minutes.
- **Edits are merged.** If the same claim is changed on two devices (say, a call logged on the phone
  with no signal while the computer syncs from AdStrat), both sets of changes are kept: contact-log
  entries, revision items and checklist steps are combined, and different fields don't overwrite
  each other. Only when the very same field was changed on both does the device that syncs last win.
- **Claims belong to one account per device.** Signing in with a different account on a device that
  has someone else's claims asks first and never mixes them. Signing out offers to remove the claims
  from the device (they stay in the account).
- **Nothing is lost by deleting.** Deleted claims can be restored for 30 days (Settings → Cloud sync →
  Recover deleted claims). The cloud also keeps a daily backup of all claims and settings for 30 days
  that can be restored in one tap (needs `2-backups.sql`).
- **Forgot password?** is on the sign-in form; **Change password** is there once signed in.
- When a device signs in for the first time, the cloud copy of a claim wins over an older copy on
  that device. Claims that only exist on the device are added after asking.
- AdStrat sync (the extension) and auto-backup to a folder work on a computer in Chrome. Turn on
  **Settings → AdStrat sync → Sync automatically every 30 minutes** and new AdStrat claims reach
  your phone on their own while Chrome is open on the computer (6 AM–9 PM). Your AdStrat password is
  never stored; the extension uses your normal AdStrat sign-in in Chrome.

## On my way reminders
Tap **🚗 On my way** on one of today's inspections. The tracker gets your location, works out the drive
time (road directions plus 10%), and starts Google Maps. About 20 minutes before you arrive, your phone
gets a notification. Tap it and the "On my way" text opens with the number filled in. Tap **Open in
Messages**, then **Send**. If you're already within 20 minutes, it offers to send the text right away.

The reminder comes from Supabase, so it arrives even while Google Maps is on screen. Setup, once:
1. **Edge Function:** Supabase → **Edge Functions → Deploy a new function → Via Editor**. Name it
   `reminders`, replace the sample code with all of `supabase/functions/reminders/index.ts`, and click
   **Deploy**. Then open the function's **Details** and turn **off** "Verify JWT" (it takes no input and
   only sends reminders that are already due).
2. **SQL:** run `supabase/3-reminders.sql` in the SQL Editor. It adds the tables and a job that checks
   for due reminders every minute.
3. **Check:** in the app, **Settings → On my way reminders → Send a test reminder**. Your phone should
   buzz within about a minute. (iPhone: the tracker must be added to the Home Screen.)

Without this setup, or if notifications are blocked, the reminder only works while the app stays open.
Drive times don't account for live traffic.

## Android app
The Android app is the tracker plus things a web page can't do:
- **On my way texts itself.** Tap 🚗 On my way: Google Maps starts, the app follows your drive, and when
  you're about 20 minutes away it texts the insured from your own number. A notification gives you 10
  seconds to **Cancel** (or **Send now**) first, and the text is logged on the claim.
- **Text sends directly.** The Text button's **Send text** sends from your number and logs it. No Messages
  app, no "I sent it".

It loads the same tracker from the website, so tracker changes still arrive on their own. Your claims,
cloud sync and settings are the same as in the browser (sign in to cloud sync once in the app).

**Install (Android):**
1. On the phone, open https://github.com/jamull611/Flood/releases/download/android-latest/claim-tracker.apk
2. Open the downloaded file and tap **Install**. The first time, Android asks you to allow installing apps
   from your browser: allow it, go back, and tap Install again. If Play Protect warns about an unknown app,
   tap **More details → Install anyway** (it's your own app, not from the Play Store).
3. Open **Claim Tracker**, sign in under **Settings → Cloud sync**, and try **Settings → On my way →
   Send a test text to my own number**. Allow texting when asked.

The first time you tap On my way, allow **Location** ("While using the app"), **Texting** and
**Notifications**. Location is only used between tapping On my way and the text going out.

**Updates:** the tracker updates by itself. When the app shell changes, install the new file from the same
link over the old one. If Android ever says the app "conflicts with an existing package", uninstall Claim
Tracker and install again; your claims come back from cloud sync.

**Building:** `.github/workflows/android.yml` builds the app on GitHub whenever `android-app/` changes and
publishes it at the link above. The native code is in `android-app/android/app/src/main/java/`.
It's installed from a file rather than the Play Store because Google Play doesn't allow apps to send texts
on their own.

## Photo labeling
On a claim, open **Report → Photos**:
1. **＋ Add photos**: pick the inspection photos from your phone or computer, or **🖼 From Google Photos**: sign in
   with Google, tap **Open Google Photos**, select the claim's photos (up to 2,000) and tap Done. The originals
   are downloaded into the Photos page. The tracker can only see the photos you pick.
2. **✨ Label with AI**: Claude (claude-opus-5-5) labels each photo with its report section, room and a
   caption, and the photos are sorted into report order: address, exterior (overviews, elevations, water lines,
   outdoor equipment), then each level and room in the order photographed (overview first), with equipment,
   contents and data plates kept in their room.
3. Check the captions, fix anything, and move photos with ↑ ↓ if needed. Under **Rooms from your sketch**, list the
   claim's levels and rooms (e.g. `Main Level: Living Room, Kitchen, Front Bedroom`) before labeling and the AI uses
   only those names. After labeling, every inside photo's caption starts with the
   same room header ("Showing damages to the kitchen.") followed by what that photo shows. **✨ Tidy captions** fixes
   the headers again at any time, for free.
4. **⬇ Photos (.zip)**: the original full-size photos renamed in order (`001 Front elevation.jpg`, …) plus
   `captions.csv`. Good for importing into Xactimate. **📄 Photo sheet (PDF)**: the AdStrat-style photo sheet:
   header with your firm, insured, claim # and policy #; two photos per page, each with
   "Level/Room - n- INSURED RISK", Date Taken, Taken By and the caption. Set the firm name and address under
   Settings → Photo captions.

Only the labels are saved on the claim (and synced). The photos themselves are kept on the device you added them
on (in the browser's own storage), so they're still there after a reload; **🗑 Clear photos from this device**
removes them when the claim is done. On another device, add the same photos and their captions come back
without being labeled again (matched by file name and size). Settings → About shows the version number. Settings → **Photo captions** lets you
describe your caption style. Cost: about 1¢ per photo (photos are shrunk to 1280 px before sending).
Photos are sent to Anthropic's API to be labeled; check that your firm and carriers allow that.

**Setup, once (Supabase):**
1. Get an API key at console.anthropic.com (API Keys → Create Key).
2. Supabase → **Edge Functions → Secrets**: add `ANTHROPIC_API_KEY` with that key.
3. Supabase → **Edge Functions → Deploy a new function → Via Editor**: name it `photo-labels`, paste all of
   `supabase/functions/photo-labels/index.ts`, and click **Deploy**. Leave **Verify JWT on**.

**Google Photos setup** (done once, in the Google Cloud project "Claim Tracker"): Google Photos Picker API enabled;
OAuth consent screen in Testing with your Google account as a test user and the scope
`photospicker.mediaitems.readonly`; a Web OAuth client with origin `https://jamull611.github.io`. Its Client ID is
in `TRACKER_CONFIG.googleClientId`. If the tracker says Google blocked the download, deploy
`supabase/functions/photo-proxy/index.ts` as an Edge Function named `photo-proxy` (Verify JWT on).

**Labeling in a Claude chat instead (no API cost):** on the Photos page, **📤 Export for labeling in chat** makes a zip of
small copies (about 1000 px, original file names) with `photos.csv`, `rooms.txt` and `style.txt`, split into parts under
24 MB. Attach it in a Claude chat and ask for a captions .csv (columns File, Section, Level, Room, Caption), then use
**📥 Import captions**. Import matches photos by file name, tidies each room's captions and sorts into report order. It
also reads `captions.csv` from the photo zip, so captions can be edited in Excel and imported back.

## iPad app and LiDAR sketch

The iPad app (`ios-app/`) is the same tracker, plus Apple's room scanner (RoomPlan). It needs an iPad Pro
(2020 or newer) or an iPhone Pro, with iPadOS/iOS 17 or later. On each claim's **Report** tab, **📐 Sketch**:

1. Pick the level, tap **＋ Scan a room**, and walk the room pointing the iPad at the walls. Tap **Done**, then
   **Save room**. Scan the next room without closing the app, and the rooms line up on the plan.
   Tap the white **📷** button during a scan to take a photo, or tick **Take photos automatically while scanning**
   (a photo each time you move about a meter or turn, up to 40 per room). The photos are added to the claim's
   **Photos** page labeled with the level and room, caption starting "Showing damages to the <room>." Tick
   **Record a video of the scan** to save a video of each room's scan to the iPad's Photos app.
2. Each room is saved on the claim and synced: walls, doors, windows, openings and fixtures, named from what the
   scanner recognized (Kitchen, Bathroom…). Rename a room or change its level in the list.
3. The screen shows the floor plan for each level with wall lengths, plus floor SF, wall SF (gross), ceiling SF,
   floor perimeter LF, ceiling height, and door and window counts per room.
4. **✥ Move rooms**: drag a room into place (it snaps against nearby walls); tap a room to turn it 90° or 2°.
   **🚪 Join at a door**: tap a door (or opening) in the room that stays put, then the same door in the other
   room; the second room turns and slides so the two doors meet across the wall.
   Rooms that landed on top of each other are set side by side automatically until you place them.
5. **✏️ Edit rooms**: tap a room, then drag its orange corners (they line up with the next corner to keep walls
   square), tap a wall length to type it (e.g. `12' 6"`; the room stretches and stays square), set the ceiling
   height, add a door, window or opening by tapping a wall, and tap a door, window or item to remove it.
   **＋ Wall**: tap where a wall starts and ends (it snaps to corners and walls and straightens); tap an inside
   wall to remove it. Inside walls of a scan that took in several rooms are kept.
   **📐 Square up** (also done automatically the first time you edit a room): walls within about 12° of straight
   are made exactly straight, fixing drift down long hallways; angled walls are kept.
   **↶ Undo** steps back; **Back to the scan** throws the edits away.
   Orange dashes on the plan mark the floor's edge where the scanner found no wall; editing the room closes them.
6. **Interior water line** (per level, in inches): items the scanner found that sit below it are marked damaged
   on the contents list.
7. **📦 Contents** (Report tab): one line per kind of item per room from the scan (bed, sofa, chair, table, TV,
   washer/dryer, storage furniture, refrigerator, range, oven, dishwasher), with quantity, coverage (a starting
   guess), damaged, and notes. Add anything else by hand; **⬇ Contents list (CSV)** exports it. Your changes are
   kept when rooms are rescanned or edited.
8. **📄 Floor plan (PDF)**: one page per level. **🧊 3D model**: a USDZ file of the rooms scanned since the app was
   opened. **Use these rooms for photo labeling**: fills in the room list the photo labeler uses (done
   automatically until you type your own list).

The sketch and the PDF work on every device; only scanning needs the iPad app.

### Getting the app onto the iPad (TestFlight)

GitHub builds the app on a Mac (`.github/workflows/ios.yml`) and sends it to TestFlight. Without the keys below
it only checks that the app compiles. One-time setup:

1. developer.apple.com → Certificates, IDs & Profiles → Identifiers → **+** → App IDs → App:
   Bundle ID `com.jamull611.claimtracker` (explicit), no capabilities.
2. appstoreconnect.apple.com → Apps → **+** → New App: iOS, pick that Bundle ID, SKU `claimtracker`.
3. App Store Connect → Users and Access → Integrations → App Store Connect API → Team Keys → **+**,
   access **Admin**. Download the `.p8` file (only once) and note the Key ID and Issuer ID.
4. GitHub → this repository → Settings → Secrets and variables → Actions → add `APPSTORE_KEY_ID`,
   `APPSTORE_ISSUER_ID` and `APPSTORE_KEY_P8` (the whole .p8 file). The Team ID is in the workflow.
5. Actions → **iPad app** → Run workflow. About 15 minutes after it finishes, the build appears in
   App Store Connect → TestFlight. Add yourself under **Internal Testing** once, then install it from the
   TestFlight app on the iPad. Later builds show up there automatically.
