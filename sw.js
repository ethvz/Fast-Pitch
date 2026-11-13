/* Fast Pitch offline service worker.
   - "Download for offline" (from the menu) precaches every file in offline.json.
   - Pages: network first, cached copy when offline.
   - Assets: exact cached copy if present, otherwise network (and keep a copy); offline falls back to any cached version of the same file.
   - Video/audio: answers Range requests from the cache so iOS can play/scrub offline. */
const CACHE = 'fp-offline-v1';
const SCOPE = self.registration.scope;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
  await self.clients.claim();
})()));

const isPage = req => req.mode === 'navigate' || (req.destination === 'document');
const bare = url => { const u = new URL(url); u.search = ''; u.hash = ''; return u.href; };

async function rangeFrom(res, req) {
  const range = req.headers.get('range');
  if (!range || !res) return res;
  const buf = await res.arrayBuffer();
  const m = /bytes=(\d*)-(\d*)/.exec(range) || [];
  const size = buf.byteLength;
  let start = m[1] === '' || m[1] == null ? NaN : +m[1];
  let end = m[2] === '' || m[2] == null ? NaN : +m[2];
  if (isNaN(start)) { start = Math.max(0, size - (isNaN(end) ? size : end)); end = size - 1; }
  if (isNaN(end) || end >= size) end = size - 1;
  return new Response(buf.slice(start, end + 1), {
    status: 206, statusText: 'Partial Content',
    headers: { 'Content-Type': res.headers.get('Content-Type') || 'application/octet-stream',
      'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1), 'Accept-Ranges': 'bytes' }
  });
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) {
    /* fonts etc.: cache-first */
    e.respondWith((async () => {
      const c = await caches.open(CACHE); const hit = await c.match(req);
      if (hit) return hit;
      try { const r = await fetch(req); if (r && (r.ok || r.type === 'opaque')) c.put(req, r.clone()); return r; } catch (err) { return hit || Response.error(); }
    })());
    return;
  }
  if (isPage(req)) {
    e.respondWith((async () => {
      const c = await caches.open(CACHE);
      try {
        const r = await Promise.race([fetch(req), new Promise((_, rej) => setTimeout(() => rej('t'), 4000))]);
        if (r && r.ok) c.put(SCOPE, r.clone());
        return r;
      } catch (err) {
        return (await c.match(SCOPE)) || (await c.match(SCOPE + 'index.html')) || Response.error();
      }
    })());
    return;
  }
  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    const plain = new Request(req.url, { headers: {} });
    let hit = await c.match(plain);
    if (!hit) {
      try {
        const r = await fetch(plain);
        if (r && r.ok) { c.put(plain, r.clone()); return rangeFrom(r, req); }
        hit = await c.match(bare(req.url), { ignoreSearch: true });
        return hit ? rangeFrom(hit, req) : r;
      } catch (err) {
        hit = await c.match(bare(req.url), { ignoreSearch: true });
        if (!hit) return Response.error();
      }
    }
    return rangeFrom(hit, req);
  })());
});

/* precache everything in offline.json, reporting progress to the page */
let running = null;
self.addEventListener('message', e => {
  const d = e.data || {};
  if (d.type === 'download') { if (!running) running = download().finally(() => running = null); e.waitUntil(running); }
  if (d.type === 'status') e.waitUntil(status());
});
async function post(msg) { for (const cl of await self.clients.matchAll({ includeUncontrolled: true })) cl.postMessage(msg); }
async function list() {
  const r = await fetch(SCOPE + 'offline.json', { cache: 'no-store' });
  const j = await r.json();
  return { v: j.v, files: j.files.map(f => new URL(f, SCOPE).href) };
}
async function status() {
  try {
    const c = await caches.open(CACHE); const done = await (await c.match(SCOPE + '__offline'))?.text();
    await post({ type: 'status', done: done || null });
  } catch (err) { await post({ type: 'status', done: null }); }
}
async function download() {
  try {
    const c = await caches.open(CACHE);
    const { v, files } = await list();
    const all = [SCOPE, ...files];
    let n = 0, fail = 0; const N = all.length;
    await post({ type: 'progress', n, N });
    const q = all.slice();
    const worker = async () => {
      while (q.length) {
        const u = q.shift();
        try {
          const r = await fetch(u, { cache: 'reload' });
          if (r.ok) await c.put(u === SCOPE ? SCOPE : bare(u), r); else fail++;
        } catch (err) { fail++; }
        n++; if (n % 4 === 0 || n === N) await post({ type: 'progress', n, N });
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
    if (fail > N * 0.02) { await post({ type: 'error', fail, N }); return; }
    await c.put(SCOPE + '__offline', new Response(String(v)));
    await post({ type: 'done', v, fail });
  } catch (err) { await post({ type: 'error', msg: String(err) }); }
}
