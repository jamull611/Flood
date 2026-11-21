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
5. While it's being tried out: **Authentication → Sign In / Providers → turn off "Allow new users to sign up"**,
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
