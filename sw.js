// Offline support: the whole app is cached on the first visit, then served from the cache.
// VERSION is a hash of the precached files, stamped by `npm run sw:version`; a test fails when it is stale.
const VERSION = "dubwise-c4c8327ec7";
// The in-browser AI model's library, pinned like WEBLLM_URL in src/ai.js. It is cached on first use under a name of
// its own, so app updates keep it; WebLLM keeps the model itself in caches of its own ("webllm/...").
const WEBLLM_URL = "https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.86/+esm";
const WEBLLM_CACHE = "webllm-lib-0.2.86";
const PRECACHE = [
    "./",
    "index.html",
    "styles.css",
    "manifest.webmanifest",
    "icons/icon.svg",
    "icons/icon-192.png",
    "icons/icon-512.png",
    "src/ai.js",
    "src/ai-worker.js",
    "src/app.js",
    "src/console.js",
    "src/engine.js",
    "src/guide.js",
    "src/sequencer.js",
    "skills/dubwise/scripts/artists.mjs",
    "skills/dubwise/scripts/composer.mjs",
    "skills/dubwise/scripts/intent.mjs",
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
            // Only the app's own old versions go; the AI model and its library stay downloaded.
            .then((keys) =>
                Promise.all(
                    keys
                        .filter((key) => key.startsWith("dubwise-") && key !== VERSION)
                        .map((key) => caches.delete(key)),
                ),
            )
            .then(() => self.clients.claim()),
    );
});

self.addEventListener("fetch", (event) => {
    if (event.request.method === "GET" && event.request.url === WEBLLM_URL) {
        event.respondWith(
            caches.open(WEBLLM_CACHE).then(async (cache) => {
                const cached = await cache.match(WEBLLM_URL);
                if (cached) return cached;
                const response = await fetch(event.request);
                if (response.ok) await cache.put(WEBLLM_URL, response.clone());
                return response;
            }),
        );
        return;
    }
    if (event.request.method !== "GET" || new URL(event.request.url).origin !== self.location.origin) return;
    event.respondWith(
        caches
            .match(event.request, { ignoreSearch: true })
            .then((cached) => cached ?? fetch(event.request))
            .catch(() => caches.match("index.html")),
    );
});
