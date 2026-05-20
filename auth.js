// Guestbook auth — token arrives via URL hash, persists in sessionStorage for the tab.
// Load order: config.local.js (optional, local dev) → auth.js → storage.js → inline page script.
// Inline scripts must call gbRequireToken() before initializing GitHubStorage.

(function () {
  const STORAGE_KEY = 'guestbook_token';

  const hashParams = new URLSearchParams(location.hash.replace(/^#/, ''));
  const urlToken = hashParams.get('token');

  if (urlToken) {
    sessionStorage.setItem(STORAGE_KEY, urlToken);
    history.replaceState(null, '', location.pathname + location.search);
  }

  const storedToken = sessionStorage.getItem(STORAGE_KEY);
  if (storedToken) window.GUESTBOOK_TOKEN = storedToken;
})();

// Ownership: localStorage list of entry IDs the user created on this device.
// Purely a UX gate to surface the edit link — the share-link's GitHub PAT
// could rewrite anything regardless.
const GB_OWNED_KEY = 'guestbook_owned_ids';

window.gbOwnedIds = function () {
  try { return JSON.parse(localStorage.getItem(GB_OWNED_KEY)) ?? []; }
  catch { return []; }
};
window.gbOwns = function (id) {
  return window.gbOwnedIds().includes(id);
};
window.gbMarkOwned = function (id) {
  const owned = window.gbOwnedIds();
  if (!owned.includes(id)) {
    owned.push(id);
    localStorage.setItem(GB_OWNED_KEY, JSON.stringify(owned));
  }
};
window.gbUnmarkOwned = function (id) {
  const owned = window.gbOwnedIds().filter(x => x !== id);
  localStorage.setItem(GB_OWNED_KEY, JSON.stringify(owned));
};

window.gbRequireToken = function () {
  if (window.GUESTBOOK_TOKEN) return;
  const render = () => {
    document.body.innerHTML =
      '<div class="locked-screen">' +
        '<h1 class="locked-title">Zugang erforderlich</h1>' +
        '<p class="locked-text">Bitte öffne den persönlichen Link, der dir geschickt wurde.</p>' +
      '</div>';
  };
  if (document.body) render();
  else document.addEventListener('DOMContentLoaded', render);
  throw new Error('Guestbook: no access token');
};
