/* Gambit service worker — the app has to work with no signal at all.
   A train, a plane or a basement is the normal case for a chess app. */
/* BUILD is rewritten by phone.sh on every deploy. It has to change or the
   browser sees an identical service worker, keeps the old one, and the update
   never reaches the phone. */
const BUILD = '20260925-124112';
const CACHE = 'gambit-' + BUILD;
const SHELL = [
  './', './index.html', './styles.css',
  './chess.js', './engine.js', './book.js', './review.js',
  './pieces.js', './board.js', './tutorials.js', './store.js', './app.js',
  './worker.js', './manifest.webmanifest',
  './icon-192.png', './icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== location.origin) return;

  /* Stale-while-revalidate: answer instantly from the cache so a game never
     waits on the network, but always refetch in the background so a redeploy
     lands on the next launch. Pure cache-first would pin the app to whatever
     version was installed first until the cache name changed, which is a
     genuinely confusing failure — the phone keeps running old code after an
     update that looked like it worked. */
  e.respondWith(
    caches.match(req).then(hit => {
      const fresh = fetch(req).then(res => {
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        }
        return res;
      }).catch(() => hit || caches.match('./index.html'));
      return hit || fresh;
    })
  );
});
