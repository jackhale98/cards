/* Lamplight's service worker: the app opens at once, and without a connection, once it has been
   visited. Pages come from the network when there is one (so a new version shows straight away)
   and from the phone when there isn't; scripts and styles, whose names change with their content,
   come from the phone first. Only the app itself is downloaded at install; each game's rules and
   bots come when first played, and are kept. Written into the build by vite.config.ts (serviceWorker), which fills
   in the build id and the list of files to keep. Not used by the dev server. */
const CACHE = 'lamplight-__BUILD__';
/** The app itself: downloaded at install. */
const SHELL = [/* __SHELL__ */];
/** Every file of this build: kept from an earlier version if it has it (a game played before). */
const KNOWN = [/* __KNOWN__ */];

self.addEventListener('install', (e) => {
  e.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      const url = (path) => new URL(path, self.registration.scope).href;
      // (files an earlier version already has are copied over, not downloaded again)
      await Promise.all([
        ...SHELL.map(async (path) => {
          const had = path.startsWith('./assets/') ? await caches.match(url(path)) : undefined;
          if (had) return cache.put(url(path), had);
          const res = await fetch(url(path), { cache: 'no-cache' });
          if (res.ok) await cache.put(url(path), res);
        }),
        ...KNOWN.filter((path) => !SHELL.includes(path)).map(async (path) => {
          const had = await caches.match(url(path));
          if (had) await cache.put(url(path), had);
        }),
      ]);
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

// A "your turn" notification tapped: back to the app (the window that has the table, if one's
// open), and the badge down: on an iPhone it stays until the app takes it down.
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    (async () => {
      await self.navigator.clearAppBadge?.().catch(() => {});
      const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const tab = open.find((c) => 'focus' in c);
      if (tab) await tab.focus();
      else await self.clients.openWindow(self.registration.scope);
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
