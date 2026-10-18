// Service worker: permite instalar la app y abrirla sin conexión.
// Contesta al momento con la copia guardada y, por detrás, la actualiza desde la red (stale-while-revalidate): lo
// publicado se ve en la siguiente apertura. Al subir CACHE, la versión nueva se instala descargándolo todo de nuevo,
// sustituye a la anterior y avisa a la app, que ofrece recargar («Nueva versión disponible»).
const CACHE = "estudio-prl-v13";
const SHELL = ["./", "index.html", "styles.css", "storage.js", "app.js", "data/seed.json", "apuntes/apuntes.css", "manifest.webmanifest", "img/portada.webp", "icons/favicon-32.png", "icons/icon-180.png", "icons/icon-192.png", "icons/icon-512.png"];

// cache: "reload" para no guardar copias viejas de la caché HTTP (GitHub Pages las da por buenas 10 min)
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: "reload" })))).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    const old = (await caches.keys()).filter(k => k !== CACHE);
    await Promise.all(old.map(k => caches.delete(k)));
    await self.clients.claim();
    if (old.length) for (const c of await self.clients.matchAll({ type: "window" })) c.postMessage({ type: "updated", version: CACHE }); // no en la primera instalación
  })());
});

self.addEventListener("fetch", e => {
  const req = e.request; const url = new URL(req.url);
  if (req.method !== "GET") return;
  const sameOrigin = url.origin === location.origin;
  const isFont = /fonts\.(googleapis|gstatic)\.com$/.test(url.hostname);
  if (!sameOrigin && !isFont) return; // otros dominios: siempre por red
  e.respondWith(respond(e, req, sameOrigin));
});

async function respond(e, req, sameOrigin) {
  const cache = await caches.open(CACHE);
  // ignoreSearch: los apuntes se piden con ?embed=1&theme=…, pero el contenido es el mismo
  const cached = await cache.match(req, { ignoreSearch: true });
  // no-cache: pregunta al servidor si ha cambiado en vez de fiarse de la caché HTTP
  const net = fetch(req, sameOrigin ? { cache: "no-cache" } : undefined).then(res => {
    if (res.status === 200 || res.type === "opaque") cache.put(req, res.clone()).catch(() => {});
    return res;
  });
  if (cached) { e.waitUntil(net.catch(() => {})); return cached; } // la red actualiza la copia por detrás
  try { return await net; }
  catch (_) { return (req.mode === "navigate" && await cache.match("index.html")) || Response.error(); }
}
