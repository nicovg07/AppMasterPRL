"use strict";
/* ---------- helpers ---------- */
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const rid = () => Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
const shuffle = a => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const clone = o => o == null ? o : JSON.parse(JSON.stringify(o));
function lsGet(k) { try { return JSON.parse(localStorage.getItem("prl:" + k)); } catch (_) { return null; } }
function lsSet(k, v) { try { localStorage.setItem("prl:" + k, JSON.stringify(v)); } catch (_) {} }
const DIFF = { facil: "Fácil", media: "Media", dificil: "Difícil" };
const ORIGIN = { oficial: "Autoevaluación", claude: "Generada", auto: "Generada", propia: "Tuya" };
const LET = "ABCDEFGH";
const fmtNum = n => String(Math.round(n * 10) / 10).replace(".", ",");
const pct = (a, b) => b ? Math.round(a / b * 100) : 0;
function fmtTime(sec) { sec = Math.max(0, Math.round(sec)); const m = Math.floor(sec / 60), s = sec % 60; return `${m}:${String(s).padStart(2, "0")}`; }
// act: el aviso entero es un botón que lanza A[act] (p. ej. recargar con la versión nueva).
function toast(msg, ms = 2600, act) { const t = $("#toast"); t.innerHTML = act ? `<button data-act="${act}">${esc(msg)}</button>` : esc(msg); t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, ms); }
// Si el navegador no deja guardar (memoria llena o datos bloqueados), se avisa como mucho una vez cada 20 s.
addEventListener("prl:savefail", () => {
  if (Date.now() - (toast.failAt || 0) < 20000) return; toast.failAt = Date.now();
  toast("No se ha podido guardar en este dispositivo. Puede que la memoria esté llena: descarga una copia en Ajustes.", 7000);
});
// Vibración corta al responder y al entregar (Android; el iPhone no deja vibrar desde la web). Se quita en Ajustes.
// Sin haber tocado la página, Chrome la bloquea y lo anota como error (p. ej. si el examen acaba solo por tiempo).
const canVibrate = "vibrate" in navigator;
function haptic(p = 12) { if (!canVibrate || lsGet("vibra") === false || navigator.userActivation?.hasBeenActive === false) return; try { navigator.vibrate(p); } catch (_) {} }
// Versión nueva: el service worker avisa al activarse. Si estás en mitad de un test, el aviso espera a que salgas.
let updReady = false;
function showUpdate() { if (!updReady || S.view === "run") return; updReady = false; toast("Nueva versión disponible. Pulsa aquí para actualizar.", 12000, "reload"); }
navigator.serviceWorker?.addEventListener("message", e => { if (e.data && e.data.type === "updated") { updReady = true; showUpdate(); } });

const svg = (d, x = 'stroke-width="1.8"') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ${x} stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICON = {
  home: svg('<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>'),
  test: svg('<rect x="4" y="3" width="16" height="18" rx="2"/><path d="m8 9 1.5 1.5L12 8M8 15.5l1.5 1.5L12 14.5M14.5 9.5H17M14.5 16H17"/>'),
  sun: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
  moon: svg('<path d="M20.5 14.5A8.5 8.5 0 1 1 9.5 3.5a7 7 0 0 0 11 11z"/>'),
  chart: svg('<path d="M4 20h16M7 16v-4M12 16V7M17 16v-7"/>'),
  down: svg('<path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19h14"/>', 'stroke-width="2" width="18" height="18"'),
  book: svg('<path d="M12 6.5C10.5 5 8 4.5 4 4.5v14c4 0 6.5.5 8 2 1.5-1.5 4-2 8-2v-14c-4 0-6.5.5-8 2zM12 6.5v14"/>'),
  tri: '<svg class="tri" viewBox="0 0 18 16" aria-hidden="true"><path d="M9 1 17 15H1z" fill="none" stroke="var(--warn)" stroke-width="1.6" stroke-linejoin="round"/><path d="M9 6v4" stroke="var(--warn)" stroke-width="1.6" stroke-linecap="round"/><circle cx="9" cy="12.4" r=".9" fill="var(--warn)"/></svg>'
};

/* ---------- state ---------- */
// Entre sesiones se guardan el test a medias ("prl:active_run", para retomarlo si el móvil cierra la app), el
// cuaderno de fallos ("user/errors") y el historial de tests para las estadísticas ("user/history").
const S = {
  view: "home", p: {}, mode: "loading",
  topics: {}, banks: {}, subjects: {}, ready: { t: false, b: false, s: false },
  db: null,
  setup: Object.assign({ tids: [], diffs: ["facil", "media", "dificil"], origin: "todas", n: 10, mode: "practica", min: null, shuf: true, penalty: false }, lsGet("setup") || {}),
  run: null, res: {}, lock: false, errors: {}, history: []
};

/* ---------- data access ---------- */
const subjOrder = sid => S.subjects[sid]?.order ?? 999;
const topicList = () => Object.values(S.topics).sort((a, b) => subjOrder(a.subject) - subjOrder(b.subject) || (a.subject || "").localeCompare(b.subject || "") || (a.order || 0) - (b.order || 0) || (a.createdAt || 0) - (b.createdAt || 0));
const bank = tid => S.banks[tid] || { questions: [] };
// Dónde se explica en los apuntes impresos: { t?: tema si es otro, pg: número impreso en la página, sec: apartado }
const topicNum = t => t ? String(t.code || "").replace(/^T/i, "") : "";
const srcText = (src, tid) => { if (!src || !src.pg) return ""; const t = S.topics[src.t || tid]; return `${t ? "Tema " + topicNum(t) + " · " : ""}pág. ${src.pg}`; };
const whereHTML = (src, tid) => src && src.pg ? `<div class="where">${ICON.book}<span class="small">En tus apuntes:</span><span class="ref accent">${esc(srcText(src, tid))}</span>${src.sec ? `<span class="small">${esc(src.sec)}</span>` : ""}</div>` : "";
const allQ = () => topicList().flatMap(t => bank(t.id).questions.map(q => ({ ...q, tid: t.id })));
function findQ(tid, qid) { return bank(tid).questions.find(q => q.id === qid); }
/* Asignaturas: las de subjects/<id> (aunque aún no tengan temas) y, después, las que solo aparecen en algún tema. */
function subjects() {
  const m = new Map();
  for (const s of Object.values(S.subjects).sort((a, b) => (a.order ?? 999) - (b.order ?? 999) || (a.name || "").localeCompare(b.name || ""))) m.set(s.id, { id: s.id, name: s.name || "Asignatura", short: s.short || s.name || "Asignatura", topics: [] });
  for (const t of topicList()) { const k = t.subject || "otra"; if (!m.has(k)) m.set(k, { id: k, name: t.subjectName || "Asignatura", short: t.subjectShort || t.subjectName || "Asignatura", topics: [] }); m.get(k).topics.push(t); }
  return [...m.values()];
}
const nQuestions = s => s.topics.reduce((n, t) => n + bank(t.id).questions.length, 0);
function subjChipsHead(s, sel, act) { const all = s.topics.every(t => sel.includes(t.id)); return `<div class="spread"><span class="small muted">${esc(s.short)}</span><button class="link small" data-act="${act}" data-s="${esc(s.id)}">${all ? "Quitar todos" : "Elegir todos"}</button></div>`; }
function toggleSubj(sel, sid) { const ids = (subjects().find(x => x.id === sid)?.topics || []).map(t => t.id); return ids.every(id => sel.includes(id)) ? sel.filter(x => !ids.includes(x)) : [...new Set([...sel, ...ids])]; }

/* writes: one at a time per document */
const chains = {};
function enqueue(key, fn) { const p = (chains[key] || Promise.resolve()).then(fn); chains[key] = p.catch(() => {}); return p; }
async function guarded(key, fn) { try { await enqueue(key, fn); return true; } catch (e) { console.warn(e); toast("No se pudo guardar. Revisa que el navegador permita guardar datos de este sitio."); return false; } }
function writeBank(tid) { const b = { ...clone(bank(tid)) }; return guarded("bank:" + tid, () => S.db.doc("banks/" + tid).set(b)); }

