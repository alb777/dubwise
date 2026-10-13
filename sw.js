// Offline support: the whole app is cached on the first visit, then served from the cache.
// VERSION is a hash of the precached files, stamped by `npm run sw:version`; a test fails when it is stale.
const VERSION = "dubwise-5cc176c7c3";
const PRECACHE = [
    "./",
    "index.html",
    "styles.css",
    "manifest.webmanifest",
    "icons/icon.svg",
    "icons/icon-192.png",
    "icons/icon-512.png",
    "src/app.js",
    "src/console.js",
    "src/engine.js",
    "src/sequencer.js",
    "skills/dubwise/scripts/composer.mjs",
    "skills/dubwise/scripts/notation.mjs",
    "skills/dubwise/assets/riddims/one-drop.txt",
    "skills/dubwise/assets/riddims/rockers.txt",
    "skills/dubwise/assets/riddims/steppers.txt",
];

self.addEventListener("install", (event) => {
    event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(PRECACHE)));
    self.skipWaiting();
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches
            .keys()
            .then((keys) => Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key))))
            .then(() => self.clients.claim()),
    );
});

self.addEventListener("fetch", (event) => {
    if (event.request.method !== "GET" || new URL(event.request.url).origin !== self.location.origin) return;
    event.respondWith(
        caches
            .match(event.request, { ignoreSearch: true })
            .then((cached) => cached ?? fetch(event.request))
            .catch(() => caches.match("index.html")),
    );
});
