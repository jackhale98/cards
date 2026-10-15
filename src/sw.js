/* Lamplight's service worker: the app opens at once, and without a connection, once it has been
   visited. Pages come from the network when there is one (so a new version shows straight away)
   and from the phone when there isn't; scripts and styles, whose names change with their content,
   come from the phone first. Written into the build by vite.config.ts (serviceWorker), which fills
   in the build id and the list of files to keep. Not used by the dev server. */
const CACHE = 'lamplight-__BUILD__';
const SHELL = [/* __SHELL__ */];

self.addEventListener('install', (e) => {
  e.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // (files an earlier version already has are copied over, not downloaded again)
      await Promise.all(
        SHELL.map(async (path) => {
          const url = new URL(path, self.registration.scope).href;
          const had = path.startsWith('./assets/') ? await caches.match(url) : undefined;
          if (had) return cache.put(url, had);
          const res = await fetch(url, { cache: 'no-cache' });
          if (res.ok) await cache.put(url, res);
        }),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      // keep the version before this one too: a tab still open on it may yet load a part of it
      const ours = (await caches.keys()).filter((k) => k.startsWith('lamplight-') && k !== CACHE);
      await Promise.all(ours.slice(0, -1).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(async () => (await caches.match(self.registration.scope)) ?? Response.error()));
    return;
  }
  if (url.pathname.includes('/assets/')) {
    e.respondWith(
      (async () => {
        const hit = await caches.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) {
          const copy = res.clone();
          void caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })(),
    );
    return;
  }
  // the manifest and icons: fresh when online, kept for when not
  e.respondWith(fetch(req).catch(async () => (await caches.match(req)) ?? Response.error()));
});
