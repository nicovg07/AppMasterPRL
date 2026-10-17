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
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, 2600); }

const ICON = {
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/></svg>',
  test: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="m8 9 1.5 1.5L12 8M8 15.5l1.5 1.5L12 14.5M14.5 9.5H17M14.5 16H17"/></svg>',
  sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.5 14.5A8.5 8.5 0 1 1 9.5 3.5a7 7 0 0 0 11 11z"/></svg>',
  book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 6.5C10.5 5 8 4.5 4 4.5v14c4 0 6.5.5 8 2 1.5-1.5 4-2 8-2v-14c-4 0-6.5.5-8 2zM12 6.5v14"/></svg>',
  tri: '<svg class="tri" viewBox="0 0 18 16" aria-hidden="true"><path d="M9 1 17 15H1z" fill="none" stroke="var(--warn)" stroke-width="1.6" stroke-linejoin="round"/><path d="M9 6v4" stroke="var(--warn)" stroke-width="1.6" stroke-linecap="round"/><circle cx="9" cy="12.4" r=".9" fill="var(--warn)"/></svg>'
};

/* ---------- state ---------- */
// No hay progreso guardado: el test en curso y su resultado viven solo mientras la página está abierta.
const S = {
  view: "home", p: {}, mode: "loading",
  topics: {}, banks: {}, subjects: {}, ready: { t: false, b: false, s: false },
  db: null,
  setup: Object.assign({ tids: [], diffs: ["facil", "media", "dificil"], origin: "todas", n: 10, mode: "practica", min: null, shuf: true, penalty: false }, lsGet("setup") || {}),
  run: null, res: {}, lock: false, busy: null
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

function onDbErr(e) { console.warn("db", e); if (e && e.code === "revoked") { S.mode = "nodb"; render(); } }

async function boot() {
  paintTheme();
  render();
  const db = await Store.init();
  S.db = db; S.mode = "ok";
  db.collection("topics").onSnapshot(snap => { const t = {}; for (const d of snap.docs) if (d.exists) t[d.id] = { id: d.id, ...d.data() }; S.topics = t; S.ready.t = true; refresh(); }, onDbErr);
  db.collection("subjects").onSnapshot(snap => { const s = {}; for (const d of snap.docs) if (d.exists) s[d.id] = { id: d.id, ...d.data() }; S.subjects = s; S.ready.s = true; refresh(); }, onDbErr);
  db.collection("banks").onSnapshot(snap => { const b = {}; for (const d of snap.docs) if (d.exists) { const x = d.data(); b[d.id] = { ...(x.rev ? { rev: x.rev } : {}), questions: x.questions || [] }; } S.banks = b; S.ready.b = true; refresh(); }, onDbErr);
}

/* ---------- rendering ---------- */
const LIVE = ["home", "subject", "topic", "setup"];
function refresh(force) { if (S.lock && !force) return; if (LIVE.includes(S.view) || force) render(); }
function go(view, p = {}) { if (S.view === "run" && view !== "run") stopTimer(); S.view = view; S.p = p; S.lock = false; render(); window.scrollTo(0, 0); }
function render() {
  const v = VIEWS[S.view] || VIEWS.home;
  $("#main").innerHTML = S.mode === "loading" ? loadingView() : S.mode === "nodb" ? noDbView() : v();
  renderNav();
  if (S.view === "run" && S.run && S.run.mode === "examen" && !S.run.done) startTimer();
  const gear = $("#gear"); if (gear) gear.setAttribute("aria-current", S.view === "settings" ? "page" : "false");
}
function renderNav() {
  const tab = { settings: "", setup: "setup", run: "setup", result: "setup" }[S.view] ?? "home";
  const it = [["home", "Inicio", ICON.home], ["setup", "Test", ICON.test]];
  $("#nav").innerHTML = it.map(([v, l, i]) => `<button data-act="nav" data-v="${v}" ${tab === v ? 'aria-current="page"' : ""}>${i}<span>${l}</span></button>`).join("");
}
function loadingView() { return `<div class="stack"><div class="skel" style="width:40%"></div><div class="skel" style="width:70%;height:30px"></div><div class="skel" style="width:90%"></div><div class="skel" style="width:60%"></div></div>`; }
function noDbView() { return `<div class="stack"><h1>No se pudieron cargar tus datos</h1><p class="muted">Recarga la página. Si sigue sin funcionar, revisa que el navegador permita guardar datos de este sitio.</p></div>`; }
function contentLoading() { return !(S.ready.t && S.ready.b && S.ready.s); }

const VIEWS = {};

/* ----- home: una tarjeta por asignatura ----- */
VIEWS.home = () => {
  if (contentLoading()) return loadingView();
  const all = subjects();
  if (!all.length) return `<div class="stack-lg"><div class="stack"><p class="eyebrow">Máster PRL · Nebrija</p><h1>Aún no hay temas</h1></div></div>`;
  return `<div class="stack-lg"><img class="hero" src="img/portada.webp" alt="Máster en PRL · Prevención de Riesgos Laborales" width="1024" height="572">
    <div class="stack" style="gap:4px"><p class="eyebrow">Universidad Nebrija</p><h1>Asignaturas</h1></div>
    <div class="subjects">${all.map((s, i) => `<button class="subj ${s.topics.length ? "" : "void"}" data-act="subject" data-s="${esc(s.id)}"><span class="eyebrow">Asignatura ${i + 1}</span><span class="subj-name">${esc(s.short)}</span><span class="small muted">${s.topics.length ? `${s.topics.length} ${s.topics.length === 1 ? "tema" : "temas"} · ${nQuestions(s)} preguntas` : "Sin temas todavía"}</span></button>`).join("")}</div>
  </div>`;
};

/* ----- subject ----- */
VIEWS.subject = () => {
  if (contentLoading()) return loadingView();
  const all = subjects(); const i = all.findIndex(s => s.id === S.p.sid); const s = all[i];
  if (!s) return `<p class="empty">Esta asignatura ya no existe.</p>`;
  return `<div class="stack-lg"><div class="stack"><button class="back" data-act="go" data-v="home">← Asignaturas</button>
    <div class="stack" style="gap:4px"><p class="eyebrow">Asignatura ${i + 1}</p><h1>${esc(s.short)}</h1>${s.name !== s.short ? `<p class="small muted">${esc(s.name)}</p>` : ""}</div></div>
    ${s.topics.length ? `<div class="row" style="display:grid;grid-template-columns:1fr 1fr;gap:10px"><button class="btn" data-act="quick" data-m="practica" data-s="${esc(s.id)}">Practicar</button><button class="btn ghost" data-act="quick" data-m="examen" data-s="${esc(s.id)}">Simular examen</button></div>
    <section class="stack"><h2>Temas</h2><div class="list">${s.topics.map(topicRow).join("")}</div></section>`
    : `<p class="empty">Aún no hay temas de esta asignatura.</p>`}
  </div>`;
};
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
  return `<div class="stack-lg">
    <div class="stack"><p class="eyebrow">Nuevo test</p><h1>${c.mode === "examen" ? "Simular examen" : "Practicar"}</h1></div>
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
    mode: cfg.mode, startedAt: Date.now(), penalty: !!cfg.penalty, idx: 0, done: false,
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
    ${S.p.leaveAsk ? `<div class="callout warn confirm" style="margin-bottom:16px"><span class="grow">¿Salir del test? No se guarda.</span><button class="btn danger sm" data-act="leave">Salir</button><button class="btn quiet sm" data-act="leaveNo">Seguir</button></div>` : ""}`;
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
  let c = 0, w = 0, b = 0, score = 0;
  const rows = r.items.map((it, i) => {
    const q = findQ(it.tid, it.qid); if (!q) return null;
    const a = r.answers[i]; const ok = a === q.a;
    if (a == null) b++; else if (ok) { c++; score += 1; } else { w++; if (r.penalty) score -= 1 / Math.max(1, q.opts.length - 1); }
    return { tid: it.tid, qid: it.qid, order: it.order, a, ok };
  }).filter(Boolean);
  const nota = Math.max(0, score / (rows.length || 1) * 10);
  const sec = Math.min((Date.now() - r.startedAt) / 1000, r.limitSec || Infinity);
  S.lastResult = { mode: r.mode, rows, c, w, b, nota, sec, timeUp: !!timeUp, penalty: r.penalty };
  go("result");
}
VIEWS.result = () => {
  const R = S.lastResult; if (!R) return `<p class="empty">No hay resultados.</p>`;
  const wrong = R.rows.filter(x => !x.ok);
  return `<div class="stack-lg">
    <div class="stack"><p class="eyebrow">${R.mode === "examen" ? "Examen entregado" : "Práctica terminada"}${R.timeUp ? " · tiempo agotado" : ""}</p>
    <div class="row" style="align-items:baseline;gap:12px"><span class="score">${fmtNum(R.nota)}</span><span class="muted">sobre 10</span></div></div>
    <div class="stats"><div class="stat"><b style="color:var(--ok)">${R.c}</b><span>aciertos</span></div><div class="stat"><b style="color:var(--bad)">${R.w}</b><span>fallos${R.penalty ? " (restan)" : ""}</span></div><div class="stat"><b>${R.mode === "examen" ? fmtTime(R.sec) : R.b}</b><span>${R.mode === "examen" ? "tiempo" : "en blanco"}</span></div></div>
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
  theme: () => { const t = isDark() ? "light" : "dark"; document.documentElement.dataset.theme = t; lsSet("theme", t); paintTheme(); },
  go: el => go(el.dataset.v),
  nav: el => { const v = el.dataset.v; if (v === "setup" && S.run && !S.run.done) return go("run"); go(v); },
  subject: el => go("subject", { sid: el.dataset.s }),
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
  leave: () => { stopTimer(); S.run = null; go("setup"); },
  pick: el => {
    const r = S.run; const i = r.idx; const o = +el.dataset.o;
    if (r.mode === "examen") { r.answers[i] = r.answers[i] === o ? null : o; render(); return; }
    if (r.shown[i]) return; r.answers[i] = o; r.shown[i] = true; render();
  },
  next: () => { S.run.idx = Math.min(S.run.items.length - 1, S.run.idx + 1); S.p.submitAsk = false; render(); window.scrollTo(0, 0); },
  prev: () => { S.run.idx = Math.max(0, S.run.idx - 1); render(); window.scrollTo(0, 0); },
  jump: el => { S.run.idx = +el.dataset.k; render(); window.scrollTo(0, 0); },
  flag: () => { const r = S.run; r.flags[r.idx] = !r.flags[r.idx]; render(); },
  submitAsk: () => { S.p.submitAsk = true; render(); },
  submitNo: () => { S.p.submitAsk = false; render(); },
  finish: () => finishRun(false),
  retryWrong: () => { const R = S.lastResult; const items = R.rows.filter(x => !x.ok).map(x => ({ ...findQ(x.tid, x.qid), tid: x.tid })).filter(q => q.id); if (!items.length) return; S.run = buildRun({ ...S.setup, mode: "practica", n: 0 }, shuffle(items)); go("run"); },
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
  const vals = {}, files = {};
  document.querySelectorAll("form input, form textarea, form select").forEach(i => { if (!i.id) return; if (i.type === "file") files[i.id] = i.files; else vals[i.id] = i.type === "radio" ? i.checked : i.value; });
  const segK = $("#q_d [aria-pressed=true]")?.dataset.k; fn();
  for (const id in vals) { const i = document.getElementById(id); if (!i) continue; if (i.type === "radio") i.checked = vals[id]; else i.value = vals[id]; }
  for (const id in files) { const i = document.getElementById(id); if (i && files[id] && files[id].length) i.files = files[id]; }
  if (segK) $("#q_d").querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", b.dataset.k === segK));
}
const C = {
  exmin: el => { const v = Math.max(1, Math.min(240, +el.value || 1)); S.setup.min = v; saveSetup(); },
  pen: el => { S.setup.penalty = el.checked; saveSetup(); },
  shuf: el => { S.setup.shuf = el.checked; saveSetup(); },
  genKeep: el => { S.p.result[+el.dataset.i].keep = el.checked; const btn = $('[data-act="genSave"]'); const n = S.p.result.filter(x => x.keep).length; if (btn) { btn.textContent = `Añadir ${n} al tema`; btn.disabled = !n; } },
};
document.addEventListener("click", e => { const el = e.target.closest("[data-act]"); if (!el || el.disabled) return; const fn = A[el.dataset.act]; if (fn) { e.preventDefault(); fn(el, e); } });
document.addEventListener("keydown", e => {
  if (S.view !== "run" || !S.run || e.target.closest("input,textarea,select") || e.metaKey || e.ctrlKey || e.altKey) return;
  const r = S.run, it = r.items[r.idx];
  const n = "1234abcd".indexOf(e.key.toLowerCase()) % 4;
  if (n >= 0 && it && n < it.order.length && !(r.mode === "practica" && r.shown[r.idx])) { const b = document.querySelector(`.opt[data-o="${it.order[n]}"]`); if (b) A.pick(b); }
  else if ((e.key === "Enter" || e.key === "ArrowRight") && (r.mode === "examen" || r.shown[r.idx]) && r.idx < r.items.length - 1) A.next();
  else if (e.key === "ArrowLeft" && r.mode === "examen" && r.idx > 0) A.prev();
});
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

/* ----- settings ----- */
VIEWS.settings = () => {
  return `<div class="stack-lg">
    <div class="stack"><p class="eyebrow">Configuración</p><h1>Ajustes</h1></div>
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
  impFile: async el => { const f = el.files[0]; el.value = ""; if (!f) return; try { await Store.importAll(JSON.parse(await f.text())); toast("Copia restaurada"); go("home"); } catch (e) { toast("Ese archivo no es una copia válida."); } }
});

boot();
