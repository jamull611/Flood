// Runs on the local tracker file. Tells the tracker the extension is installed and relays sync requests.
const version = chrome.runtime.getManifest().version;
const announce = () => {
  document.documentElement.setAttribute('data-adstrat-ext', version);
  window.postMessage({ source: 'adstrat-ext', type: 'ready', version }, '*');
};
if (document.documentElement) announce();
else new MutationObserver((_, obs) => { if (document.documentElement) { obs.disconnect(); announce(); } }).observe(document, { childList: true });
document.addEventListener('DOMContentLoaded', announce, { once: true });

window.addEventListener('message', e => {
  if (e.source !== window || !e.data || e.data.source !== 'claim-tracker') return;
  const reply = res => window.postMessage(Object.assign({ source: 'adstrat-ext', type: 'adstrat-result', id: e.data.id }, res), '*');
  try {
    if (e.data.type === 'adstrat-fetch') {
      chrome.runtime.sendMessage({ type: 'adstrat-fetch' }, res => {
        reply(res || { ok: false, error: (chrome.runtime.lastError && chrome.runtime.lastError.message) || 'No response from the extension.' });
      });
    } else if (e.data.type === 'adstrat-open') {
      chrome.runtime.sendMessage({ type: 'adstrat-open' });
    } else if (e.data.type === 'adstrat-auto') {
      chrome.runtime.sendMessage({ type: 'adstrat-auto', on: !!e.data.on });
    } else if (e.data.type === 'autosync-done') {
      chrome.runtime.sendMessage({ type: 'autosync-done', ok: !!e.data.ok, signedOut: !!e.data.signedOut });
    }
  } catch (err) {
    reply({ ok: false, error: 'The extension was updated or reloaded. Refresh this page and try again.' });
  }
});

// The extension's timer asks an open tracker to sync from AdStrat.
chrome.runtime.onMessage.addListener(msg => {
  if (msg && msg.type === 'autosync') window.postMessage({ source: 'adstrat-ext', type: 'autosync' }, '*');
});
