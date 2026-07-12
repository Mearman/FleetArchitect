// Service worker: make a regular refresh always load the latest deploy.
//
// GitHub Pages serves every file with `Cache-Control: max-age=600`, including
// the HTML document. After a deploy, a plain refresh within that 10-minute
// window serves the CACHED index.html, which references the old content-hashed
// asset bundles (also cached) — so the user sees stale app code (and stale
// rendering) until they hard-refresh. We can't change GitHub's headers, so the
// service worker is the one place we control freshness.
//
// Strategy:
//   - Navigation requests (the HTML document): NETWORK-FIRST. Always fetch the
//     latest index.html so a new deploy's hashed assets are picked up on the
//     next visit; fall back to a cached copy only when the network fails.
//   - Same-origin static GETs (the hashed JS/CSS/fonts): CACHE-FIRST with
//     background revalidation. The build content-hashes these, so a cached copy
//     is always the correct bytes for its filename — caching them long is safe
//     and keeps repeat visits instant.
//
// The worker script itself is cached for max-age=600 too, so a returning user
// picks up a new sw.js (e.g. a CACHE bump) within ~10 minutes; once active it
// enforces the network-first document policy regardless.

const CACHE = "fleet-architect-v1";

self.addEventListener("install", () => {
  // Take over from the previous worker as soon as this one finishes installing,
  // so a new deploy's policy applies without waiting for all tabs to close.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Drop caches from previous worker versions, then claim open clients so
      // the new worker controls the current tab immediately.
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(req);
          // Cache only a good document; a transient error response must not
          // poison the cached entry. Fall back to a prior good copy.
          if (res.ok) {
            const cache = await caches.open(CACHE);
            cache.put(req, res.clone());
            return res;
          }
          const cached = await caches.match(req);
          return cached ?? res;
        } catch {
          // Offline: serve the last-seen document if we have it.
          return (
            (await caches.match(req)) ??
            new Response("Offline — connect to load Fleet Architect.", {
              status: 503,
              headers: { "Content-Type": "text/plain" },
            })
          );
        }
      })(),
    );
    return;
  }

  // Hashed assets: cache-first, refresh in the background.
  event.respondWith(
    (async () => {
      const cached = await caches.match(req);
      const network = fetch(req)
        .then((res) => {
          if (res.ok) {
            caches.open(CACHE).then((c) => c.put(req, res.clone()));
          }
          return res;
        })
        .catch(() => undefined);
      return cached ?? (await network) ?? Response.error();
    })(),
  );
});
