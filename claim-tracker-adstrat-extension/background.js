// Reads the AdStrat claim list (every page) and hands the raw pages to the tracker, which parses them.
// Read-only: only GET requests to the same pages you'd open in the browser.
const ADSTRAT = 'https://cms.adminstrat.com/claimsystem/';

// Self-contained so it can also run inside an open AdStrat tab (chrome.scripting) if a direct request isn't signed in.
async function pullPages(base) {
  const get = async path => {
    const r = await fetch(base + path, { credentials: 'include', cache: 'no-store' });
    const html = await r.text();
    if (/\/no\.asp|\/asp\/index\.asp/i.test(r.url)) return null;
    return html;
  };
  if ((await get('index.asp?DEFAULTSA=')) === null) return { ok: false, signedOut: true };
  const first = await get('Dclaims.asp?SQL=NO');
  if (first === null) return { ok: false, signedOut: true };
  const total = Math.min(50, +((/name="txtTotal"\s+value="(\d+)"/i.exec(first) || [])[1] || 1));
  const nav = ((/window\.location='([^']*Dclaims\.asp\?[^']*PAGE=\d+[^']*)'/i.exec(first) || [])[1] || 'Dclaims.asp?ACTION=&PAGE=1&SORT= tblClaims.ID DESC').replace(/&amp;/g, '&').trim();
  const pages = [first];
  for (let p = 2; p <= total; p++) {
    const html = await get(nav.replace(/PAGE=\d+/i, 'PAGE=' + p));
    if (html === null) return { ok: false, signedOut: true };
    pages.push(html);
  }
  return { ok: true, pages, pulled: new Date().toISOString() };
}

async function pull() {
  let res = await pullPages(ADSTRAT);
  if (res.ok) return res;
  // Fall back to running inside an open, signed-in AdStrat tab.
  const tabs = await chrome.tabs.query({ url: 'https://cms.adminstrat.com/*' }).catch(() => []);
  for (const tab of tabs) {
    try {
      const [r] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: pullPages, args: ['/claimsystem/'] });
      if (r && r.result && r.result.ok) return r.result;
    } catch (e) { }
  }
  return res;
}

// Pages allowed to ask for a sync: the tracker opened as a file, or the installed web app.
// Keep this in step with "matches" in manifest.json.
const TRACKER_PAGES = [/^file:\/\//i, /^https:\/\/jamull611\.github\.io\/Flood\//i];
const TRACKER_URL = 'https://jamull611.github.io/Flood/adjuster-claim-tracker.html';
const TRACKER_MATCH = ['https://jamull611.github.io/Flood/*', 'file:///*claim-tracker*.html'];

// ---------- automatic sync ----------
// Every 30 minutes during the day, while Chrome is open: if the tracker is open, it's asked to sync;
// if not, it's opened in a background tab, syncs (and sends the claims to the cloud), then closes.
const EVERY_MIN = 30, FROM_HOUR = 6, TO_HOUR = 21;
const store = chrome.storage.local;
function ensureAlarm() { chrome.alarms.get('autosync', a => { if (!a) chrome.alarms.create('autosync', { delayInMinutes: 1, periodInMinutes: EVERY_MIN }); }); }
chrome.runtime.onInstalled.addListener(ensureAlarm);
chrome.runtime.onStartup.addListener(ensureAlarm);
ensureAlarm();

function badge(state) {
  const signedOut = state === 'signedOut', failed = state === 'failed';
  chrome.action.setBadgeText({ text: signedOut || failed ? '!' : '' });
  chrome.action.setBadgeBackgroundColor({ color: signedOut ? '#d97706' : '#dc2626' });
  chrome.action.setTitle({ title: signedOut ? 'Claim Tracker: sign in to AdStrat (tick Remember Me) so automatic sync can run.'
    : failed ? 'Claim Tracker: the last automatic sync failed. Open the tracker to see why.'
    : 'Claim Tracker - AdStrat Sync' });
}
chrome.action.onClicked.addListener(async () => {
  const { lastState } = await store.get('lastState');
  chrome.tabs.create({ url: lastState === 'signedOut' ? ADSTRAT + 'index.asp?DEFAULTSA=' : TRACKER_URL });
});

// Light check (one page) that AdStrat will answer. An open AdStrat tab also counts, because a sync can run inside it.
async function signedIn() {
  try {
    const r = await fetch(ADSTRAT + 'index.asp?DEFAULTSA=', { credentials: 'include', cache: 'no-store' });
    await r.text();
    if (!/\/no\.asp|\/asp\/index\.asp/i.test(r.url)) return true;
  } catch (e) { }
  const tabs = await chrome.tabs.query({ url: 'https://cms.adminstrat.com/*' }).catch(() => []);
  return tabs.length > 0;
}

async function autoSync() {
  const { auto } = await store.get('auto');
  if (!auto) return;
  const h = new Date().getHours();
  if (h < FROM_HOUR || h >= TO_HOUR) return;
  // Don't open anything if AdStrat isn't signed in; just show the badge.
  if (!(await signedIn())) { await store.set({ lastState: 'signedOut' }); badge('signedOut'); return; }
  const tabs = await chrome.tabs.query({ url: TRACKER_MATCH }).catch(() => []);
  if (tabs.length) {
    chrome.tabs.sendMessage(tabs[0].id, { type: 'autosync' }).catch(() => { });
    return;
  }
  const tab = await chrome.tabs.create({ url: TRACKER_URL + '?autosync=1', active: false });
  await store.set({ autoTab: tab.id, autoTabAt: Date.now() });
  setTimeout(() => closeAutoTab(tab.id), 3 * 60 * 1000);   // safety net
}
async function closeAutoTab(id) {
  const { autoTab } = await store.get('autoTab');
  if (autoTab !== id) return;
  await store.remove(['autoTab', 'autoTabAt']);
  chrome.tabs.remove(id).catch(() => { });
}
chrome.alarms.onAlarm.addListener(a => { if (a.name === 'autosync') autoSync(); });

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !sender.tab || !TRACKER_PAGES.some(re => re.test(sender.url || ''))) return;
  if (msg.type === 'adstrat-fetch') {
    pull().then(res => {
      if (res && res.signedOut) { store.set({ lastState: 'signedOut' }); badge('signedOut'); }
      else if (res && res.ok) { store.set({ lastState: 'ok' }); badge('ok'); }
      sendResponse(res);
    }, e => sendResponse({ ok: false, error: String((e && e.message) || e) }));
    return true;
  }
  if (msg.type === 'adstrat-open') chrome.tabs.create({ url: ADSTRAT + 'index.asp?DEFAULTSA=' });
  if (msg.type === 'adstrat-auto') {
    store.set({ auto: !!msg.on }).then(() => { if (msg.on) ensureAlarm(); sendResponse({ ok: true }); });
    return true;
  }
  if (msg.type === 'autosync-done') {
    const state = msg.ok ? 'ok' : msg.signedOut ? 'signedOut' : 'failed';
    store.set({ lastState: state, lastAuto: Date.now() });
    badge(state);
    closeAutoTab(sender.tab.id);
  }
});
