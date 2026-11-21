// ===== sync.js =====
// Cloud sync through Supabase. The tracker keeps working from this device's storage exactly as
// before; when you're signed in, every change is also sent to your Supabase account and changes
// from your other devices are pulled in. Each claim syncs on its own, so editing different claims
// on two devices never overwrites anything. If the same claim is changed on two devices before
// either syncs, the change that reaches the cloud last wins.
'use strict';
(() => {
  const cfg = window.TRACKER_CONFIG || {};
  const META_KEY = 'adjusterClaimTracker.sync';
  const PAGE = 1000;
  const configured = !!(cfg.supabaseUrl && cfg.supabaseAnonKey);
  const enabled = configured && !!window.supabase;

  // Small fast string hash, enough to tell "has this claim changed since it last synced?"
  const hash = s => {
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < s.length; i++) { const ch = s.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
  };
  const claimHash = c => hash(JSON.stringify(c));
  const settingsHash = () => hash(JSON.stringify([state.settings, state.lastPlan]));

  // What this device last agreed with the cloud on, per signed-in account.
  let meta = null;
  const loadMeta = userId => {
    let m = null;
    try { m = JSON.parse(localStorage.getItem(META_KEY)); } catch { }
    if (!m || m.userId !== userId) m = { userId, claims: {}, settings: null, cursor: null, settingsCursor: null, lastSync: null };
    return m;
  };
  const saveMeta = () => { try { localStorage.setItem(META_KEY, JSON.stringify(meta)); } catch { } };

  let sb = null, user = null, channel = null;
  let busy = false, again = false, pushTimer = null, applying = false, lastError = '';

  // ---------- UI ----------
  const panelHtml = `
    <h2>Cloud sync</h2>
    <p class="muted small" style="margin-top:0" id="csIntro"></p>
    <div id="csOut">
      <div class="grid2">
        <label class="f">Email <input id="csEmail" type="email" autocomplete="username"></label>
        <label class="f">Password <input id="csPass" type="password" autocomplete="current-password" minlength="6"></label>
      </div>
      <div class="row" style="margin-top:10px">
        <button class="btn primary" id="csIn">Sign in</button>
        <button class="btn" id="csUp">Create account</button>
      </div>
    </div>
    <div id="csInBox">
      <div class="row"><span id="csWho"></span></div>
      <div class="row">
        <button class="btn primary" id="csNow">Sync now</button>
        <button class="btn" id="csOutBtn">Sign out</button>
      </div>
    </div>
    <div class="muted small" id="csNote"></div>`;

  function mountUi() {
    const settings = document.querySelector('#tab-settings .settings');
    if (!settings || $('#cloudPanel')) return;
    const p = document.createElement('div');
    p.className = 'panel'; p.id = 'cloudPanel'; p.innerHTML = panelHtml;
    settings.prepend(p);
    if (!enabled) {
      $('#csIntro').textContent = configured
        ? 'Cloud sync couldn\'t start because its library didn\'t load (are you offline?). Your claims are safe on this device; reopen the tracker when you\'re online to sync.'
        : 'Cloud sync isn\'t set up for this copy of the tracker yet, so claims stay on this device only. To turn it on, fill in config.js (see README).';
      $('#csOut').style.display = 'none'; $('#csInBox').style.display = 'none';
      return;
    }
    $('#csIntro').textContent = 'Sign in to keep your claims in sync on all your devices (computer, phone, tablet). Use the same email and password on each one.';
    const creds = () => ({ email: $('#csEmail').value.trim(), password: $('#csPass').value });
    $('#csIn').addEventListener('click', async () => {
      const { email, password } = creds();
      if (!email || !password) return note('Enter your email and password.');
      note('Signing in…');
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) note('Couldn\'t sign in: ' + error.message);
    });
    $('#csUp').addEventListener('click', async () => {
      const { email, password } = creds();
      if (!email || password.length < 6) return note('Enter your email and a password of at least 6 characters.');
      note('Creating your account…');
      const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: location.protocol.startsWith('http') ? location.href.split('#')[0] : undefined } });
      if (error) return note('Couldn\'t create the account: ' + error.message);
      if (!data.session) note('Account created. Check your email and click the confirmation link, then sign in here.');
    });
    $('#csPass').addEventListener('keydown', e => { if (e.key === 'Enter') $('#csIn').click(); });
    $('#csNow').addEventListener('click', () => syncNow(true));
    $('#csOutBtn').addEventListener('click', async () => {
      if (!confirm('Sign out of cloud sync on this device? Your claims stay on this device, they just stop syncing until you sign in again.')) return;
      await sb.auth.signOut();
    });
  }
  const note = t => { const n = $('#csNote'); if (n) n.textContent = t; };
  const when = iso => iso ? new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'never';

  function renderUi() {
    if (!enabled || !$('#cloudPanel')) return;
    $('#csOut').style.display = user ? 'none' : '';
    $('#csInBox').style.display = user ? '' : 'none';
    if (user) $('#csWho').innerHTML = 'Signed in as <b>' + esc(user.email || '') + '</b>';
    const sn = $('#saveNote');
    if (user) {
      const status = !navigator.onLine ? 'Offline: changes will sync when you\'re back online'
        : lastError ? 'Sync problem: ' + lastError
        : busy ? 'Syncing…'
        : 'Synced to cloud · ' + when(meta && meta.lastSync);
      note(status);
      if (sn) sn.textContent = !navigator.onLine ? 'Saved on this device · offline' : lastError ? 'Saved on this device · sync problem' : 'Synced · ' + when(meta && meta.lastSync);
    }
  }

  // ---------- push: send local changes ----------
  async function push() {
    const now = new Date().toISOString();
    const rows = [];
    const live = new Set();
    for (const c of state.claims) {
      live.add(c.id);
      const h = claimHash(c);
      if (meta.claims[c.id] !== h) rows.push({ row: { id: c.id, data: c, deleted: false, updated_at: now }, h });
    }
    for (const id of Object.keys(meta.claims)) {
      if (!live.has(id) && meta.claims[id] !== 'deleted') rows.push({ row: { id, data: null, deleted: true, updated_at: now }, h: 'deleted' });
    }
    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200);
      const { error } = await sb.from('claims').upsert(chunk.map(r => r.row), { onConflict: 'user_id,id' });
      if (error) throw error;
      chunk.forEach(r => { meta.claims[r.row.id] = r.h; });
      saveMeta();
    }
    const sh = settingsHash();
    if (meta.settings !== sh) {
      const { error } = await sb.from('tracker_settings').upsert({ settings: state.settings, last_plan: state.lastPlan, updated_at: now }, { onConflict: 'user_id' });
      if (error) throw error;
      meta.settings = sh; saveMeta();
    }
    return rows.length;
  }

  // ---------- pull: bring in changes from other devices ----------
  async function pull() {
    let changed = false, settingsChanged = false;
    // Re-read the last minute each time so a change that committed a moment late is never missed;
    // rows that match what's already here are skipped.
    let since = meta.cursor ? new Date(Date.parse(meta.cursor) - 60000).toISOString() : null;
    for (;;) {
      let q = sb.from('claims').select('id,data,deleted,server_at').order('server_at', { ascending: true }).limit(PAGE);
      if (since) q = q.gt('server_at', since);
      const { data, error } = await q;
      if (error) throw error;
      for (const r of data) {
        const local = state.claims.find(c => c.id === r.id);
        // On a device's first sync (no record for this claim yet) the cloud copy wins, so an old copy of the
        // tracker on another computer can't overwrite newer work.
        const known = meta.claims[r.id];
        const localDirty = known === undefined ? false : local ? known !== claimHash(local) : known !== 'deleted';
        // A change made on this device that hasn't been sent yet wins; it goes up on the next push.
        if (!localDirty) {
          if (r.deleted ? !local && meta.claims[r.id] === 'deleted' : r.data && meta.claims[r.id] === claimHash(normalizeClaim(r.data))) {
            // Already up to date (often our own change coming back).
          } else if (r.deleted) {
            if (local) { state.claims = state.claims.filter(c => c.id !== r.id); changed = true; }
            meta.claims[r.id] = 'deleted';
          } else if (r.data) {
            const c = normalizeClaim(r.data);
            if (local) Object.keys(local).forEach(k => delete local[k]);
            if (local) Object.assign(local, c); else state.claims.push(c);
            meta.claims[r.id] = claimHash(local || c);
            changed = true;
          }
        }
        if (!meta.cursor || Date.parse(r.server_at) > Date.parse(meta.cursor)) meta.cursor = r.server_at;
        since = r.server_at;
      }
      saveMeta();
      if (data.length < PAGE) break;
    }
    {
      const { data, error } = await sb.from('tracker_settings').select('settings,last_plan,server_at').maybeSingle();
      if (error) throw error;
      if (data && data.server_at !== meta.settingsCursor) {
        const localDirty = meta.settings !== null && meta.settings !== settingsHash();
        const same = data.settings && hash(JSON.stringify([normalizeSettings(data.settings), data.last_plan ?? null])) === settingsHash();
        if (same) meta.settings = settingsHash();
        else if (!localDirty && data.settings) {
          const s = normalizeSettings(data.settings);
          Object.keys(state.settings).forEach(k => delete state.settings[k]);
          Object.assign(state.settings, s);
          state.lastPlan = data.last_plan ?? null;
          meta.settings = settingsHash();
          settingsChanged = true;
        }
        meta.settingsCursor = data.server_at;
        saveMeta();
      }
    }
    if (changed || settingsChanged) {
      applying = true;
      try {
        persistLocal();
        renderAll();
        if (settingsChanged) { try { renderSettings(); initPlannerControls(); } catch (e) { console.error(e); } }
      } finally { applying = false; }
    }
    return changed || settingsChanged;
  }

  async function syncNow(manual) {
    if (!user || !meta) return;
    if (busy) { again = true; return; }
    if (!navigator.onLine) { renderUi(); return; }
    busy = true; renderUi();
    try {
      do {
        again = false;
        await pull();
        await push();
      } while (again);
      lastError = '';
      meta.lastSync = new Date().toISOString(); saveMeta();
      if (manual) toast('Synced with the cloud.');
    } catch (e) {
      lastError = (e && e.message) || String(e);
      console.error('Sync failed', e);
      if (manual) toast('Sync failed: ' + esc(lastError), 6000);
    } finally { busy = false; renderUi(); }
  }

  function schedulePush() {
    if (applying || !user) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => syncNow(false), 1200);
  }

  function listen() {
    if (channel) sb.removeChannel(channel);
    channel = sb.channel('tracker-' + user.id)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'claims', filter: 'user_id=eq.' + user.id }, () => schedulePush())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tracker_settings', filter: 'user_id=eq.' + user.id }, () => schedulePush())
      .subscribe();
  }

  async function onAuth(session) {
    const next = session ? session.user : null;
    if ((next && next.id) === (user && user.id)) { renderUi(); return; }
    user = next;
    if (channel) { sb.removeChannel(channel); channel = null; }
    if (!user) {
      meta = null; lastError = '';
      const sn = $('#saveNote'); if (sn) sn.textContent = 'Saved on this device · not syncing';
      renderUi();
      return;
    }
    meta = loadMeta(user.id); saveMeta();
    renderUi();
    listen();
    await syncNow(false);
    if (!lastError) note('Synced to cloud · ' + when(meta.lastSync));
  }

  mountUi();
  if (!enabled) return;
  sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'adjusterClaimTracker.auth' }
  });
  afterSave.push(schedulePush);
  sb.auth.onAuthStateChange((_evt, session) => { setTimeout(() => onAuth(session), 0); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncNow(false); });
  window.addEventListener('online', () => syncNow(false));
  window.addEventListener('offline', renderUi);
  setInterval(() => { if (document.visibilityState === 'visible') syncNow(false); }, 120000);
  window.cloudSync = { syncNow: () => syncNow(true) };
})();
