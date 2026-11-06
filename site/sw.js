// Aurelia service worker: keeps the app playable offline.
// build_site.py stamps VERSION from the content of every precached file, so any change ships a new cache.
var VERSION = '__VERSION__';
var CACHE = 'aurelia-' + VERSION;
var FONTS = 'aurelia-fonts';
var PRECACHE = __PRECACHE__;

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) {
    return c.addAll(PRECACHE.map(function (u) { return new Request(u, { cache: 'reload' }); }));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf('aurelia-') === 0 && k !== CACHE && k !== FONTS; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

// Pages: network first so updates arrive, but fall back to the cache after 4 s (a weak signal out on the course).
function page(req) {
  return caches.open(CACHE).then(function (c) {
    function stored() { return c.match(req, { ignoreSearch: true }).then(function (m) { return m || c.match('./'); }); }
    return new Promise(function (resolve) {
      var done = false;
      function give(r) { if (!done && r) { done = true; resolve(r); } }
      fetch(req).then(function (r) { if (r && r.ok) c.put(req, r.clone()); give(r); }, function () {
        stored().then(function (m) { if (m) give(m); else if (!done) { done = true; resolve(Response.error()); } });
      });
      setTimeout(function () { stored().then(give); }, 4000);
    });
  });
}

// Same-origin files (three.min.js, icons, manifest): cache first.
function asset(req) {
  return caches.match(req, { ignoreSearch: true }).then(function (m) {
    return m || fetch(req).then(function (r) {
      if (r && r.ok) { var copy = r.clone(); caches.open(CACHE).then(function (c) { c.put(req, copy); }); }
      return r;
    });
  });
}

// Google Fonts: serve the stored copy, refresh it in the background.
function font(req) {
  return caches.open(FONTS).then(function (c) {
    return c.match(req).then(function (m) {
      var net = fetch(req).then(function (r) { if (r && (r.ok || r.type === 'opaque')) c.put(req, r.clone()); return r; });
      if (m) { net.catch(function () {}); return m; }
      return net;
    });
  });
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin === self.location.origin) {
    if (req.mode === 'navigate' || /\.html$|\/$/.test(url.pathname)) e.respondWith(page(req));
    else e.respondWith(asset(req));
  } else if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(font(req));
  }
});
