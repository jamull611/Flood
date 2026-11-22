// AdStrat bookmark for the Adjuster Claim Tracker.
// The phone/computer bookmark is a short loader that runs this file on your AdStrat claims page.
// It reads every page of your claims list (read-only) and offers "Copy for tracker".
// GENERATED from adjuster-claim-tracker.html (adstratParse + adstratGrabber) by tools/build-bookmark.js.
// Don't edit by hand: change those functions in the tracker and re-run the build.
(function () {
try {
function adstratParse(root) {
  const rows = [...root.querySelectorAll('tr')].filter(tr => /Claim Type:/.test(tr.textContent) && /Received:/.test(tr.textContent));
  return rows.filter(r => !rows.some(o => o !== r && r.contains(o))).map(r => {
    const T = el => (el ? el.innerText : '').replace(/\u00a0/g, ' ');
    const g = (s, re) => { const m = re.exec(s); return m ? m[1].trim() : ''; };
    const td = [...r.children].map(T), c1 = td[1] || '', c2 = td[2] || '', c3 = td[3] || '', c4 = td[4] || '';
    const ins = c3.split('\n').map(s => s.trim()).filter(Boolean);
    const inp = p => { const i = [...r.querySelectorAll('input[type=text]')].find(x => x.name.indexOf(p) === 0); return i ? i.value.trim() : ''; };
    const idm = /(?:getnotes|buildPDF|getreserves)\((\d+)\)/.exec(r.innerHTML);
    return {
      id: idm ? idm[1] : '', closed: !!r.children[0].querySelector('img[title*="closed" i]') || /^closed$/im.test(td[0] || ''),
      examiner: c1.split('\n')[0].trim(),
      lossLoc: g(c1, /Loss Location\s*\n([\s\S]*?)(?:\n\s*\n|Staff Contacted|$)/).replace(/\s*\n\s*/g, ', '),
      type: g(c2, /Claim Type:\s*(.*)/), claimNo: g(c2, /Claim #:\s*(.*)/), policy: g(c2, /Policy #:\s*(.*)/), adminNo: g(c2, /Admin Strat #:\s*(.*)/), dol: g(c2, /Date of Loss:\s*(.*)/),
      carrier: g(c2, /Date of Loss:.*\n\s*\n?\s*(.+)/),
      contacted: g(c2, /Contacted:\s*\n?\s*([\d\/]+(?:\s+[\d:]+\s*[AP]M)?)/), inspected: g(c2, /Inspected:\s*\n?\s*([\d\/]+(?:\s*\n?\s*[\d:]+\s*[AP]M)?)/).replace(/\s*\n\s*/, ' '),
      insured: ins[0] || '', insAddr: ins.slice(1, 3).join(', '),
      home: g(c3, /Home:\s*([^\n]*)/), work: g(c3, /Work:\s*([^\n]*)/), cell: inp('ip'), email: inp('ie'),
      received: g(c4, /Received:\s*(.*)/), reserve: g(c4, /Reserve:\s*(.*)/), stage: g(c4, /Reserve:.*\n\s*(.*)/),
      invoice: (td[5] || '').trim().replace(/\s*\n\s*/g, ' ')
    };
  });
}
function adstratGrabber(parse) {
  const MARK = 'ADSTRAT-CLAIMS v1';
  // AdStrat is built from frames (sometimes frames inside frames): look through all of them.
  const wins = [];
  const walk = w => { wins.push(w); try { for (let i = 0; i < w.frames.length; i++) walk(w.frames[i]); } catch (e) { } };
  walk(window);
  // The claims list may be its own page (Dclaims.asp) or shown at /claimsystem/: find it by its contents.
  const hasClaims = w => { try { return [...w.document.querySelectorAll('tr')].some(tr => /Claim Type:/.test(tr.textContent) && /Received:/.test(tr.textContent)); } catch (e) { return false; } };
  let W = null;
  for (const w of wins) { try { if (/dclaims\.asp/i.test(w.location.pathname)) { W = w; break; } } catch (e) { } }
  if (!W) W = wins.find(hasClaims) || null;
  // The message box must go in a real page body; the outer page of a frameset has none that shows.
  let host = null;
  for (const w of (W ? [W].concat(wins) : wins)) { try { const b = w.document.body; if (b && b.tagName === 'BODY') { host = b; break; } } catch (e) { } }
  const plain = html => html.replace(/<br>/g, '\n').replace(/<[^>]+>/g, '');
  const say = html => {
    if (!host) { alert(plain(html)); return null; }
    const doc = host.ownerDocument;
    let box = doc.getElementById('trkSync');
    if (!box) { box = doc.createElement('div'); box.id = 'trkSync'; box.style.cssText = 'position:fixed;top:16px;left:16px;right:16px;margin:0 auto;z-index:2147483647;background:#fff;color:#222;border:2px solid #0078d4;border-radius:12px;padding:16px 18px;font:16px Segoe UI,Arial,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.3);max-width:420px;line-height:1.45'; host.appendChild(box); }
    box.innerHTML = html + '<div style="text-align:right;margin-top:8px"><a href="#" id="trkClose" style="color:#666;font-size:12px">Close</a></div>';
    box.querySelector('#trkClose').onclick = e => { e.preventDefault(); box.remove(); };
    return box;
  };
  if (!W) { say('<b>Claim Tracker</b><br>Open your AdStrat <b>claims list</b> first, then click this bookmark again.'); return; }
  const D = W.document;
  (async () => {
    say('<b>Claim Tracker</b><br>Reading your AdStrat claims…');
    const total = +((D.querySelector('input[name="txtTotal"]') || {}).value || 1);
    const btn = [...D.querySelectorAll('input[onclick*="PAGE="]')].map(b => b.getAttribute('onclick'))[0] || '';
    const nav = ((/'([^']*Dclaims\.asp\?[^']*PAGE=\d+[^']*)'/i.exec(btn) || [])[1] || 'Dclaims.asp?ACTION=&PAGE=1&SORT= tblClaims.ID DESC').replace(/&amp;/g, '&');
    const claims = total > 1 ? [] : parse(D);
    for (let p = 1; total > 1 && p <= total; p++) {
      say(`<b>Claim Tracker</b><br>Reading page ${p} of ${total}…`);
      const html = await (await W.fetch(new URL(nav.replace(/PAGE=\d+/i, 'PAGE=' + p), W.location.href), { credentials: 'include' })).text();
      const box = D.createElement('div'); box.style.cssText = 'position:absolute;left:-99999px;top:0;width:1400px';
      box.innerHTML = new DOMParser().parseFromString(html, 'text/html').body.innerHTML;
      D.body.appendChild(box); claims.push(...parse(box)); box.remove();
    }
    const seen = new Set(), list = claims.filter(c => c.id && !seen.has(c.id) && seen.add(c.id));
    const payload = MARK + '\n' + JSON.stringify({ pulled: new Date().toISOString(), claims: list });
    const box = say(`<b>Claim Tracker</b><br>Found <b>${list.length}</b> claims (${list.filter(c => !c.closed).length} open).<br><button id="trkCopy" style="margin-top:12px;width:100%;padding:12px 16px;background:#0078d4;color:#fff;border:0;border-radius:8px;font:inherit;cursor:pointer">Copy for tracker</button>`);
    if (!box) return;
    box.querySelector('#trkCopy').onclick = async () => {
      try { await (host.ownerDocument.defaultView || window).navigator.clipboard.writeText(payload); }
      catch (e) { const d = host.ownerDocument, t = d.createElement('textarea'); t.value = payload; host.appendChild(t); t.select(); d.execCommand('copy'); t.remove(); }
      say(`<b>Claim Tracker</b><br>✓ Copied ${list.length} claims.<br>Now open your tracker and click <b>⟳ Sync from AdStrat</b>.`);
    };
  })().catch(e => say('<b>Claim Tracker</b><br>Couldn\'t read AdStrat: ' + e.message + '<br>Make sure you\'re signed in.'));
}
adstratGrabber(adstratParse);
} catch (e) { alert('Claim Tracker error: ' + e.message); }
})();
