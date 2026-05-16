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
