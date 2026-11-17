// Service worker: keeps a copy of the app so it opens at once, and offline.
// The app's files are served from the cache; a new version (a new
// version.js makes this a new worker) is fetched whole in the background and
// takes over at a quiet moment (the page reloads itself when put away or
// brought back). The list itself is not here: it's in IndexedDB (store.js).
importScripts("version.js");
var CACHE = "cardlist-" + self.APP_VERSION;
var SHELL = [
  "./", "index.html", "app.css", "app.js", "data.js", "store.js", "sync.js", "version.js",
  "manifest.webmanifest", "apple-touch-icon.png", "icon-192.png", "icon-512.png"
];

self.addEventListener("install", function(e){
  // every file fresh from the network, so a new version can't mix in old files from the browser's cache
  e.waitUntil(caches.open(CACHE).then(function(c){ return c.addAll(SHELL.map(function(u){ return new Request(u, { cache: "reload" }); })); }).then(function(){ return self.skipWaiting(); }));
});

self.addEventListener("activate", function(e){
  e.waitUntil(caches.keys().then(function(keys){
    return Promise.all(keys.filter(function(k){ return k !== CACHE; }).map(function(k){ return caches.delete(k); }));
  }).then(function(){ return self.clients.claim(); }));
});

self.addEventListener("fetch", function(e){
  var req = e.request;
  if(req.method !== "GET") return;
  var url = new URL(req.url);
  if(url.origin !== self.location.origin) return;       // the sync server: always the network

  e.respondWith(caches.match(req, { ignoreSearch: true }).then(function(hit){
    if(hit) return hit;
    return fetch(req).catch(function(){ return req.mode === "navigate" ? caches.match("./") : Response.error(); });
  }));
});
