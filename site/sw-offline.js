// Offline copy: lets the home-screen app open right away on weak signal (a stadium, a
// basement) with the last copy it saw, instead of a blank screen. build.mjs adds this to
// OneSignalSDKWorker.js, the site's one service worker (alerts and this share it).
//
// - Pages (the main page, team pages, the Record Book): the network first, as always. If
//   there's a saved copy and the network hasn't answered in 1.5 seconds, or can't be
//   reached, the saved copy shows, and the fresh page still downloads in the background.
//   The page then sees newer data and refreshes in place, the same way it does every minute.
// - A refresh for newer data (the page's own "?v=" reload) waits for the network and only
//   falls back to the saved copy if the network fails, so it can't loop.
// - Team pictures and icons: the saved copy right away, refreshed in the background.
// - Everything else (live data, fonts, alerts, SoundCloud) is left to the browser.
var BBFC_CACHE = "bbfc-offline-v1";
var BBFC_WAIT_MS = 1500;

self.addEventListener("install", function () { self.skipWaiting(); });
self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (keys) { return Promise.all(keys.filter(function (k) { return k.indexOf("bbfc-") === 0 && k !== BBFC_CACHE; }).map(function (k) { return caches.delete(k); })); })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (event) {
  var req = event.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  var scope = new URL(self.registration.scope);
  if (url.origin !== scope.origin || url.pathname.indexOf(scope.pathname) !== 0) return;
  var rest = url.pathname.slice(scope.pathname.length);
  if (req.mode === "navigate" && /^(|index\.html|team\.html|record-book\.html)$/.test(rest)) {
    event.respondWith(bbfcPage(event, url, rest));
  } else if (/^(icons|logos|brand)\//.test(rest)) {
    event.respondWith(bbfcPicture(event));
  }
});

function bbfcPage(event, url, rest) {
  var key = url.origin + url.pathname.replace(/index\.html$/, ""); // one saved copy per page, whatever the ?t= or ?v=
  var fresh = fetch(event.request).then(function (res) {
    if (res && res.ok && res.type === "basic") {
      var copy = res.clone();
      caches.open(BBFC_CACHE).then(function (c) { return c.put(key, copy); }).catch(function () {});
    }
    return res;
  });
  event.waitUntil(fresh.then(function () {}, function () {}));
  var wantsNewer = url.searchParams.has("v");
  return caches.open(BBFC_CACHE).then(function (c) { return c.match(key); }).catch(function () { return null; }).then(function (saved) {
    if (!saved) return fresh;
    var fallback = fresh.catch(function () { return saved; });
    if (wantsNewer) return fallback;
    return Promise.race([fallback, new Promise(function (done) { setTimeout(function () { done(saved); }, BBFC_WAIT_MS); })]);
  });
}

function bbfcPicture(event) {
  return caches.open(BBFC_CACHE).then(function (c) {
    return c.match(event.request).then(function (saved) {
      var fresh = fetch(event.request).then(function (res) {
        if (res && res.ok && res.type === "basic") c.put(event.request, res.clone()).catch(function () {});
        return res;
      });
      if (saved) { event.waitUntil(fresh.then(function () {}, function () {})); return saved; }
      return fresh;
    });
  }).catch(function () { return fetch(event.request); });
}
