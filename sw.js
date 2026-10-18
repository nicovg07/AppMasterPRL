// Service worker: permite instalar la app y abrirla sin conexión.
// Primero intenta la red (para recibir siempre la última versión), pero si tarda más de TIMEOUT ms y hay
// copia guardada, usa la copia y deja que la red la actualice por detrás. Sin conexión, siempre la copia.
const CACHE = "estudio-prl-v12";
const TIMEOUT = 3000;
let slowUntil = 0; // tras una espera agotada, durante 30 s se contesta con la copia sin esperar (red lenta)
const SHELL = ["./", "index.html", "styles.css", "storage.js", "app.js", "data/seed.json", "apuntes/apuntes.css", "manifest.webmanifest", "img/portada.webp", "icons/favicon-32.png", "icons/icon-180.png", "icons/icon-192.png", "icons/icon-512.png"];

self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });

self.addEventListener("fetch", e => {
  const req = e.request; const url = new URL(req.url);
  if (req.method !== "GET") return;
  const sameOrigin = url.origin === location.origin;
  const isFont = /fonts\.(googleapis|gstatic)\.com$/.test(url.hostname);
  if (!sameOrigin && !isFont) return; // otros dominios: siempre por red
  e.respondWith(respond(e, req));
});

async function respond(e, req) {
  const cache = await caches.open(CACHE);
  // ignoreSearch: los apuntes se piden con ?embed=1&theme=…, pero el contenido es el mismo
  const cached = await cache.match(req, { ignoreSearch: true });
  const net = fetch(req).then(res => {
    if (res.ok || res.type === "opaque") cache.put(req, res.clone());
    return res;
  });
  if (!cached) {
    try { return await net; }
    catch (_) { return (req.mode === "navigate" && await cache.match("index.html")) || Response.error(); }
  }
  e.waitUntil(net.catch(() => {})); // la red sigue actualizando la copia aunque contestemos antes con ella
  if (Date.now() < slowUntil) return cached;
  let timer;
  const slow = new Promise(r => { timer = setTimeout(() => { slowUntil = Date.now() + 30000; r(cached); }, TIMEOUT); });
  try { return await Promise.race([net, slow]); }
  catch (_) { return cached; }
  finally { clearTimeout(timer); }
}
