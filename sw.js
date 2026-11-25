// Offline support: keeps the tracker and its libraries on the device so it opens without internet.
// The app itself is fetched fresh when online (so updates show up), and falls back to the saved copy offline.
const CACHE = 'claim-tracker-v30';
const APP = ['./', './adjuster-claim-tracker.html', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png'];
const LIBS = ['https://unpkg.com/leaflet@1.9.4/dist/leaflet.css', 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://unpkg.com/qrcode-generator@1.4.4/qrcode.js',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.4/dist/umd/supabase.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(async c => {
    await c.addAll(APP);
    await Promise.all(LIBS.map(u => c.add(new Request(u, { mode: 'cors' })).catch(() => { })));
  }).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    // Network first for the app's own files, saved copy when offline.
    e.respondWith(fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('./adjuster-claim-tracker.html'))));
  } else if (LIBS.includes(req.url)) {
    // Pinned library versions never change: saved copy first.
    e.respondWith(caches.match(req).then(r => r || fetch(req).then(res => {
      const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); return res;
    })));
  }
  // Everything else (maps, routing, Supabase, AdStrat) goes straight to the network.
});

// ---------- reminders ("On my way") ----------
// Supabase sends a push message when it's time to text the insured; show it as a notification.
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { title: 'Claim Tracker', body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Claim Tracker', {
    body: d.body || '', tag: d.tag || 'omw', renotify: true, requireInteraction: true,
    icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', data: { url: d.url || './adjuster-claim-tracker.html' }
  }));
});
// Tapping it opens the tracker with the text ready to send (or switches to the tracker if it's open).
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || './adjuster-claim-tracker.html';
  const id = new URL(url, self.location.href).searchParams.get('omw');
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    const open = list.find(c => c.url.startsWith(self.registration.scope));
    if (open && id) { open.postMessage({ type: 'omw', id }); return open.focus(); }
    return self.clients.openWindow(url);
  }));
});
