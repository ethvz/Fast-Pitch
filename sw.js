/* Retired: this app moved into SmartHomePros Connect (https://ethvz.github.io/SmartHomePros/). This worker clears the old offline copy,
   removes itself, and sends any open window to the new address. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil((async () => {
  for (const k of await caches.keys()) await caches.delete(k);
  await self.registration.unregister();
  for (const c of await self.clients.matchAll({ type: 'window' })) c.navigate('https://ethvz.github.io/SmartHomePros/pitch/index.html').catch(() => {});
})()));
