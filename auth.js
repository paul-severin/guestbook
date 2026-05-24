// Guestbook auth — token arrives via URL hash, persists in a long-lived cookie.
// Load order: config.local.js (optional, local dev) → auth.js → storage.js → inline page script.
// Inline scripts must call gbRequireToken() before initializing GitHubStorage.

// Admin: visit any page with ?admin once to permanently mark this browser as
// admin (localStorage). UI unlock only — the share-link's PAT is the real
// security boundary, so a hardcoded key would add no protection.
const GB_ADMIN_FLAG_KEY = 'guestbook_admin';

(function () {
  const TOKEN_COOKIE = 'guestbook_token';
  // Browsers cap cookie lifetime (Chrome/Firefox ≈ 400 days; Safari ITP ≈ 7
  // days for JS-set cookies). We ask for the max and let the browser clamp.
  const FAR_FUTURE = 'Fri, 31 Dec 9999 23:59:59 GMT';

  function readCookie(name) {
    const match = document.cookie.split('; ').find(c => c.startsWith(name + '='));
    return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
  }
  function writeCookie(name, value) {
    // Secure only on https — keeps local file:// / http dev usable.
    const secure = location.protocol === 'https:' ? '; Secure' : '';
    document.cookie =
      name + '=' + encodeURIComponent(value) +
      '; Expires=' + FAR_FUTURE +
      '; Path=/; SameSite=Strict' + secure;
  }

  // Token comes in via URL hash (#token=…); cookie keeps it across tabs/restarts.
  const hashParams = new URLSearchParams(location.hash.replace(/^#/, ''));
  const urlToken   = hashParams.get('token');
  if (urlToken) writeCookie(TOKEN_COOKIE, urlToken);

  // Admin unlock comes in via query (?admin), permanent in localStorage.
  const queryParams = new URLSearchParams(location.search);
  const hadAdmin    = queryParams.has('admin');
  if (hadAdmin) {
    localStorage.setItem(GB_ADMIN_FLAG_KEY, '1');
    queryParams.delete('admin');
  }

  // Clean up the URL bar if we consumed anything.
  if (urlToken || hadAdmin) {
    const newSearch = queryParams.toString();
    history.replaceState(null, '', location.pathname + (newSearch ? '?' + newSearch : ''));
  }

  const storedToken = readCookie(TOKEN_COOKIE);
  if (storedToken) window.GUESTBOOK_TOKEN = storedToken;
})();

window.gbIsAdmin = function () {
  return localStorage.getItem(GB_ADMIN_FLAG_KEY) === '1';
};
window.gbCanEdit = function (id) {
  return window.gbOwns(id) || window.gbIsAdmin();
};

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