/* Tema claro u oscuro: sigue al sistema hasta que se pulsa el botón; entonces se recuerda la elección. */
const isDark = () => (document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")) === "dark";
function paintTheme() {
  const b = $("#themeBtn"), dark = isDark();
  if (b) { b.innerHTML = dark ? ICON.sun : ICON.moon; b.setAttribute("aria-label", dark ? "Cambiar a modo claro" : "Cambiar a modo oscuro"); b.title = b.getAttribute("aria-label"); }
  const bg = getComputedStyle(document.body).backgroundColor;
  if (document.documentElement.dataset.theme) document.querySelectorAll('meta[name="theme-color"]').forEach(m => m.content = bg);
}
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", paintTheme);

async function boot() {
  initNav();
  paintTheme();
  render();
  const db = await Store.init();
  S.db = db; S.mode = "ok";
  Promise.all([loadErrors(), loadHistory()]).then(() => { S.loaded = true; refresh(); });
  Store.persist().then(v => { S.persisted = v; if (S.view === "settings") render(); });
  db.collection("topics").onSnapshot(snap => { const t = {}; for (const d of snap.docs) if (d.exists) t[d.id] = { id: d.id, ...d.data() }; S.topics = t; S.ready.t = true; refresh(); });
  db.collection("subjects").onSnapshot(snap => { const s = {}; for (const d of snap.docs) if (d.exists) s[d.id] = { id: d.id, ...d.data() }; S.subjects = s; S.ready.s = true; refresh(); });
  db.collection("banks").onSnapshot(snap => { const b = {}; for (const d of snap.docs) if (d.exists) { const x = d.data(); b[d.id] = { ...(x.rev ? { rev: x.rev } : {}), questions: x.questions || [] }; } S.banks = b; S.ready.b = true; refresh(); });
}

/* ---------- rendering ---------- */
const LIVE = ["home", "subject", "topic", "setup", "stats"];
function refresh(force) {
  if (S.lock && !force) return;
  if (S.autoReview && S.loaded && !contentLoading() && autoReview()) return;
  if (LIVE.includes(S.view) || force) render();
}
/* ---------- navegación con el historial (botón o gesto «Atrás» del móvil) ---------- */
// Cada pantalla es una entrada del historial { view, p, y }: «Atrás» vuelve a la anterior sin salir de la app.
// go(view, p, mode): "push" (por defecto) añade una entrada, "replace" sustituye la actual y false no toca el
// historial (lo usa popstate). Volver a la misma pantalla con otra pestaña sustituye en vez de añadir.
const TRANSIENT = ["leaveAsk", "submitAsk", "del", "clrErr", "clrHist"]; // confirmaciones abiertas: no se guardan en el historial
function navParams(p) {
  const o = {}; for (const k in p || {}) if (!TRANSIENT.includes(k)) o[k] = p[k];
  try { return JSON.parse(JSON.stringify(o)); } catch (_) { return {}; }
}
function setHistory(mode, view, p) {
  try {
    const st = { view, p: navParams(p) };
    if (mode === "replace") { history.replaceState(st, "", "#" + view); return; }
    if (history.state && history.state.view) history.replaceState({ ...history.state, y: window.scrollY }, ""); // para volver al mismo sitio
    history.pushState(st, "", "#" + view);
  } catch (e) { console.warn("history", e); }
}
function go(view, p = {}, mode = "push") {
  if (S.view === "run" && view !== "run") { stopTimer(); saveActiveRun(); }
  if (mode === "push" && view === S.view && (p.sid || p.tid) === (S.p.sid || S.p.tid)) mode = "replace";
  if (mode) setHistory(mode, view, p);
  const tip = view === "run" && S.view !== "run";
  S.view = view; S.p = p; S.lock = false; render(); window.scrollTo(0, 0);
  if (tip) swipeTip();
}
// Accesos directos del icono de la app (manifest): #examen abre Test en modo examen y #fallos empieza el repaso
// del cuaderno en cuanto se han cargado los datos (si no hay un test a medias, que se ofrece antes).
function hashView(h) {
  if (h === "examen") { S.setup.mode = "examen"; S.setup.min = null; saveSetup(); return "setup"; }
  if (h === "fallos") { S.autoReview = true; return "setup"; }
  return ["home", "setup", "settings", "stats"].includes(h) ? h : null;
}
function autoReview() {
  S.autoReview = false;
  if (savedRun()) return false;
  if (!errItems().length) { toast("No tienes fallos pendientes"); return false; }
  A.reviewErrors(); return true;
}
// Al arrancar se recupera la pantalla de esta pestaña (al recargar, el navegador conserva history.state) o la del
// enlace (#setup, #settings…). Un test o un resultado no sobreviven a la recarga: se va a Test, que ofrece continuar.
function initNav() {
  let view = "home", p = {};
  const st = history.state;
  if (st && st.view && VIEWS[st.view]) { view = st.view; p = st.p || {}; }
  else view = hashView(location.hash.slice(1)) || "home";
  if (view === "run" || view === "result") { view = "setup"; p = {}; }
  S.view = view; S.p = p;
  setHistory("replace", view, p);
}
// Mantiene en la entrada actual los cambios hechos sin navegar (pestañas, filtros), solo si han cambiado.
function syncHistory() {
  try {
    const st = history.state; if (!st || st.view !== S.view) return;
    const p = navParams(S.p); if (JSON.stringify(p) !== JSON.stringify(st.p || {})) history.replaceState({ ...st, p }, "");
  } catch (_) {}
}
addEventListener("popstate", e => {
  try {
    const st = e.state || {};
    let view = VIEWS[st.view] ? st.view : "home", p = st.p || {};
    // sin estado: se ha cambiado el #… de la dirección (un acceso directo con la app ya abierta)
    if (!e.state) { view = hashView(location.hash.slice(1)) || "home"; p = {}; setHistory("replace", view, p); }
    if (view === "run") {
      if (S.view !== "run" && resumeRun(false)) return;
      if (!activeRun()) { view = "setup"; p = {}; setHistory("replace", view, p); }
    }
    if (view === "result" && !S.lastResult) { view = "setup"; p = {}; setHistory("replace", view, p); }
    const pausing = S.view === "run" && view !== "run" && activeRun();
    go(view, p, false);
    if (S.autoReview) refresh();
    if (pausing) toast("Test en pausa: lo retomas desde Test.", 4000);
    if (st.y) requestAnimationFrame(() => window.scrollTo(0, st.y));
  } catch (err) { console.warn("popstate", err); go("home", {}, "replace"); }
});

/* ---------- test a medias: se guarda para retomarlo si el móvil cierra la app ---------- */
// Instantánea de S.run en "prl:active_run" con la hora (savedAt), en cada cambio y al ocultar la app. Al continuar,
// el tiempo que estuvo cerrada o en otra pantalla no cuenta: startedAt se desplaza lo que duró la pausa.
const ACTIVE_KEY = "prl:active_run";
const activeRun = () => !!(S.run && !S.run.done);
function saveActiveRun() {
  if (!activeRun()) return;
  try { localStorage.setItem(ACTIVE_KEY, JSON.stringify({ ...S.run, savedAt: Date.now() })); }
  catch (e) { console.warn("active_run", e); }
}
function savedRun() {
  try {
    const r = JSON.parse(localStorage.getItem(ACTIVE_KEY));
    return r && Array.isArray(r.items) && r.items.length && Array.isArray(r.answers) && !r.done ? r : null;
  } catch (_) { return null; }
}
function clearActiveRun() { try { localStorage.removeItem(ACTIVE_KEY); } catch (_) {} }
function resumeRun(mode = "push") {
  const r = savedRun() || (activeRun() ? { ...S.run, savedAt: Date.now() } : null);
  if (!r) return false;
  const paused = Math.max(0, Date.now() - (r.savedAt || Date.now()));
  delete r.savedAt;
  r.startedAt = (r.startedAt || Date.now()) + paused;
  S.run = r; go("run", {}, mode);
  return true;
}
function runBanner() {
  const r = activeRun() ? S.run : savedRun(); if (!r) return "";
  const done = r.answers.filter(a => a != null).length, total = r.items.length;
  return `<div class="callout accent confirm"><span class="grow">Tienes un test a medias: ${done} de ${total} ${total === 1 ? "pregunta respondida" : "preguntas respondidas"}.</span><button class="btn sm" data-act="resume">Continuar</button><button class="btn quiet sm" data-act="discardRun">Descartar</button></div>`;
}
addEventListener("pagehide", () => { if (S.view === "run") saveActiveRun(); });
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden" && S.view === "run") saveActiveRun(); });

/* ---------- historial de tests (estadísticas) ---------- */
// Cada test terminado se guarda en el documento "user/history" del Store (entra en la copia de seguridad):
// { items: [{ date, mode, kind, nota, aciertos, fallos, blanco, total, sec, porTema: { tid: [aciertos, total] } }] }.
// kind: "test" (normal), "fallos" (repaso del cuaderno) o "repetir" (no acertadas). Se guardan los 300 últimos.
// Media, evolución y aciertos por asignatura cuentan solo los tests normales: los repasos se hacen con preguntas
// ya falladas y bajarían la nota sin decir nada de cómo vas.
const HIST_DOC = "user/history", HIST_MAX = 300;
async function loadHistory() {
  try { const d = await S.db.doc(HIST_DOC).get(); const it = d.exists && d.data().items; S.history = Array.isArray(it) ? it : []; }
  catch (e) { console.warn("history", e); S.history = []; }
}
function saveHistory() { const items = clone(S.history || []); return guarded("history", () => S.db.doc(HIST_DOC).set({ items })); }
function recordHistory(run, rows, c, w, b, nota, sec) {
  try {
    const porTema = {};
    for (const x of rows) { const t = porTema[x.tid] || (porTema[x.tid] = [0, 0]); t[1]++; if (x.ok) t[0]++; }
    const item = { date: Date.now(), mode: run.mode, kind: run.kind || "test", nota: Math.round(nota * 100) / 100, aciertos: c, fallos: w, blanco: b, total: rows.length, sec: Math.round(sec), porTema };
    S.history = [...(S.history || []), item].slice(-HIST_MAX);
    if (S.db) saveHistory();
  } catch (e) { console.warn("history", e); }
}

/* ---------- cuaderno de fallos ---------- */
// Preguntas falladas (o en blanco) que se guardan entre sesiones en el documento "user/errors" del Store, así
// entran en la copia de seguridad: { items: { "tid/qid": { tid, qid, failedAt, streak } } }.
// Fallar la pone a streak 0; acertarla suma 1, y con 2 aciertos seguidos sale del cuaderno (consolidada).
const ERR_DOC = "user/errors";
async function loadErrors() {
  try { const d = await S.db.doc(ERR_DOC).get(); S.errors = (d.exists && d.data().items) || {}; }
  catch (e) { console.warn("errors", e); S.errors = {}; }
}
const errItems = () => Object.values(S.errors || {}).filter(e => e && findQ(e.tid, e.qid));
function saveErrors() { const items = clone(S.errors || {}); return guarded("errors", () => S.db.doc(ERR_DOC).set({ items })); }
function updateErrors(rows) {
  const E = { ...(S.errors || {}) }, now = Date.now(); let added = 0, cleared = 0;
  for (const x of rows) {
    const k = x.tid + "/" + x.qid;
    if (!x.ok) { if (!E[k]) added++; E[k] = { tid: x.tid, qid: x.qid, failedAt: now, streak: 0 }; }
    else if (E[k]) { const st = (E[k].streak || 0) + 1; if (st >= 2) { delete E[k]; cleared++; } else E[k] = { ...E[k], streak: st }; }
  }
  S.errors = E;
  if (S.db) saveErrors();
  return { added, cleared };
}
function render() {
  const v = VIEWS[S.view] || VIEWS.home;
  $("#main").innerHTML = S.mode === "loading" ? loadingView() : v();
  renderNav();
  if (S.view === "run" && S.run && S.run.mode === "examen" && !S.run.done) startTimer();
  if (S.view === "run") saveActiveRun();
  if (S.view === "doc") fitDocFrame();
  syncHistory();
  showUpdate();
  const gear = $("#gear"); if (gear) gear.setAttribute("aria-current", S.view === "settings" ? "page" : "false");
}
function renderNav() {
  const tab = { settings: "", setup: "setup", run: "setup", result: "setup", stats: "stats" }[S.view] ?? "home";
  const it = [["home", "Inicio", ICON.home], ["setup", "Test", ICON.test], ["stats", "Progreso", ICON.chart]];
  $("#nav").innerHTML = it.map(([v, l, i]) => `<button data-act="nav" data-v="${v}" ${tab === v ? 'aria-current="page"' : ""}>${i}<span>${l}</span></button>`).join("");
}
function loadingView() { return `<div class="stack"><div class="skel" style="width:40%"></div><div class="skel" style="width:70%;height:30px"></div><div class="skel" style="width:90%"></div><div class="skel" style="width:60%"></div></div>`; }
function contentLoading() { return !(S.ready.t && S.ready.b && S.ready.s); }

const VIEWS = {};

/* ----- home: una tarjeta por asignatura ----- */
VIEWS.home = () => {
  if (contentLoading()) return loadingView();
  const all = subjects();
  if (!all.length) return `<div class="stack-lg"><div class="stack"><p class="eyebrow">Máster PRL · Nebrija</p><h1>Aún no hay temas</h1></div></div>`;
  return `<div class="stack-lg">${runBanner()}<img class="hero" src="img/portada.webp" alt="Máster en PRL · Prevención de Riesgos Laborales" width="1024" height="572">
    <div class="stack" style="gap:4px"><p class="eyebrow">Universidad Nebrija</p><h1>Asignaturas</h1></div>
    <div class="subjects">${all.map((s, i) => `<button class="subj ${s.topics.length ? "" : "void"}" data-act="subject" data-s="${esc(s.id)}"><span class="eyebrow">Asignatura ${i + 1}</span><span class="subj-name">${esc(s.short)}</span><span class="small muted">${s.topics.length ? `${s.topics.length} ${s.topics.length === 1 ? "tema" : "temas"} · ${nQuestions(s)} preguntas` : "Sin temas todavía"}</span></button>`).join("")}</div>
  </div>`;
};

/* ----- subject ----- */
VIEWS.subject = () => {
  if (contentLoading()) return loadingView();
  const all = subjects(); const i = all.findIndex(s => s.id === S.p.sid); const s = all[i];
  if (!s) return `<p class="empty">Esta asignatura ya no existe.</p>`;
  const tab = S.p.tab === "apuntes" ? "apuntes" : "temas";
  const docs = s.topics.filter(t => (t.apuntes || []).length);
  return `<div class="stack-lg"><div class="stack"><button class="back" data-act="go" data-v="home">← Asignaturas</button>
    <div class="stack" style="gap:4px"><p class="eyebrow">Asignatura ${i + 1}</p><h1>${esc(s.short)}</h1>${s.name !== s.short ? `<p class="small muted">${esc(s.name)}</p>` : ""}</div></div>
    ${s.topics.length ? `<div class="row" style="display:grid;grid-template-columns:1fr 1fr;gap:10px"><button class="btn" data-act="quick" data-m="practica" data-s="${esc(s.id)}">Practicar</button><button class="btn ghost" data-act="quick" data-m="examen" data-s="${esc(s.id)}">Simular examen</button></div>
    <div class="tabs" role="tablist">${[["temas", "Temas"], ["apuntes", "Apuntes"]].map(([k, l]) => `<button role="tab" aria-selected="${tab === k}" data-act="subject" data-s="${esc(s.id)}" data-k="${k}">${l}</button>`).join("")}</div>
    ${tab === "apuntes" ? (docs.length ? `<p class="small muted">El resumen de cada tema y lo que hay que memorizar. Ábrelos aquí o descárgalos en PDF.</p><div class="list">${docs.map(docRow).join("")}</div>` : `<p class="empty">Aún no hay apuntes de esta asignatura.</p>`)
      : `<div class="list">${s.topics.map(topicRow).join("")}</div>`}`
    : `<p class="empty">Aún no hay temas de esta asignatura.</p>`}
  </div>`;
};
/* Apuntes de cada tema (resumen y para memorizar): una página HTML para verla aquí y el mismo contenido en PDF. */
const DOCS = { resumen: "Resumen", memorizar: "Para memorizar" };
const docBase = (tid, kind) => `apuntes/${tid}-${kind}`;
function docRow(t) {
  return `<div class="item"><span class="ref accent">${esc(t.code || "T")}</span><div class="grow stack" style="gap:8px"><span class="item-title">${esc(t.title)}</span><div class="row" style="gap:8px">${t.apuntes.filter(k => DOCS[k]).map(k => `<button class="btn ghost sm" data-act="doc" data-t="${t.id}" data-k="${k}">${DOCS[k]}</button>`).join("")}</div></div></div>`;
}
VIEWS.doc = () => {
  if (contentLoading()) return loadingView();
  const t = S.topics[S.p.tid], kind = S.p.kind;
  if (!t || !(t.apuntes || []).includes(kind) || !DOCS[kind]) return `<p class="empty">Estos apuntes no están disponibles.</p>`;
  const other = t.apuntes.find(k => k !== kind && DOCS[k]);
  const sname = subjects().find(s => s.id === t.subject)?.short || t.subjectShort || "Asignatura";
  const file = `${t.code} ${DOCS[kind]} - ${t.title}.pdf`.replace(/[\/:*?"<>|]/g, "");
  return `<div class="stack"><button class="back" data-act="subject" data-s="${esc(t.subject || "")}" data-k="apuntes">← ${esc(sname)} · Apuntes</button>
    <div class="row" style="gap:8px"><a class="btn sm" href="${docBase(t.id, kind)}.pdf" download="${esc(file)}">${ICON.down}Descargar PDF</a>${other ? `<button class="btn ghost sm" data-act="doc" data-t="${t.id}" data-k="${other}">Ver ${kind === "resumen" ? "para memorizar" : "el resumen"}</button>` : ""}</div>
    <iframe id="docFrame" class="doc-frame" src="${docBase(t.id, kind)}.html?embed=1&amp;theme=${isDark() ? "dark" : "light"}" title="${esc(t.code + " · " + DOCS[kind])}"></iframe></div>`;
};
// El iframe toma la altura de su contenido, así la página se desplaza entera (sin un scroll dentro de otro).
function fitDocFrame() {
  const f = $("#docFrame"); if (!f) return;
  const fit = () => { try { const d = f.contentDocument; if (d && d.documentElement) f.style.height = d.documentElement.scrollHeight + "px"; } catch (_) {} };
  f.addEventListener("load", () => { fit(); try { new ResizeObserver(fit).observe(f.contentDocument.body); } catch (_) {} });
}
function topicRow(t) {
  const n = bank(t.id).questions.length;
  return `<button class="item" data-act="topic" data-t="${t.id}"><span class="ref accent">${esc(t.code || "T")}</span><div class="grow stack" style="gap:4px"><span class="item-title">${esc(t.title)}</span><span class="small muted">${n} ${n === 1 ? "pregunta" : "preguntas"}</span></div></button>`;
}

/* ----- topic ----- */
VIEWS.topic = () => {
  const t = S.topics[S.p.tid]; if (!t) return contentLoading() ? loadingView() : `<p class="empty">Este tema ya no existe.</p>`;
  const tab = S.p.tab || "resumen";
  const tabs = [["resumen", "Resumen"], ["recursos", "Recursos"], ["banco", "Preguntas"]];
  const sname = subjects().find(s => s.id === t.subject)?.short || t.subjectShort || "Asignatura";
  return `<div class="stack-lg"><div class="stack"><button class="back" data-act="subject" data-s="${esc(t.subject || "")}">← ${esc(sname)}</button>
    <div class="row"><span class="ref accent">${esc(t.code)}</span></div><h1>${esc(t.title)}</h1></div>
    <div class="tabs" role="tablist">${tabs.map(([k, l]) => `<button role="tab" aria-selected="${tab === k}" data-act="tab" data-k="${k}">${l}</button>`).join("")}</div>
    ${({ resumen: tabResumen, recursos: tabRecursos, banco: tabBanco })[tab](t)}
  </div>`;
};
function tabResumen(t) {
  const sm = t.summary || [];
  if (!sm.length) return `<p class="empty">Este tema no tiene resumen.</p>`;
  return `<div class="stack-lg">${sm.map(b => `<section class="block"><h2>${esc(b.h)}</h2><ul class="keys">${(b.keys || []).map(k => typeof k === "string" ? `<li class="noref"><span>${esc(k)}</span></li>` : k.r ? `<li><span><span class="ref">${esc(k.r)}</span></span><span>${esc(k.t)}</span></li>` : `<li class="noref"><span>${esc(k.t)}</span></li>`).join("")}</ul>${b.trap ? `<div class="trap">${ICON.tri}<span><b>Ojo en el test.</b> ${esc(b.trap)}</span></div>` : ""}</section>`).join("")}
  <button class="btn" data-act="practiceTopic" data-t="${t.id}">Practicar este tema</button></div>`;
}

/* ----- resources ----- */
function tabRecursos(t) {
  const rs = t.resources || [];
  if (!rs.length) return `<p class="empty">Este tema no tiene recursos interactivos.</p>`;
  return `<div class="stack-lg">${rs.map((r, i) => `<section class="res" id="res-${i}">${renderRes(t.id, i, r)}</section>`).join("")}</div>`;
}
function resState(tid, i, r) {
  const key = tid + ":" + i; if (S.res[key]) return S.res[key];
  let st;
  if (r.type === "match") st = { right: shuffle(r.pairs.map((_, j) => j)), done: [], sel: null, miss: null, errors: 0 };
  else if (r.type === "classify") st = { queue: shuffle(r.items.map((_, j) => j)), pos: 0, ok: 0, wrong: [], last: null };
  else if (r.type === "order") { let o = shuffle(r.items.map((_, j) => j)); if (o.every((v, j) => v === j) && o.length > 1) o.reverse(); st = { order: o, checked: false }; }
  return S.res[key] = st;
}
function renderRes(tid, i, r) {
  const st = resState(tid, i, r);
  const head = (label, extra = "") => `<div class="spread"><div class="stack" style="gap:2px"><span class="eyebrow">${label}</span><h3>${esc(r.title)}</h3></div>${extra}</div>`;
  const reset = `<button class="btn quiet sm" data-act="resReset" data-t="${tid}" data-i="${i}">Reiniciar</button>`;
  if (r.type === "match") {
    const left = r.pairs.map((p, j) => `<button class="tile ${st.done.includes(j) ? "done" : st.sel === j ? "sel" : ""}" ${st.done.includes(j) ? "disabled" : ""} data-act="mL" data-t="${tid}" data-i="${i}" data-j="${j}">${esc(p[0])}</button>`).join("");
    const right = st.right.map(j => `<button class="tile ${st.done.includes(j) ? "done" : st.miss === j ? "miss" : ""}" ${st.done.includes(j) ? "disabled" : ""} data-act="mR" data-t="${tid}" data-i="${i}" data-j="${j}">${esc(r.pairs[j][1])}</button>`).join("");
    const fin = st.done.length === r.pairs.length;
    return head("Relaciona", reset) + (fin ? `<div class="callout ok">Completado con ${st.errors} ${st.errors === 1 ? "fallo" : "fallos"}.</div>` : `<p class="small muted">Toca un elemento de la izquierda y después su pareja. ${st.done.length}/${r.pairs.length}</p>`) + `<div class="match"><div class="col">${left}</div><div class="col">${right}</div></div>`;
  }
  if (r.type === "classify") {
    if (st.pos >= st.queue.length) return head("Clasifica", reset) + `<div class="callout ${st.wrong.length ? "warn" : "ok"}"><b>${st.ok} de ${r.items.length}</b> a la primera.${st.wrong.length ? ` Para repasar: ${st.wrong.map(j => esc(r.items[j][0])).join(" · ")}` : ""}</div>`;
    const j = st.queue[st.pos]; const it = r.items[j];
    const fb = st.last ? `<div class="callout ${st.last.ok ? "ok" : "bad"} small">${st.last.ok ? "Correcto." : `Era <b>${esc(r.categories[r.items[st.last.j][1]])}</b>: ${esc(r.items[st.last.j][0])}`}</div>` : "";
    return head("Clasifica", reset) + `<p class="small muted tnum">${st.pos + 1} de ${st.queue.length}</p><div class="callout" style="font-size:17px;font-weight:600">${esc(it[0])}</div><div class="chips">${r.categories.map((c, k) => `<button class="chip" data-act="cls" data-t="${tid}" data-i="${i}" data-k="${k}">${esc(c)}</button>`).join("")}</div>${fb}`;
  }
  if (r.type === "order") {
    const rows = st.order.map((j, pos) => `<div class="r ${st.checked ? (j === pos ? "ok" : "no") : ""}"><span>${esc(r.items[j][0])}${st.checked ? ` <span class="ref">${esc(r.items[j][1])}</span>` : ""}</span><span class="mv"><button aria-label="Subir" data-act="ordMv" data-t="${tid}" data-i="${i}" data-pos="${pos}" data-d="-1" ${pos === 0 ? "disabled" : ""}>↑</button><button aria-label="Bajar" data-act="ordMv" data-t="${tid}" data-i="${i}" data-pos="${pos}" data-d="1" ${pos === st.order.length - 1 ? "disabled" : ""}>↓</button></span></div>`).join("");
    const okN = st.order.filter((j, p) => j === p).length;
    return head("Ordena", reset) + `<div class="ord">${rows}</div><div class="row">${st.checked ? `<span class="small">${okN} de ${st.order.length} en su sitio.</span>` : ""}<button class="btn sm" data-act="ordCheck" data-t="${tid}" data-i="${i}">Comprobar</button></div>`;
  }
  return head("Recurso") + `<p class="muted small">Tipo de recurso no reconocido.</p>`;
}
function rerenderRes(tid, i) { const t = S.topics[tid]; const el = $("#res-" + i); if (t && el) el.innerHTML = renderRes(tid, i, t.resources[i]); }

/* ----- question bank ----- */
function tabBanco(t) {
  const qs = bank(t.id).questions; const f = S.p.f || "todas";
  const list = qs.filter(q => f === "todas" || q.diff === f || q.origin === f);
  const counts = { oficial: qs.filter(q => q.origin === "oficial").length };
  return `<div class="stack">
    <div class="row"><button class="btn sm" data-act="gen" data-t="${t.id}">Generar preguntas</button><button class="btn ghost sm" data-act="editq" data-t="${t.id}">Nueva pregunta</button></div>
    <div class="chips">${[["todas", `Todas · ${qs.length}`], ["oficial", `Autoevaluación · ${counts.oficial}`], ["facil", "Fácil"], ["media", "Media"], ["dificil", "Difícil"]].map(([k, l]) => `<button class="chip" aria-pressed="${f === k}" data-act="bf" data-k="${k}">${l}</button>`).join("")}</div>
    <div class="list">${list.map(q => `<button class="item" data-act="editq" data-t="${t.id}" data-q="${q.id}"><div class="grow stack" style="gap:6px"><span>${esc(q.q)}</span><span class="row" style="gap:6px"><span class="badge ${q.origin === "oficial" ? "oficial" : ""}">${ORIGIN[q.origin] || "Tuya"}</span><span class="badge">${DIFF[q.diff] || "Media"}</span>${q.src && q.src.pg ? `<span class="badge">${esc(q.src.t ? srcText(q.src, t.id) : "pág. " + q.src.pg)}</span>` : ""}${q.check ? `<span class="badge check">Revisar respuesta</span>` : ""}</span></div></button>`).join("") || `<p class="empty">No hay preguntas con este filtro.</p>`}</div>
  </div>`;
}

/* ----- question editor ----- */
VIEWS.editq = () => {
  const t = S.topics[S.p.tid]; if (!t) return `<p class="empty">Tema no encontrado.</p>`;
  const q = S.p.qid ? findQ(t.id, S.p.qid) : null;
  const d = q || { q: "", opts: ["", "", "", ""], a: 0, exp: "", diff: "media", origin: "propia" };
  const opts = [...d.opts]; while (opts.length < 4) opts.push("");
  return `<form class="stack-lg" id="fq" data-t="${t.id}"><div class="stack"><button type="button" class="back" data-act="backTopic" data-k="banco">← ${esc(t.code)} · Preguntas</button><h1>${q ? "Editar pregunta" : "Nueva pregunta"}</h1></div>
    <div class="field"><label for="q_q">Enunciado</label><textarea class="input" id="q_q" required>${esc(d.q)}</textarea></div>
    <div class="field"><span class="label">Respuestas · marca la correcta</span>${opts.map((o, i) => `<div class="row" style="flex-wrap:nowrap"><input type="radio" name="q_a" id="q_a${i}" value="${i}" ${d.a === i ? "checked" : ""} style="width:22px;height:22px;accent-color:var(--ok)" aria-label="Correcta ${LET[i]}"><span class="ref">${LET[i]}</span><input class="input" id="q_o${i}" value="${esc(o)}" placeholder="${i < 2 ? "Obligatoria" : "Opcional"}"></div>`).join("")}</div>
    <div class="field"><label for="q_e">Explicación</label><textarea class="input" id="q_e" placeholder="Por qué es correcta">${esc(d.exp)}</textarea></div>
    <div class="field"><span class="label">Dificultad</span><div class="seg" id="q_d">${Object.entries(DIFF).map(([k, l]) => `<button type="button" aria-pressed="${d.diff === k}" data-act="segPick" data-k="${k}">${l}</button>`).join("")}</div></div>
    ${q && q.check ? `<div class="callout warn small">La respuesta correcta no venía marcada en la autoevaluación y se dedujo de los apuntes. Compruébala y guarda.</div>` : ""}
    <div class="row"><button class="btn" type="submit">Guardar</button><button class="btn ghost" type="button" data-act="backTopic" data-k="banco">Cancelar</button>
    ${q ? (S.p.del ? `<span class="confirm"><button class="btn danger sm" type="button" data-act="delQ">Sí, eliminar</button><button type="button" class="btn quiet sm" data-act="delNo">No</button></span>` : `<button class="btn quiet" type="button" style="color:var(--bad)" data-act="delAsk">Eliminar</button>`) : ""}</div>
  </form>`;
};

/* ----- test setup ----- */
function pool(cfg = S.setup) {
  const tids = cfg.tids.length ? cfg.tids : topicList().map(t => t.id);
  return allQ().filter(q => tids.includes(q.tid) && cfg.diffs.includes(q.diff || "media") && (cfg.origin === "todas" || (cfg.origin === "oficial" ? q.origin === "oficial" : q.origin !== "oficial")));
}
VIEWS.setup = () => {
  if (contentLoading()) return loadingView();
  const c = S.setup; const P = pool(); const n = c.n === 0 ? P.length : Math.min(c.n, P.length);
  const min = c.min || Math.max(1, n);
  const sb = subjects().filter(s => s.topics.length);
  const nErr = errItems().length;
  return `<div class="stack-lg">
    ${runBanner()}
    <div class="stack"><p class="eyebrow">Nuevo test</p><h1>${c.mode === "examen" ? "Simular examen" : "Practicar"}</h1></div>
    ${nErr ? `<button class="btn ghost block" data-act="reviewErrors">Repasar mis fallos (${nErr} ${nErr === 1 ? "pregunta pendiente" : "preguntas pendientes"})</button>` : ""}
    <div class="seg">${[["practica", "Práctica"], ["examen", "Examen"]].map(([k, l]) => `<button aria-pressed="${c.mode === k}" data-act="set" data-f="mode" data-k="${k}">${l}</button>`).join("")}</div>
    <p class="small muted" style="margin-top:-18px">${c.mode === "examen" ? "Con tiempo y sin correcciones hasta que entregues. Al final, nota y repaso de fallos." : "Corrige cada respuesta al momento y explica por qué."}</p>
    <div class="field"><span class="label">Temas</span>${sb.map(s => `<div class="stack" style="gap:8px">${subjChipsHead(s, c.tids, "setSub")}<div class="chips">${s.topics.map(t => `<button class="chip" aria-pressed="${c.tids.includes(t.id)}" data-act="setT" data-t="${t.id}"><span class="mono small">${esc(t.code)}</span> ${esc(t.title)}</button>`).join("")}</div></div>`).join("")}<span class="small muted">${c.tids.length ? `${c.tids.length} ${c.tids.length === 1 ? "tema" : "temas"} mezclados` : "Sin selección: entran todos los temas"}</span></div>
    <div class="field"><span class="label">Dificultad</span><div class="chips">${Object.entries(DIFF).map(([k, l]) => `<button class="chip" aria-pressed="${c.diffs.includes(k)}" data-act="setD" data-k="${k}">${l}</button>`).join("")}</div></div>
    <div class="field"><span class="label">Preguntas</span><div class="seg">${[["todas", "Todas"], ["oficial", "Autoevaluación"], ["nuevas", "Generadas y tuyas"]].map(([k, l]) => `<button aria-pressed="${c.origin === k}" data-act="set" data-f="origin" data-k="${k}">${l}</button>`).join("")}</div></div>
    <div class="field"><span class="label">Cuántas</span><div class="seg">${[5, 10, 20, 30, 0].map(k => `<button aria-pressed="${c.n === k}" data-act="setN" data-k="${k}">${k || "Todas"}</button>`).join("")}</div></div>
    ${c.mode === "examen" ? `<div class="field"><label for="exmin">Tiempo (minutos)</label><input class="input tnum" id="exmin" type="number" min="1" max="240" inputmode="numeric" value="${min}" data-chg="exmin" style="max-width:140px"></div>
      <label class="toggle" for="pen"><span><b>Restar fallos</b><br><span class="small muted">Cada fallo resta 1/(nº de opciones − 1) de acierto</span></span><input type="checkbox" id="pen" ${c.penalty ? "checked" : ""} data-chg="pen"></label>` : ""}
    <div><label class="toggle" for="shuf"><span><b>Barajar respuestas</b><br><span class="small muted">Para no memorizar la posición</span></span><input type="checkbox" id="shuf" ${c.shuf ? "checked" : ""} data-chg="shuf"></label></div>
    <div class="stack"><button class="btn block" data-act="start" ${n ? "" : "disabled"}>Empezar · ${n} ${n === 1 ? "pregunta" : "preguntas"}</button>
    ${P.length < 15 && topicList().length ? `<p class="small muted">Solo hay ${P.length} preguntas con estos filtros. <button class="link" data-act="gen" data-t="${c.tids[0] || topicList()[0].id}">Genera más</button></p>` : ""}</div>
  </div>`;
};

/* ----- runner ----- */
function buildRun(cfg, items) {
  const list = items || shuffle(pool(cfg)).slice(0, cfg.n || undefined);
  return {
    mode: cfg.mode, kind: cfg.kind || "test", startedAt: Date.now(), penalty: !!cfg.penalty, idx: 0, done: false,
    limitSec: cfg.mode === "examen" ? Math.round((cfg.min || Math.max(1, list.length)) * 60) : 0,
    items: list.map(q => ({ tid: q.tid, qid: q.id, order: cfg.shuf ? shuffle(q.opts.map((_, i) => i)) : q.opts.map((_, i) => i) })),
    answers: list.map(() => null), flags: list.map(() => false), shown: list.map(() => false)
  };
}
function runQ(i) { const it = S.run.items[i]; return findQ(it.tid, it.qid); }
VIEWS.run = () => {
  const r = S.run; if (!r) return `<p class="empty">No hay ningún test en curso.</p>`;
  const i = r.idx, it = r.items[i], q = runQ(i);
  const total = r.items.length;
  const exam = r.mode === "examen";
  const top = `<div class="runbar">${exam ? `<span class="timer" id="timer">${fmtTime(r.limitSec - (Date.now() - r.startedAt) / 1000)}</span>` : `<span class="mono small tnum">${i + 1}/${total}</span>`}<div class="bar grow"><i style="width:${pct(exam ? r.answers.filter(a => a != null).length : i + (r.shown[i] ? 1 : 0), total)}%"></i></div><button class="btn quiet sm" data-act="leaveAsk">Salir</button></div>
    ${S.p.leaveAsk ? `<div class="callout warn confirm" style="margin-bottom:16px"><span class="grow">¿Salir y descartar el test? No podrás continuarlo.</span><button class="btn danger sm" data-act="leave">Salir</button><button class="btn quiet sm" data-act="leaveNo">Seguir</button></div>` : ""}`;
  if (!q) return top + `<div class="stack"><p class="empty">Esta pregunta se ha eliminado del banco.</p><button class="btn" data-act="${i < total - 1 ? "next" : exam ? "submitAsk" : "finish"}">${i < total - 1 ? "Siguiente" : "Terminar"}</button></div>`;
  const t = S.topics[it.tid];
  const ans = r.answers[i]; const shown = !exam && r.shown[i];
  const opts = it.order.map((oi, pos) => {
    let cls = ""; if (shown) { if (oi === q.a) cls = "right"; else if (oi === ans) cls = "wrong"; } else if (ans === oi) cls = "sel";
    return `<button class="opt ${cls}" data-act="pick" data-o="${oi}" ${shown ? "disabled" : ""}><span class="l">${LET[pos]}</span><span>${esc(q.opts[oi])}</span></button>`;
  }).join("");
  let after = "";
  if (shown) {
    const ok = ans === q.a;
    after = `<div class="callout ${ok ? "ok" : "bad"} stack" style="gap:6px"><b>${ok ? "Correcto" : "Incorrecto · la buena es la " + LET[it.order.indexOf(q.a)]}</b>${q.exp ? `<p class="explain">${esc(q.exp)}</p>` : ""}${whereHTML(q.src, it.tid)}</div>
    <button class="btn block" data-act="${i < total - 1 ? "next" : "finish"}">${i < total - 1 ? "Siguiente" : "Ver resultado"}</button>`;
  }
  const examNav = exam ? `<div class="spread"><button class="btn ghost sm" data-act="prev" ${i === 0 ? "disabled" : ""}>Anterior</button><button class="btn ghost sm" data-act="flag" aria-pressed="${r.flags[i]}">${r.flags[i] ? "Marcada" : "Marcar para revisar"}</button><button class="btn sm" data-act="${i < total - 1 ? "next" : "submitAsk"}">${i < total - 1 ? "Siguiente" : "Entregar"}</button></div>
    <div class="stack"><span class="label">Preguntas</span><div class="grid-n">${r.items.map((_, k) => `<button class="${r.answers[k] != null ? "done" : ""} ${k === i ? "cur" : ""} ${r.flags[k] ? "flag" : ""}" data-act="jump" data-k="${k}" aria-label="Pregunta ${k + 1}">${k + 1}</button>`).join("")}</div></div>
    ${S.p.submitAsk ? `<div class="callout warn confirm"><span class="grow">${r.answers.filter(a => a == null).length ? `Te quedan ${r.answers.filter(a => a == null).length} sin responder. ` : ""}¿Entregar el examen?</span><button class="btn sm" data-act="finish">Entregar</button><button class="btn quiet sm" data-act="submitNo">Seguir</button></div>` : `<button class="btn ghost block" data-act="submitAsk">Entregar examen</button>`}` : "";
  return `${top}<div class="stack-lg"><div class="stack"><div class="row"><span class="ref">${esc(t?.code || "")}</span>${q.origin === "oficial" ? `<span class="badge oficial">Autoevaluación</span>` : ""}<span class="badge">${DIFF[q.diff] || "Media"}</span>${exam ? `<span class="small muted tnum">Pregunta ${i + 1} de ${total}</span>` : ""}</div><p class="qtext">${esc(q.q)}</p></div><div class="opts">${opts}</div>${after}${examNav}</div>`;
};
let timerI = null;
function startTimer() { stopTimer(); timerI = setInterval(() => { const r = S.run; const el = $("#timer"); if (!r || r.done) return stopTimer(); const left = r.limitSec - (Date.now() - r.startedAt) / 1000; if (el) { el.textContent = fmtTime(left); el.classList.toggle("low", left < 60); } if (left <= 0) { stopTimer(); finishRun(true); } }, 1000); }
function stopTimer() { clearInterval(timerI); timerI = null; }

function finishRun(timeUp) {
  const r = S.run; if (!r || r.done) return;
  r.done = true; stopTimer();
  if (r.mode === "examen") haptic(25);
  let c = 0, w = 0, b = 0, score = 0;
  const rows = r.items.map((it, i) => {
    const q = findQ(it.tid, it.qid); if (!q) return null;
    const a = r.answers[i]; const ok = a === q.a;
    if (a == null) b++; else if (ok) { c++; score += 1; } else { w++; if (r.penalty) score -= 1 / Math.max(1, q.opts.length - 1); }
    return { tid: it.tid, qid: it.qid, order: it.order, a, ok };
  }).filter(Boolean);
  const nota = Math.max(0, score / (rows.length || 1) * 10);
  const sec = Math.min((Date.now() - r.startedAt) / 1000, r.limitSec || Infinity);
  clearActiveRun();
  const err = updateErrors(rows);
  recordHistory(r, rows, c, w, b, nota, sec);
  S.lastResult = { mode: r.mode, rows, c, w, b, nota, sec, timeUp: !!timeUp, penalty: r.penalty, err };
  go("result", {}, "replace");
}
VIEWS.result = () => {
  const R = S.lastResult; if (!R) return `<p class="empty">No hay resultados.</p>`;
  const wrong = R.rows.filter(x => !x.ok);
  return `<div class="stack-lg">
    <div class="stack"><p class="eyebrow">${R.mode === "examen" ? "Examen entregado" : "Práctica terminada"}${R.timeUp ? " · tiempo agotado" : ""}</p>
    <div class="row" style="align-items:baseline;gap:12px"><span class="score">${fmtNum(R.nota)}</span><span class="muted">sobre 10</span></div></div>
    <div class="stats"><div class="stat"><b style="color:var(--ok)">${R.c}</b><span>aciertos</span></div><div class="stat"><b style="color:var(--bad)">${R.w}</b><span>fallos${R.penalty ? " (restan)" : ""}</span></div><div class="stat"><b>${R.mode === "examen" ? fmtTime(R.sec) : R.b}</b><span>${R.mode === "examen" ? "tiempo" : "en blanco"}</span></div></div>
    ${R.err ? `<p class="small muted">Cuaderno de fallos: ${R.err.added ? `${R.err.added} ${R.err.added === 1 ? "nueva" : "nuevas"}` : "ninguna nueva"}${R.err.cleared ? ` · ${R.err.cleared} ${R.err.cleared === 1 ? "consolidada" : "consolidadas"}` : ""} · ${(n => `${n} ${n === 1 ? "pendiente" : "pendientes"} en total`)(errItems().length)}.</p>` : ""}
    <div class="row">${wrong.length ? `<button class="btn" data-act="retryWrong">Repetir las ${wrong.length} no acertadas</button>` : ""}<button class="btn ghost" data-act="go" data-v="setup">Nuevo test</button></div>
    <section class="stack"><h2>Repaso</h2><div class="list">${R.rows.map((x, k) => { const q = findQ(x.tid, x.qid); if (!q) return ""; const mine = x.a == null ? "Sin responder" : `${LET[x.order.indexOf(x.a)]}. ${esc(q.opts[x.a])}`; return `<div class="item"><span class="ref" style="background:${x.ok ? "var(--ok-soft)" : "var(--bad-soft)"};color:${x.ok ? "var(--ok)" : "var(--bad)"}">${k + 1}</span><div class="grow stack" style="gap:6px"><span class="item-title">${esc(q.q)}</span>${x.ok ? `<span class="small" style="color:var(--ok)">${LET[x.order.indexOf(q.a)]}. ${esc(q.opts[q.a])}</span>` : `<span class="small" style="color:var(--bad)">Tu respuesta: ${mine}</span><span class="small" style="color:var(--ok)">Correcta: ${LET[x.order.indexOf(q.a)]}. ${esc(q.opts[q.a])}</span>`}${!x.ok && q.exp ? `<span class="small muted">${esc(q.exp)}</span>` : ""}${!x.ok ? whereHTML(q.src, x.tid) : ""}</div></div>`; }).join("")}</div></section>
  </div>`;
};

/* ----- generar preguntas (sin IA): las crea la app con los recursos y el resumen del tema ----- */
const norm = s => String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const REF_LEGAL = /^(CE|ET|LPRL|RSP|LGSS(\/15)?|LISOS|LOLS|CC|CP|RDLeg|RD|Ley|Directiva|Art\.)\b|^C\d{3}\b/i;
const head = s => (String(s).match(/^[A-Za-zÁÉÍÓÚáéíóú]+/) || [""])[0].toLowerCase();
const similarFirst = (right, pool) => shuffle(pool).sort((a, b) => (head(b) === head(right)) - (head(a) === head(right)));
const leadTitle = title => title.replace(/:\s*ordena.*$/i, "").replace(/^ordena\s+(\S)/i, (_, c) => c.toUpperCase());
function genCandidates(t) {
  const out = [], seenQ = new Set();
  const add = (q, right, pool, exp, diff, minWrong = 2, src = null) => {
    const k = norm(q); if (seenQ.has(k)) return;
    const used = new Set([norm(right)]), wrong = [];
    for (const w of pool) { const n = norm(w); if (!n || used.has(n)) continue; used.add(n); wrong.push(w); if (wrong.length === 3) break; }
    if (wrong.length < minWrong) return;
    seenQ.add(k); out.push({ q, right, wrong, exp, diff, src });
  };
  for (const r of t.resources || []) {
    const at = i => (r.src || [])[i] || null;
    if (r.type === "match") r.pairs.forEach(([a, b], i) => {
      const others = r.pairs.filter(p => p[0] !== a);
      add(`${r.title}: ¿qué corresponde a «${a}»?`, b, shuffle(others.map(p => p[1])), `«${a}»: ${b}.`, "facil", 2, at(i));
      add(`${r.title}: ¿qué corresponde a «${b}»?`, a, shuffle(others.map(p => p[0])), `«${b}»: ${a}.`, "media", 2, at(i));
    });
    if (r.type === "classify") r.items.forEach(([item, k], i) => {
      const q = /\?$/.test(r.title) ? `«${item}». ${r.title}` : `«${item}»: ${r.title}`;
      add(q, r.categories[k], shuffle(r.categories.filter((_, j) => j !== k)), `«${item}» va en «${r.categories[k]}».`, r.categories.length > 2 ? "media" : "facil", 1, at(i));
    });
    if (r.type === "order" && !/grave/i.test(r.title)) {
      if (r.items.every(x => /^\d{4}$/.test(x[1]))) r.items.forEach(([h, y], i) =>
        add(`«${h}»: ¿en qué año?`, y, shuffle(r.items.filter(x => x[0] !== h).map(x => x[1])), `${h}: ${y}.`, "dificil", 2, at(i)));
      r.items.forEach(([h], i) => {
        if (i === r.items.length - 1) return;
        const next = r.items[i + 1][0];
        add(`${leadTitle(r.title)}: ¿qué va justo después de «${h}»?`, next, shuffle(r.items.filter((_, j) => j !== i && j !== i + 1).map(x => x[0])),
          `Orden: ${r.items.slice(Math.max(0, i - 1), i + 3).map(x => x[0]).join(" → ")}.`, "dificil", 2, at(i + 1));
      });
    }
  }
  const keys = (t.summary || []).flatMap(b => (b.keys || []).filter(k => k.r && REF_LEGAL.test(k.r)));
  for (const k of keys) add(`¿Qué norma o artículo corresponde a esta idea? «${k.t}»`, k.r, similarFirst(k.r, keys.filter(x => norm(x.r) !== norm(k.r)).map(x => x.r)), `${k.r}: ${k.t}.`, "dificil", 2, k.src || null);
  return out;
}
function genPool(t) { const have = new Set(bank(t.id).questions.map(q => norm(q.q))); return genCandidates(t).filter(c => !have.has(norm(c.q))); }
VIEWS.gen = () => {
  const t = S.topics[S.p.tid]; if (!t) return `<p class="empty">Elige un tema para generar.</p>`;
  const g = S.p; const res = g.result || []; const left = genPool(t).length;
  return `<div class="stack-lg"><div class="stack"><button class="back" data-act="backTopic" data-k="banco">← ${esc(t.code)} · Preguntas</button><h1>Generar preguntas</h1><p class="muted">La app las crea con los recursos y el resumen de «${esc(t.title)}», sin repetir las que ya tienes.</p></div>
    <div class="field"><span class="label">Cuántas</span><div class="seg">${[5, 10, 20].map(k => `<button aria-pressed="${(g.n || 10) === k}" data-act="genSet" data-f="n" data-k="${k}">${k}</button>`).join("")}</div></div>
    <div class="row"><button class="btn" data-act="genRun" ${left ? "" : "disabled"}>${res.length ? "Generar otras" : "Generar"}</button><span class="small muted">${left ? `Se pueden crear ${left} más` : "Ya tienes todas las que se pueden crear con este tema."}</span></div>
    ${res.length ? `<section class="stack"><div class="spread"><h2>${res.length} ${res.length === 1 ? "pregunta nueva" : "preguntas nuevas"}</h2><span class="small muted">Desmarca las que no quieras</span></div>
      <div>${res.map((x, i) => `<label class="gen-q" for="gk${i}"><input type="checkbox" id="gk${i}" ${x.keep ? "checked" : ""} data-chg="genKeep" data-i="${i}"><span class="stack" style="gap:6px"><b>${esc(x.q)}</b><span class="small">${x.opts.map((o, k) => `<span style="${k === x.a ? "color:var(--ok);font-weight:600" : "color:var(--muted)"}">${LET[k]}. ${esc(o)}</span>`).join("<br>")}</span><span class="row" style="gap:6px"><span class="badge">${DIFF[x.diff]}</span>${x.src && x.src.pg ? `<span class="badge">pág. ${esc(x.src.pg)}</span>` : ""}</span></span></label>`).join("")}</div>
      <button class="btn block" data-act="genSave" ${res.some(x => x.keep) ? "" : "disabled"}>Añadir ${res.filter(x => x.keep).length} al tema</button></section>` : ""}
  </div>`;
};
function genRun() {
  const t = S.topics[S.p.tid]; if (!t) return;
  const shown = new Set((S.p.result || []).map(x => norm(x.q)));
  let pool = genPool(t).filter(c => !shown.has(norm(c.q))); if (!pool.length) pool = genPool(t);
  S.p.result = shuffle(pool).slice(0, S.p.n || 10).map(c => { const opts = shuffle([c.right, ...c.wrong]); return { q: c.q, opts, a: opts.indexOf(c.right), exp: c.exp, diff: c.diff, src: c.src, keep: true }; });
  render();
}
async function genSave() {
  const t = S.topics[S.p.tid]; const keep = (S.p.result || []).filter(x => x.keep); if (!t || !keep.length) return;
  const b = clone(bank(t.id));
  keep.forEach(x => b.questions.push({ id: rid(), q: x.q, opts: x.opts, a: x.a, exp: x.exp, diff: x.diff, origin: "auto", ...(x.src ? { src: x.src } : {}) }));
  S.banks[t.id] = b;
  if (await writeBank(t.id)) { toast(`${keep.length} ${keep.length === 1 ? "añadida" : "añadidas"} a ${t.code}`); go("topic", { tid: t.id, tab: "banco" }); }
}

/* ---------- actions ---------- */
const saveSetup = () => lsSet("setup", S.setup);
const A = {
  theme: () => { const t = isDark() ? "light" : "dark"; document.documentElement.dataset.theme = t; lsSet("theme", t); paintTheme(); if (S.view === "doc") render(); },
  go: el => go(el.dataset.v),
  nav: el => { const v = el.dataset.v; if (v === "setup" && activeRun()) { if (S.view !== "run") resumeRun(); return; } go(v); },
  resume: () => resumeRun(),
  discardRun: () => { clearActiveRun(); if (activeRun()) { stopTimer(); S.run = null; } render(); },
  reviewErrors: () => {
    const items = errItems().map(e => ({ ...findQ(e.tid, e.qid), tid: e.tid }));
    if (!items.length) return toast("No tienes fallos pendientes");
    S.run = buildRun({ ...S.setup, mode: "practica", n: 0, kind: "fallos" }, shuffle(items)); go("run");
  },
  clrErrAsk: () => { S.p.clrErr = true; render(); },
  clrHistAsk: () => { S.p.clrHist = true; render(); },
  clrHistNo: () => { S.p.clrHist = false; render(); },
  clrHist: async () => { S.history = []; S.p.clrHist = false; await saveHistory(); toast("Historial borrado"); render(); },
  clrErrNo: () => { S.p.clrErr = false; render(); },
  clrErr: async () => { S.errors = {}; S.p.clrErr = false; await saveErrors(); toast("Cuaderno de fallos vaciado"); render(); },
  subject: el => go("subject", { sid: el.dataset.s, tab: el.dataset.k || "temas" }),
  doc: el => go("doc", { tid: el.dataset.t, kind: el.dataset.k }),
  topic: el => go("topic", { tid: el.dataset.t, tab: "resumen" }),
  tab: el => { S.p = { tid: S.p.tid, tab: el.dataset.k }; render(); },
  backTopic: el => go("topic", { tid: S.p.tid, tab: el.dataset.k }),
  bf: el => { S.p.f = el.dataset.k; render(); },
  practiceTopic: el => { S.setup.tids = [el.dataset.t]; S.setup.mode = "practica"; saveSetup(); go("setup"); },
  quick: el => { const s = subjects().find(x => x.id === el.dataset.s); S.setup.tids = s ? s.topics.map(t => t.id) : []; S.setup.mode = el.dataset.m; saveSetup(); go("setup"); },
  set: el => { S.setup[el.dataset.f] = el.dataset.k; if (el.dataset.f === "mode") S.setup.min = null; saveSetup(); render(); },
  setSub: el => { S.setup.tids = toggleSubj(S.setup.tids, el.dataset.s); saveSetup(); render(); },
  setT: el => { const t = el.dataset.t, a = S.setup.tids; S.setup.tids = a.includes(t) ? a.filter(x => x !== t) : [...a, t]; saveSetup(); render(); },
  setD: el => { const k = el.dataset.k, a = S.setup.diffs; const n = a.includes(k) ? a.filter(x => x !== k) : [...a, k]; if (n.length) S.setup.diffs = n; saveSetup(); render(); },
  setN: el => { S.setup.n = +el.dataset.k; S.setup.min = null; saveSetup(); render(); },
  start: () => { const P = pool(); if (!P.length) return; const n = S.setup.n === 0 ? P.length : Math.min(S.setup.n, P.length); if (S.setup.mode === "examen" && !S.setup.min) S.setup.min = n; S.run = buildRun(S.setup); go("run"); },
  leaveAsk: () => { S.p.leaveAsk = true; render(); window.scrollTo(0, 0); },
  leaveNo: () => { S.p.leaveAsk = false; render(); },
  leave: () => { stopTimer(); clearActiveRun(); S.run = null; if (history.state && history.state.view === "run") history.back(); else go("setup", {}, "replace"); },
  pick: el => {
    const r = S.run; const i = r.idx; const o = +el.dataset.o;
    if (r.mode === "examen") { r.answers[i] = r.answers[i] === o ? null : o; haptic(10); render(); return; }
    if (r.shown[i]) return; r.answers[i] = o; r.shown[i] = true; haptic(o === runQ(i)?.a ? 10 : [30, 40, 30]); render();
  },
  next: () => { S.run.idx = Math.min(S.run.items.length - 1, S.run.idx + 1); S.p.submitAsk = false; render(); window.scrollTo(0, 0); },
  prev: () => { S.run.idx = Math.max(0, S.run.idx - 1); render(); window.scrollTo(0, 0); },
  jump: el => { S.run.idx = +el.dataset.k; render(); window.scrollTo(0, 0); },
  flag: () => { const r = S.run; r.flags[r.idx] = !r.flags[r.idx]; render(); },
  submitAsk: () => { S.p.submitAsk = true; render(); },
  submitNo: () => { S.p.submitAsk = false; render(); },
  finish: () => finishRun(false),
  reload: () => location.reload(),
  retryWrong: () => { const R = S.lastResult; const items = R.rows.filter(x => !x.ok).map(x => ({ ...findQ(x.tid, x.qid), tid: x.tid })).filter(q => q.id); if (!items.length) return; S.run = buildRun({ ...S.setup, mode: "practica", n: 0, kind: "repetir" }, shuffle(items)); go("run", {}, "replace"); },
  gen: el => { const tid = el.dataset.t || topicList()[0]?.id; if (!tid) return; go("gen", { tid, n: 10 }); },
  genSet: el => { S.p[el.dataset.f] = +el.dataset.k; render(); },
  genRun: () => genRun(),
  genSave: () => genSave(),
  editq: el => go("editq", { tid: el.dataset.t, qid: el.dataset.q || null }),
  segPick: el => { el.parentElement.querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", b === el)); },
  delAsk: () => { S.p.del = true; keepForm(() => render()); },
  delNo: () => { S.p.del = false; keepForm(() => render()); },
  delQ: async () => { const tid = S.p.tid; const b = clone(bank(tid)); b.questions = b.questions.filter(q => q.id !== S.p.qid); S.banks[tid] = b; await writeBank(tid); toast("Pregunta eliminada"); go("topic", { tid, tab: "banco" }); },
  resReset: el => { delete S.res[el.dataset.t + ":" + el.dataset.i]; rerenderRes(el.dataset.t, +el.dataset.i); },
  mL: el => { const st = S.res[el.dataset.t + ":" + el.dataset.i]; st.sel = +el.dataset.j; st.miss = null; rerenderRes(el.dataset.t, +el.dataset.i); },
  mR: el => { const key = el.dataset.t + ":" + el.dataset.i; const st = S.res[key]; const j = +el.dataset.j; if (st.sel == null) return; if (st.sel === j) { st.done.push(j); st.sel = null; st.miss = null; } else { st.errors++; st.miss = j; } rerenderRes(el.dataset.t, +el.dataset.i); },
  cls: el => { const t = S.topics[el.dataset.t]; const i = +el.dataset.i; const r = t.resources[i]; const st = S.res[el.dataset.t + ":" + i]; const j = st.queue[st.pos]; const ok = r.items[j][1] === +el.dataset.k; if (ok) st.ok++; else st.wrong.push(j); st.last = { j, ok }; st.pos++; rerenderRes(el.dataset.t, i); },
  ordMv: el => { const st = S.res[el.dataset.t + ":" + el.dataset.i]; const p = +el.dataset.pos, d = +el.dataset.d; const o = st.order; [o[p], o[p + d]] = [o[p + d], o[p]]; st.checked = false; rerenderRes(el.dataset.t, +el.dataset.i); },
  ordCheck: el => { S.res[el.dataset.t + ":" + el.dataset.i].checked = true; rerenderRes(el.dataset.t, +el.dataset.i); }
};
function keepForm(fn) {
  const vals = {};
  document.querySelectorAll("form input, form textarea, form select").forEach(i => { if (i.id) vals[i.id] = i.type === "radio" ? i.checked : i.value; });
  const segK = $("#q_d [aria-pressed=true]")?.dataset.k; fn();
  for (const id in vals) { const i = document.getElementById(id); if (!i) continue; if (i.type === "radio") i.checked = vals[id]; else i.value = vals[id]; }
  if (segK) $("#q_d").querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", b.dataset.k === segK));
}
const C = {
  exmin: el => { const v = Math.max(1, Math.min(240, +el.value || 1)); S.setup.min = v; saveSetup(); },
  pen: el => { S.setup.penalty = el.checked; saveSetup(); },
  shuf: el => { S.setup.shuf = el.checked; saveSetup(); },
  vibra: el => { lsSet("vibra", el.checked); haptic(15); },
  genKeep: el => { S.p.result[+el.dataset.i].keep = el.checked; const btn = $('[data-act="genSave"]'); const n = S.p.result.filter(x => x.keep).length; if (btn) { btn.textContent = `Añadir ${n} al tema`; btn.disabled = !n; } },
};
document.addEventListener("click", e => { const el = e.target.closest("[data-act]"); if (!el || el.disabled) return; const fn = A[el.dataset.act]; if (fn) { e.preventDefault(); fn(el, e); } });
document.addEventListener("keydown", e => {
  if (S.view !== "run" || !S.run || e.target.closest("input,textarea,select") || e.metaKey || e.ctrlKey || e.altKey) return;
  const r = S.run, it = r.items[r.idx];
  const n = "1234abcd".indexOf(e.key.toLowerCase()) % 4;
  if (n >= 0 && it && n < it.order.length && !(r.mode === "practica" && r.shown[r.idx])) { const b = document.querySelector(`.opt[data-o="${it.order[n]}"]`); if (b) A.pick(b); }
  else if (e.key === "Enter" || e.key === "ArrowRight") step(1);
  else if (e.key === "ArrowLeft") step(-1);
});
// Pasar de pregunta con las flechas o deslizando el dedo: adelante en el examen o si ya está corregida; atrás, solo
// en el examen (en práctica no hay «Anterior»).
function step(d) {
  const r = S.run; if (!r || r.done) return false;
  if (d > 0 && (r.mode === "examen" || r.shown[r.idx]) && r.idx < r.items.length - 1) A.next();
  else if (d < 0 && r.mode === "examen" && r.idx > 0) A.prev();
  else return false;
  return true;
}
// Gesto en el test: hacia la izquierda, siguiente; hacia la derecha, anterior. Solo cuenta si es claramente horizontal
// (≥ 60 px y el doble que en vertical, para no confundirlo con el scroll), rápido y sin empezar en el borde de la
// pantalla, donde el móvil tiene su gesto «Atrás».
let touch0 = null;
document.addEventListener("touchstart", e => {
  const t = e.touches[0];
  touch0 = S.view === "run" && e.touches.length === 1 && t.clientX > 24 && t.clientX < innerWidth - 24 ? { x: t.clientX, y: t.clientY, at: Date.now() } : null;
}, { passive: true });
document.addEventListener("touchend", e => {
  const s = touch0; touch0 = null;
  if (!s || S.view !== "run" || Date.now() - s.at > 800) return;
  const t = e.changedTouches[0], dx = t.clientX - s.x, dy = t.clientY - s.y;
  if (Math.abs(dx) < 60 || Math.abs(dx) < 2 * Math.abs(dy) || !step(dx < 0 ? 1 : -1)) return;
  const el = $("#main .stack-lg"); if (el) el.classList.add(dx < 0 ? "in-l" : "in-r"); // entra desde el lado del gesto
}, { passive: true });
function swipeTip() {
  try { if (!matchMedia("(pointer: coarse)").matches || lsGet("tipSwipe")) return; } catch (_) { return; }
  lsSet("tipSwipe", 1); toast("Consejo: desliza el dedo hacia la izquierda para pasar de pregunta.", 4500);
}
document.addEventListener("change", e => { const el = e.target.closest("[data-chg]"); if (el && C[el.dataset.chg]) C[el.dataset.chg](el, e); });
document.addEventListener("focusin", e => { if (e.target.closest("form")) S.lock = true; });
document.addEventListener("submit", async e => {
  e.preventDefault(); const f = e.target;
  if (f.id === "fq") {
    const tid = f.dataset.t; const opts = [0, 1, 2, 3].map(i => $("#q_o" + i).value.trim()); const ai = +(f.querySelector("input[name=q_a]:checked")?.value ?? 0);
    const kept = opts.map((o, i) => ({ o, i })).filter(x => x.o); const q = $("#q_q").value.trim();
    if (!q || kept.length < 2) return toast("Escribe el enunciado y al menos dos respuestas.");
    if (!kept.some(x => x.i === ai)) return toast("Marca como correcta una respuesta con texto.");
    const diff = $("#q_d [aria-pressed=true]")?.dataset.k || "media";
    const b = clone(bank(tid)); const old = S.p.qid ? b.questions.find(x => x.id === S.p.qid) : null;
    const nq = { id: old ? old.id : rid(), q, opts: kept.map(x => x.o), a: kept.findIndex(x => x.i === ai), exp: $("#q_e").value.trim(), diff, origin: old ? old.origin : "propia", ...(old && old.src ? { src: old.src } : {}) };
    if (old) b.questions[b.questions.indexOf(old)] = nq; else b.questions.push(nq);
    S.banks[tid] = b; if (await writeBank(tid)) { toast("Pregunta guardada"); go("topic", { tid, tab: "banco" }); }
  }
});

/* ----- estadísticas ----- */
const KIND = { fallos: "Repaso de fallos", repetir: "Repetir no acertadas" };
const fmtDay = d => new Date(d).toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit" });
const fmtWhen = d => new Date(d).toLocaleString("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const pctTxt = (c, n) => n ? Math.round(c / n * 100) + " %" : "–";
VIEWS.stats = () => {
  if (contentLoading()) return loadingView();
  const all = S.history || [], tests = all.filter(h => (h.kind || "test") === "test"), reps = all.length - tests.length;
  const head = `<div class="stack"><p class="eyebrow">Tu progreso</p><h1>Estadísticas</h1></div>`;
  if (!all.length) return `<div class="stack-lg">${head}<p class="empty">Aún no has terminado ningún test. Cuando termines uno, aquí verás tu nota media, cómo evolucionas y en qué temas fallas más.</p><div><button class="btn" data-act="nav" data-v="setup">Hacer un test</button></div></div>`;
  const avg = tests.length ? tests.reduce((a, h) => a + h.nota, 0) / tests.length : null;
  const nq = tests.reduce((a, h) => a + h.total, 0), nok = tests.reduce((a, h) => a + h.aciertos, 0);
  const last = tests.slice(-10);
  const chart = last.length ? `<section class="stack"><h2>Evolución</h2><figure class="chart-fig">
      <div class="chart" role="img" aria-label="${esc("Últimas notas: " + last.map(h => fmtNum(h.nota)).join(", "))}">${last.map(h => `<div class="col"><span class="v">${fmtNum(h.nota)}</span><i class="${h.nota >= 5 ? "ok" : "bad"}" style="height:${Math.max(2, h.nota * 10)}%"></i></div>`).join("")}<span class="pass" aria-hidden="true"></span></div>
      <div class="chart-x" aria-hidden="true">${last.map(h => `<span>${fmtDay(h.date)}</span>`).join("")}</div>
      <figcaption class="small muted">${last.length === 1 ? "Tu última nota" : `Tus últimas ${last.length} notas`}, sobre 10. La línea marca el 5.</figcaption></figure></section>` : "";
  // aciertos por asignatura y tema (solo tests normales)
  const byT = {};
  for (const h of tests) for (const [tid, v] of Object.entries(h.porTema || {})) { const x = byT[tid] || (byT[tid] = [0, 0]); x[0] += v[0]; x[1] += v[1]; }
  const subj = subjects().map(s => {
    const ts = s.topics.filter(t => byT[t.id]).map(t => ({ t, c: byT[t.id][0], n: byT[t.id][1] })).sort((a, b) => a.c / a.n - b.c / b.n);
    return { s, ts, c: ts.reduce((a, x) => a + x.c, 0), n: ts.reduce((a, x) => a + x.n, 0) };
  }).filter(x => x.n).sort((a, b) => a.c / a.n - b.c / b.n);
  const subjHTML = subj.length ? `<section class="stack"><h2>Aciertos por asignatura</h2><p class="small muted">De menos a más acertada, con sus temas. Así ves dónde flojeas.</p><div class="list">${subj.map(x => `<div class="item"><div class="grow stack" style="gap:8px">
      <div class="spread"><span class="item-title">${esc(x.s.short)}</span><span class="mono">${pctTxt(x.c, x.n)}</span></div>
      <div class="bar"><i style="width:${Math.round(x.c / x.n * 100)}%"></i></div>
      <span class="small muted">${x.c} de ${x.n} preguntas acertadas</span>
      <div class="trows">${x.ts.map((y, i) => `<div class="trow"><span class="ref accent">${esc(y.t.code || "T")}</span><span class="grow small">${esc(y.t.title)}${i === 0 && x.ts.length > 1 ? ` <span class="badge check">Más flojo</span>` : ""}</span><span class="mono small">${pctTxt(y.c, y.n)}</span></div>`).join("")}</div>
    </div></div>`).join("")}</div></section>` : "";
  const recent = `<section class="stack"><h2>Últimos tests</h2><div class="list">${all.slice(-10).reverse().map(h => `<div class="item"><span class="ref" style="background:${h.nota >= 5 ? "var(--ok-soft)" : "var(--bad-soft)"};color:${h.nota >= 5 ? "var(--ok)" : "var(--bad)"}">${fmtNum(h.nota)}</span><div class="grow stack" style="gap:2px"><span class="item-title">${h.mode === "examen" ? "Examen" : "Práctica"}${KIND[h.kind] ? " · " + KIND[h.kind] : ""}</span><span class="small muted">${esc(fmtWhen(h.date))} · ${h.aciertos} de ${h.total} acertadas${h.mode === "examen" ? " · " + fmtTime(h.sec) : ""}</span></div></div>`).join("")}</div></section>`;
  return `<div class="stack-lg">${head}
    <div class="stats"><div class="stat"><b>${tests.length}</b><span>${tests.length === 1 ? "test" : "tests"}${reps ? ` · ${reps} ${reps === 1 ? "repaso" : "repasos"}` : ""}</span></div><div class="stat"><b>${avg == null ? "–" : fmtNum(avg)}</b><span>nota media</span></div><div class="stat"><b>${pctTxt(nok, nq)}</b><span>aciertos</span></div></div>
    ${tests.length ? "" : `<p class="small muted">Las medias solo cuentan los tests normales; de momento solo has hecho repasos.</p>`}
    ${chart}${subjHTML}${recent}
  </div>`;
};

/* ----- settings ----- */
VIEWS.settings = () => {
  return `<div class="stack-lg">
    <div class="stack"><p class="eyebrow">Configuración</p><h1>Ajustes</h1></div>
    ${canVibrate ? `<section class="stack"><h2>Vibración</h2><label class="toggle" for="vib"><span><b>Vibrar al responder</b><br><span class="small muted">Un toque al elegir, uno doble si fallas en práctica y otro al entregar el examen</span></span><input type="checkbox" id="vib" ${lsGet("vibra") === false ? "" : "checked"} data-chg="vibra"></label></section>` : ""}
    <section class="stack"><h2>Almacenamiento</h2>
      <p class="muted">${S.persisted === true ? "Protegido: el navegador no borrará tus datos aunque le falte espacio." : S.persisted === false ? "Sin proteger: si el móvil se queda sin espacio, el navegador podría borrar lo que guardas aquí. Instalar la app en la pantalla de inicio suele protegerlo; mientras, haz copias de vez en cuando." : "Este navegador no indica si protege tus datos. Haz copias de vez en cuando."}</p>
    </section>
    <section class="stack"><h2>Cuaderno de fallos</h2>
      <p class="muted">${(n => n ? `${n} ${n === 1 ? "pregunta pendiente" : "preguntas pendientes"}. Salen del cuaderno cuando las aciertas dos veces seguidas.` : "No tienes fallos pendientes.")(errItems().length)}</p>
      ${errItems().length ? (S.p.clrErr ? `<div class="callout warn confirm"><span class="grow">¿Vaciar el cuaderno de fallos?</span><button class="btn danger sm" data-act="clrErr">Vaciar</button><button class="btn quiet sm" data-act="clrErrNo">Cancelar</button></div>` : `<div class="row"><button class="btn ghost" data-act="clrErrAsk">Vaciar cuaderno</button></div>`) : ""}
    </section>
    <section class="stack"><h2>Historial de tests</h2>
      <p class="muted">${(n => n ? `${n} ${n === 1 ? "test guardado" : "tests guardados"} para las estadísticas.` : "Aún no hay tests guardados.")((S.history || []).length)}</p>
      ${(S.history || []).length ? (S.p.clrHist ? `<div class="callout warn confirm"><span class="grow">¿Borrar el historial y las estadísticas?</span><button class="btn danger sm" data-act="clrHist">Borrar</button><button class="btn quiet sm" data-act="clrHistNo">Cancelar</button></div>` : `<div class="row"><button class="btn ghost" data-act="clrHistAsk">Borrar historial</button></div>`) : ""}
    </section>
    <section class="stack"><h2>Copia de seguridad</h2>
      <p class="muted">Las preguntas que generes o añadas se guardan solo en este dispositivo. Descarga una copia para pasarlas a otro o para recuperarlas.</p>
      <div class="row"><button class="btn ghost" data-act="exportAll">Descargar copia</button><button class="btn ghost" data-act="importAsk">Restaurar copia</button></div>
      <input type="file" id="impFile" accept=".json,application/json" hidden data-chg="impFile">
    </section>
  </div>`;
};
Object.assign(A, {
  importAsk: () => $("#impFile")?.click(),
  exportAll: () => {
    const blob = new Blob([JSON.stringify(Store.exportAll(), null, 1)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `estudio-prl-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
});
Object.assign(C, {
  impFile: async el => { const f = el.files[0]; el.value = ""; if (!f) return; try { await Store.importAll(JSON.parse(await f.text())); await Promise.all([loadErrors(), loadHistory()]); toast("Copia restaurada"); go("home"); } catch (e) { toast("Ese archivo no es una copia válida."); } }
});

boot();
