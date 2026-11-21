# Adjuster Claim Tracker

A claim tracker for flood adjusters: follow-ups, inspections, route planning, fees and report checklists.
It runs in the browser, installs as an app on a computer or phone, works offline, and syncs your claims
across devices through Supabase.

| File | What it is |
|---|---|
| `adjuster-claim-tracker.html` | The app |
| `sync.js` | Cloud sync (Supabase) |
| `config.js` | Your Supabase project URL and public key |
| `sw.js`, `manifest.webmanifest`, `icons/` | Make it installable and usable offline |
| `supabase/schema.sql` | Database tables and security rules for sync |
| `claim-tracker-adstrat-extension/` | Chrome extension that pulls your claim list from AdStrat |
| `READ ME FIRST.txt` | How to use the tracker day to day |

## One-time setup

### 1. Create the sync database (Supabase, free)
1. Create a project at supabase.com.
2. **SQL Editor → New query**: paste all of `supabase/schema.sql` and click **Run**.
3. **Project Settings → API**: copy the **Project URL** and the **anon public** key into `config.js`.
   (The anon key is designed to be public. Your data is protected by sign-in and the row-level security rules.)
4. **Authentication → URL Configuration**: set **Site URL** to the address where the app is hosted (step 2),
   so email confirmation links come back to the app.

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
- Each claim syncs on its own, so editing different claims on two devices never overwrites anything.
  If the *same* claim is edited on two devices before either one syncs, the change that reaches the
  cloud last wins.
- When a device signs in for the first time, the cloud copy of a claim wins over an older copy on
  that device. Claims that only exist on the device are uploaded.
- Deleting a claim, or **Clear all**, deletes it on every device.
- AdStrat sync (the extension) and auto-backup to a folder still work on a computer in Chrome. On a
  phone, sync from AdStrat on the computer and the claims show up on the phone.
