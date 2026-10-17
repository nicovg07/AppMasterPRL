// Capa de datos. Imita una pequeña base de documentos (rutas tipo "topics/t1"):
//   Store.db.doc(path).get/set/update/delete   ·   Store.db.collection(path).onSnapshot(fn)
// Todo se guarda solo en este navegador (localStorage). No hay sincronización entre dispositivos:
// para llevar tus temas a otro, usa Ajustes → Copia de seguridad.
(function () {
  const LS_KEY = "prl:db";
  const clone = o => o == null ? o : JSON.parse(JSON.stringify(o));
  const isObj = o => o && typeof o === "object" && !Array.isArray(o);
  function deepMerge(t, s) { for (const k in s) { if (isObj(s[k]) && isObj(t[k])) deepMerge(t[k], s[k]); else t[k] = clone(s[k]); } return t; }

  let docs = {};            // path -> data
  let listeners = [];       // { prefix, next }

  function loadLocal() { try { docs = JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch (_) { docs = {}; } }
  let saveT = null;
  function saveLocal() { clearTimeout(saveT); saveT = setTimeout(() => { try { localStorage.setItem(LS_KEY, JSON.stringify(docs)); } catch (e) { console.warn("localStorage", e); } }, 150); }
  function inCollection(path, col) { const parts = path.split("/"); return path.startsWith(col + "/") && parts.length === col.split("/").length + 1; }
  function snapDoc(path) { const d = docs[path]; return { id: path.split("/").pop(), exists: d !== undefined, data: () => clone(d) }; }
  function emit() { for (const l of listeners) l.fire(); }
  function querySnap(col) { const ds = Object.keys(docs).filter(p => inCollection(p, col)).sort().map(snapDoc); return { docs: ds, size: ds.length, empty: !ds.length }; }

  const db = {
    doc(path) {
      if (path.split("/").length % 2) throw new TypeError("Una ruta de documento necesita un número par de segmentos: " + path);
      return {
        id: path.split("/").pop(), path,
        get: async () => snapDoc(path),
        set: async data => { docs[path] = clone(data); saveLocal(); emit(); },
        update: async data => { if (docs[path] === undefined) throw { code: "invalid_argument", message: "El documento no existe" }; deepMerge(docs[path], data); saveLocal(); emit(); },
        delete: async () => { delete docs[path]; saveLocal(); emit(); },
        onSnapshot(next) { const l = { fire: () => next(snapDoc(path)) }; listeners.push(l); setTimeout(l.fire, 0); return () => { listeners = listeners.filter(x => x !== l); }; }
      };
    },
    collection(col) {
      return {
        path: col,
        doc: id => db.doc(col + "/" + (id || Math.random().toString(36).slice(2, 12))),
        get: async () => querySnap(col),
        onSnapshot(next) { const l = { fire: () => next(querySnap(col)) }; listeners.push(l); setTimeout(l.fire, 0); return () => { listeners = listeners.filter(x => x !== l); }; }
      };
    }
  };

  // La app no guarda progreso: borra el de versiones anteriores (progreso, test a medias) y las tarjetas.
  function dropLegacy() {
    let changed = false;
    for (const p of Object.keys(docs)) if (p.startsWith("data/")) { delete docs[p]; changed = true; }
    for (const p of Object.keys(docs)) if (p.startsWith("banks/") && docs[p].cards) { delete docs[p].cards; changed = true; }
    try { localStorage.removeItem("prl:dirty"); } catch (_) {}
    if (changed) saveLocal();
  }

  // Añade lo nuevo de data/seed.json sin tocar lo que ya hay: asignaturas y temas que no estaban, preguntas
  // con id nuevo, y la versión nueva de una asignatura, un tema o un banco de preguntas si su "rev" es mayor
  // (en un banco se actualizan solo las preguntas que vienen del seed; las tuyas se quedan como están).
  // "meta/seed" recuerda lo que ya se añadió, para no volver a meter lo que hayas borrado.
  async function applySeed() {
    let seed;
    try { seed = await (await fetch("data/seed.json", { cache: "no-cache" })).json(); } catch (e) { console.warn("seed", e); return; }
    for (const [id, s] of Object.entries(seed.subjects || {})) {
      const cur = docs["subjects/" + id];
      if (cur === undefined || (s.rev || 0) > (cur.rev || 0)) await db.doc("subjects/" + id).set(s);
    }
    const meta = docs["meta/seed"];
    const known = { topics: new Set(meta ? meta.topics : []), items: new Set(meta ? meta.items : []) };
    if (!meta) for (const id of Object.keys(seed.topics || {})) if (docs["topics/" + id] !== undefined) { // instalaciones de antes de meta/seed
      known.topics.add(id); for (const x of ((seed.banks || {})[id] || {}).questions || []) known.items.add(x.id);
    }
    for (const [id, t] of Object.entries(seed.topics || {})) {
      const cur = docs["topics/" + id];
      if (cur === undefined ? !known.topics.has(id) : (t.rev || 0) > (cur.rev || 0)) await db.doc("topics/" + id).set(t);
      known.topics.add(id);
    }
    for (const [id, b] of Object.entries(seed.banks || {})) {
      if (docs["topics/" + id] === undefined) continue; // tema borrado
      const cur = docs["banks/" + id];
      const upd = !cur || (b.rev || 0) > (cur.rev || 0);
      const fromSeed = new Map((b.questions || []).map(x => [x.id, x]));
      let qs = cur ? cur.questions || [] : [];
      if (upd) qs = qs.map(x => fromSeed.get(x.id) || x);
      const have = new Set(qs.map(x => x.id));
      const fresh = (b.questions || []).filter(x => !have.has(x.id) && !known.items.has(x.id));
      if (upd || fresh.length) await db.doc("banks/" + id).set({ rev: Math.max(b.rev || 0, (cur && cur.rev) || 0), questions: [...qs, ...fresh] });
      for (const x of b.questions || []) known.items.add(x.id);
    }
    const next = { topics: [...known.topics].sort(), items: [...known.items].sort() };
    if (!meta || JSON.stringify(next) !== JSON.stringify({ topics: meta.topics, items: meta.items })) await db.doc("meta/seed").set(next);
  }

  const Store = {
    db,
    async init() {
      loadLocal();
      dropLegacy();
      await applySeed();
      return db;
    },
    exportAll: () => clone(docs),
    async importAll(obj) {
      if (!isObj(obj)) throw new Error("Archivo no válido");
      for (const [path, data] of Object.entries(obj)) if (path.split("/").length % 2 === 0 && isObj(data) && !path.startsWith("data/")) await db.doc(path).set(data);
    }
  };
  window.Store = Store;
})();
