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

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !sender.tab || !/^file:\/\//i.test(sender.url || '')) return;
  if (msg.type === 'adstrat-fetch') {
    pull().then(sendResponse, e => sendResponse({ ok: false, error: String((e && e.message) || e) }));
    return true;
  }
  if (msg.type === 'adstrat-open') chrome.tabs.create({ url: ADSTRAT + 'index.asp?DEFAULTSA=' });
});
