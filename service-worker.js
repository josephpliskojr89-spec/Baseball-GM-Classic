// Baseball GM Classic - Service Worker
//
// Strategy (0.19.1 rewrite — the audit's PWA fix):
//   - Navigations (index.html) are NETWORK-FIRST. The HTML carries the
//     ?v= cache-busters for every script, so a stale cached page paired
//     with newer JS (or vice versa) is the one mismatch that can crash the
//     app on load. Fresh network HTML always wins; the cached copy is only
//     an offline fallback.
//   - Everything else (JS/CSS/manifest) is CACHE-FIRST. Those URLs are
//     version-stamped by index.html, so a new release requests new URLs
//     and can never be served stale.
//   - install pre-caches the full app shell, JS included (the old worker
//     cached zero JS files, so "offline support" never actually worked),
//     and FAILS if any asset can't be fetched — a half-populated cache
//     must not activate and shadow the previous good one.
const VERSION = '0.51.0';
const CACHE_NAME = `bbgm-classic-v${VERSION}`;

const JS_FILES = [
  'js/data/constants.js',
  'js/data/name_pools.js',
  'js/data/intl_name_pools.js',
  'js/data/city_pools.js',
  'js/data/teams.js',
  'js/util/rng.js',
  'js/util/dates.js',
  'js/state.js',
  'js/generation/ballparks.js',
  'js/generation/league.js',
  'js/generation/players.js',
  'js/engine/schedule.js',
  'js/engine/stats.js',
  'js/engine/injuries.js',
  'js/engine/fatigue.js',
  'js/engine/roster.js',
  'js/engine/progression.js',
  'js/engine/minors.js',
  'js/engine/flavorleagues.js',
  'js/engine/trades.js',
  'js/engine/freeagency.js',
  'js/engine/waivers.js',
  'js/engine/inbox.js',
  'js/engine/staff.js',
  'js/engine/scouting.js',
  'js/engine/draft.js',
  'js/engine/intl.js',
  'js/engine/awards.js',
  'js/engine/simulation.js',
  'js/engine/standings.js',
  'js/engine/offseason.js',
  'js/ui/common.js',
  'js/ui/dashboard.js',
  'js/ui/team.js',
  'js/ui/league.js',
  'js/ui/players.js',
  'js/ui/games.js',
  'js/ui/frontoffice.js',
  'js/ui/gm.js',
  'js/ui/drafthub.js',
  'js/ui/menu.js',
  'js/ui/player.js',
  'js/main.js',
];

const CSS_FILES = [
  'css/reset.css',
  'css/base.css',
  'css/layout.css',
  'css/components.css',
  'css/mobile.css',
];

const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  // The ?v= suffix must match index.html's link/script tags exactly —
  // those are the URLs the page will actually request. CSS joined the
  // stamped list in 0.46.0: unstamped stylesheets were served from the
  // PREVIOUS release's cache for the whole first post-update session
  // (new HTML + old CSS), and the boot guard can't see CSS at all.
  ...CSS_FILES.map((f) => `./${f}?v=${VERSION}`),
  ...JS_FILES.map((f) => `./${f}?v=${VERSION}`),
];

self.addEventListener('install', (event) => {
  // No .catch() swallow here: if the shell can't be fully cached, fail the
  // install and keep the previous worker/cache serving.
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  // Navigations: network-first, cached shell as the offline fallback.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          // Keep the offline copy current — but only with a healthy,
          // same-origin, non-redirected response (0.46.0). A captive
          // portal's login page (or a server error page) used to be
          // cached as the app shell, so the next offline launch rendered
          // hotel wifi instead of the game.
          let sameOrigin = false;
          try { sameOrigin = new URL(res.url).origin === self.location.origin; } catch (e) {}
          if (res.ok && !res.redirected && sameOrigin) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put('./index.html', copy));
          }
          return res;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Static assets: cache-first (URLs are version-stamped, so stale hits
  // are impossible across releases), network fallback for anything not
  // pre-cached.
  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req))
  );
});
