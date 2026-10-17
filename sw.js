// Service worker: permite instalar la app y abrirla sin conexión.
// Primero intenta la red (para recibir siempre la última versión) y, si no hay conexión, usa la copia guardada.
const CACHE = "estudio-prl-v6";
const SHELL = ["./", "index.html", "styles.css", "config.js", "storage.js", "ai.js", "app.js", "data/seed.json", "manifest.webmanifest", "icons/icon.svg", "icons/icon-192.png", "icons/icon-512.png"];

self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const req = e.request; const url = new URL(req.url);
  if (req.method !== "GET") return;
  const sameOrigin = url.origin === location.origin;
  const isFont = /fonts\.(googleapis|gstatic)\.com$/.test(url.hostname) || url.hostname === "cdnjs.cloudflare.com";
  if (!sameOrigin && !isFont) return; // API de Claude, etc.: siempre por red
  e.respondWith(fetch(req).then(res => { if (res.ok || res.type === "opaque") { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); } return res; }).catch(() => caches.match(req).then(r => r || caches.match("index.html"))));
});
