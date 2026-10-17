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
const ORIGIN = { oficial: "Autoevaluación", claude: "Generada", propia: "Tuya" };
const LET = "ABCDEFGH";
const fmtNum = n => String(Math.round(n * 10) / 10).replace(".", ",");
const pct = (a, b) => b ? Math.round(a / b * 100) : 0;
function fmtTime(sec) { sec = Math.max(0, Math.round(sec)); const m = Math.floor(sec / 60), s = sec % 60; return `${m}:${String(s).padStart(2, "0")}`; }
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, 2600); }

const ICON = {
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/></svg>',
  test: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="m8 9 1.5 1.5L12 8M8 15.5l1.5 1.5L12 14.5M14.5 9.5H17M14.5 16H17"/></svg>',
  tri: '<svg class="tri" viewBox="0 0 18 16" aria-hidden="true"><path d="M9 1 17 15H1z" fill="none" stroke="var(--warn)" stroke-width="1.6" stroke-linejoin="round"/><path d="M9 6v4" stroke="var(--warn)" stroke-width="1.6" stroke-linecap="round"/><circle cx="9" cy="12.4" r=".9" fill="var(--warn)"/></svg>'
};

/* ---------- state ---------- */
// No hay progreso guardado: el test en curso y su resultado viven solo mientras la página está abierta.
const S = {
  view: "home", p: {}, mode: "loading",
  topics: {}, banks: {}, subjects: {}, ready: { t: false, b: false, s: false },
  db: null, sample: null,
  setup: Object.assign({ tids: [], diffs: ["facil", "media", "dificil"], origin: "todas", n: 10, mode: "practica", min: null, shuf: true, penalty: false }, lsGet("setup") || {}),
  run: null, res: {}, lock: false, busy: null
};

/* ---------- data access ---------- */
const subjOrder = sid => S.subjects[sid]?.order ?? 999;
const topicList = () => Object.values(S.topics).sort((a, b) => subjOrder(a.subject) - subjOrder(b.subject) || (a.subject || "").localeCompare(b.subject || "") || (a.order || 0) - (b.order || 0) || (a.createdAt || 0) - (b.createdAt || 0));
const bank = tid => S.banks[tid] || { questions: [] };
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

function onDbErr(e) { console.warn("db", e); if (e && e.code === "revoked") { S.mode = "nodb"; render(); } }

async function boot() {
  render();
  const db = await Store.init();
  S.sample = AI.sample;
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
const canAI = () => !!window.AI;

const VIEWS = {};

/* ----- home: una tarjeta por asignatura ----- */
VIEWS.home = () => {
  if (contentLoading()) return loadingView();
  const all = subjects();
  if (!all.length) return `<div class="stack-lg"><div class="stack"><p class="eyebrow">Máster PRL · Nebrija</p><h1>Empieza por tu primer tema</h1><p class="muted">Sube los apuntes y la autoevaluación de un tema y Claude prepara el resumen, los recursos y el banco de preguntas.</p></div><button class="btn" data-act="go" data-v="newtopic">Añadir tema</button></div>`;
  return `<div class="stack-lg"><div class="stack"><p class="eyebrow">Máster PRL · Nebrija</p><h1>Asignaturas</h1></div>
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
    <section class="stack"><div class="spread"><h2>Temas</h2><button class="btn quiet sm" data-act="newTopicFor" data-s="${esc(s.id)}">Añadir tema</button></div><div class="list">${s.topics.map(topicRow).join("")}</div></section>`
    : `<p class="empty">Aún no hay temas de esta asignatura.</p><div><button class="btn" data-act="newTopicFor" data-s="${esc(s.id)}">Añadir tema</button></div>`}
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
    <div class="row"><button class="btn sm" data-act="editq" data-t="${t.id}">Nueva pregunta</button>${canAI() ? `<button class="btn ghost sm" data-act="gen" data-t="${t.id}">Generar con Claude</button><button class="btn ghost sm" data-act="importAuto" data-t="${t.id}">Importar autoevaluación</button>` : ""}</div>
    <input type="file" id="autoFile" accept=".pdf,.txt" hidden data-chg="autoFile" data-t="${t.id}">
    <div class="chips">${[["todas", `Todas · ${qs.length}`], ["oficial", `Autoevaluación · ${counts.oficial}`], ["facil", "Fácil"], ["media", "Media"], ["dificil", "Difícil"]].map(([k, l]) => `<button class="chip" aria-pressed="${f === k}" data-act="bf" data-k="${k}">${l}</button>`).join("")}</div>
    ${S.busy && S.busy.kind === "auto" ? `<div class="callout accent small">${esc(S.busy.msg)}</div>` : ""}
    <div class="list">${list.map(q => `<button class="item" data-act="editq" data-t="${t.id}" data-q="${q.id}"><div class="grow stack" style="gap:6px"><span>${esc(q.q)}</span><span class="row" style="gap:6px"><span class="badge ${q.origin === "oficial" ? "oficial" : ""}">${ORIGIN[q.origin] || "Tuya"}</span><span class="badge">${DIFF[q.diff] || "Media"}</span>${q.check ? `<span class="badge check">Revisar respuesta</span>` : ""}</span></div></button>`).join("") || `<p class="empty">No hay preguntas con este filtro.</p>`}</div>
    ${S.p.delTopic ? `<div class="callout bad confirm"><span class="grow">¿Eliminar «${esc(t.title)}» con sus preguntas?</span><button class="btn danger sm" data-act="delTopic" data-t="${t.id}">Eliminar</button><button class="btn quiet sm" data-act="delTopicNo">Cancelar</button></div>` : `<div><button class="btn quiet sm" style="color:var(--bad)" data-act="delTopicAsk">Eliminar tema</button></div>`}
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
    ${q && q.check ? `<div class="callout warn small">Claude no encontró marcada la respuesta correcta en la autoevaluación y la dedujo de los apuntes. Compruébala y guarda.</div>` : ""}
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
    ${P.length < 15 && canAI() && topicList().length ? `<p class="small muted">Solo hay ${P.length} preguntas con estos filtros. <button class="link" data-act="gen" data-t="${c.tids[0] || topicList()[0].id}">Genera más con Claude</button></p>` : ""}</div>
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
    after = `<div class="callout ${ok ? "ok" : "bad"} stack" style="gap:6px"><b>${ok ? "Correcto" : "Incorrecto · la buena es la " + LET[it.order.indexOf(q.a)]}</b>${q.exp ? `<p class="explain">${esc(q.exp)}</p>` : ""}</div>
    ${canAI() ? `<div class="stack" id="whyBox">${S.p.why === i ? "" : `<button class="btn ghost sm" style="align-self:flex-start" data-act="why">${ok ? "Profundiza con Claude" : "¿Por qué fallé? Pregunta a Claude"}</button>`}<div class="ai" id="whyOut"></div></div>` : ""}
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
    <section class="stack"><h2>Repaso</h2><div class="list">${R.rows.map((x, k) => { const q = findQ(x.tid, x.qid); if (!q) return ""; const mine = x.a == null ? "Sin responder" : `${LET[x.order.indexOf(x.a)]}. ${esc(q.opts[x.a])}`; return `<div class="item"><span class="ref" style="background:${x.ok ? "var(--ok-soft)" : "var(--bad-soft)"};color:${x.ok ? "var(--ok)" : "var(--bad)"}">${k + 1}</span><div class="grow stack" style="gap:6px"><span class="item-title">${esc(q.q)}</span>${x.ok ? `<span class="small" style="color:var(--ok)">${LET[x.order.indexOf(q.a)]}. ${esc(q.opts[q.a])}</span>` : `<span class="small" style="color:var(--bad)">Tu respuesta: ${mine}</span><span class="small" style="color:var(--ok)">Correcta: ${LET[x.order.indexOf(q.a)]}. ${esc(q.opts[q.a])}</span>`}${!x.ok && q.exp ? `<span class="small muted">${esc(q.exp)}</span>` : ""}</div></div>`; }).join("")}</div></section>
  </div>`;
};

/* ----- generate with Claude ----- */
VIEWS.gen = () => {
  const t = S.topics[S.p.tid]; if (!t) return `<p class="empty">Elige un tema para generar.</p>`;
  const g = S.p; const res = g.result || [];
  return `<div class="stack-lg"><div class="stack"><button class="back" data-act="backTopic" data-k="banco">← ${esc(t.code)} · Preguntas</button><h1>Generar preguntas</h1><p class="muted">Claude las crea a partir de los apuntes de «${esc(t.title)}» y evita repetir las que ya tienes.</p></div>
    <div class="field"><span class="label">Dificultad</span><div class="seg">${[...Object.entries(DIFF), ["mix", "Mezcla"]].map(([k, l]) => `<button aria-pressed="${(g.diff || "media") === k}" data-act="genSet" data-f="diff" data-k="${k}">${l}</button>`).join("")}</div></div>
    <div class="field"><span class="label">Cuántas</span><div class="seg">${[5, 10, 15].map(k => `<button aria-pressed="${(g.n || 10) === k}" data-act="genSet" data-f="n" data-k="${k}">${k}</button>`).join("")}</div></div>
    <div class="field"><label for="gfocus">Enfoque (opcional)</label><input class="input" id="gfocus" value="${esc(g.focus || "")}" placeholder="Convenios de la OIT, fechas, órganos…"></div>
    <div class="row">${g.running ? `<button class="btn ghost" data-act="genStop">Detener</button><span class="small muted">${esc(g.status || "Claude está escribiendo…")}</span>` : `<button class="btn" data-act="genRun">${res.length ? "Generar otras" : "Generar"}</button>`}</div>
    ${g.error ? `<div class="callout bad small">${esc(g.error)}</div>` : ""}
    ${res.length ? `<section class="stack"><div class="spread"><h2>${res.length} ${res.length === 1 ? "pregunta nueva" : "preguntas nuevas"}</h2><span class="small muted">Desmarca las que no quieras</span></div>
      <div>${res.map((x, i) => `<label class="gen-q" for="gk${i}"><input type="checkbox" id="gk${i}" ${x.keep ? "checked" : ""} data-chg="genKeep" data-i="${i}"><span class="stack" style="gap:6px"><b>${esc(x.q)}</b><span class="small">${x.opts.map((o, k) => `<span style="${k === x.a ? "color:var(--ok);font-weight:600" : "color:var(--muted)"}">${LET[k]}. ${esc(o)}</span>`).join("<br>")}</span><span class="small muted">${esc(x.exp)}</span><span><span class="badge">${DIFF[x.diff]}</span></span></span></label>`).join("")}</div>
      <button class="btn block" data-act="genSave" ${res.some(x => x.keep) ? "" : "disabled"}>Añadir ${res.filter(x => x.keep).length} al tema</button></section>` : ""}
  </div>`;
};

/* ----- new topic ----- */
VIEWS.newtopic = () => {
  const p = S.p; const sb = subjects();
  const steps = p.steps; const sid0 = sb.find(s => s.id === p.sid)?.id || sb[0]?.id || "__new";
  return `<form class="stack-lg" id="fnt"><div class="stack">${p.sid ? `<button type="button" class="back" data-act="subject" data-s="${esc(p.sid)}">← ${esc(sb.find(s => s.id === p.sid)?.short || "Asignatura")}</button>` : `<button type="button" class="back" data-act="go" data-v="home">← Asignaturas</button>`}<h1>Añadir tema</h1><p class="muted">Sube los apuntes y, si la tienes, la autoevaluación. Claude prepara el resumen, los recursos interactivos y el banco de preguntas.</p></div>
    ${!AI.hasKey() ? `<div class="callout warn small">Para crear temas desde aquí, añade tu clave de la API de Claude en <button type="button" class="link" data-act="go" data-v="settings">Ajustes</button>.</div>` : ""}
    <div class="field"><label for="nt_s">Asignatura</label><select class="input" id="nt_s">${sb.map((s, i) => `<option value="${esc(s.id)}" ${s.id === sid0 ? "selected" : ""}>${i + 1}. ${esc(s.short)}</option>`).join("")}<option value="__new">Otra asignatura…</option></select></div>
    <div class="field" id="nt_sn_w" ${sb.length ? "hidden" : ""}><label for="nt_sn">Nombre de la nueva asignatura</label><input class="input" id="nt_sn" placeholder="Seguridad en el trabajo"></div>
    <div class="row" style="display:grid;grid-template-columns:110px minmax(0,1fr);gap:10px"><div class="field"><label for="nt_c">Código</label><input class="input" id="nt_c" value="${esc(p.code || nextCode(sid0))}" data-auto="1"></div><div class="field"><label for="nt_t">Título (opcional)</label><input class="input" id="nt_t" placeholder="Lo propone Claude si lo dejas vacío"></div></div>
    <div class="field"><label for="nt_f">Apuntes (PDF o texto)</label><input class="input" type="file" id="nt_f" accept=".pdf,.txt,.md"><span class="small muted">O pega el texto:</span><textarea class="input" id="nt_x" placeholder="Pega aquí el contenido del tema"></textarea></div>
    <div class="field"><label for="nt_a">Autoevaluación (opcional)</label><input class="input" type="file" id="nt_a" accept=".pdf,.txt"></div>
    ${steps ? `<ul class="steps">${steps.map(s => `<li class="${s.st || ""}"><span class="dot"></span><span>${esc(s.l)}</span></li>`).join("")}</ul>` : ""}
    ${p.error ? `<div class="callout bad small">${esc(p.error)}</div>` : ""}
    <button class="btn" type="submit" ${p.running || !AI.hasKey() ? "disabled" : ""}>${p.running ? "Creando el tema…" : "Crear tema"}</button>
  </form>`;
};
function nextCode(sid) { const n = topicList().filter(t => t.subject === sid && /^T\d+$/.test(t.code || "")).map(t => +t.code.slice(1)); return "T" + ((n.length ? Math.max(...n) : 0) + 1); }

/* ---------- Claude ---------- */
function sampleErr(e) {
  const c = e && e.code;
  return ({ no_key: "Añade tu clave de la API de Claude en Ajustes (arriba a la derecha).", bad_key: "La clave de la API no es válida. Revísala en Ajustes.", no_credit: "Tu cuenta de la API de Anthropic no tiene saldo. Añade crédito en console.anthropic.com.", bad_model: "El modelo configurado no existe. Revisa config.js.", rate_limited: "Has llegado al límite de uso de la API. Prueba en un rato.", overloaded: "Claude está saturado ahora mismo. Prueba en un rato.", invalid_json: "La respuesta vino incompleta. Prueba otra vez o pide menos.", prompt_too_large: "El texto es demasiado largo. Prueba con menos páginas.", empty_completion: "Claude no devolvió nada. Prueba otra vez.", cancelled: "Detenido." })[c] || "Algo falló al hablar con Claude. Revisa tu conexión y prueba otra vez.";
}
const srcOf = (t, max = 90000) => (t.source || "").slice(0, max);
function normQ(x, diff) {
  if (!x || typeof x.q !== "string" || !Array.isArray(x.opts)) return null;
  const opts = x.opts.map(o => String(o ?? "").trim()).filter(Boolean).slice(0, 5); let a = Number(x.a);
  if (opts.length < 2 || !(a >= 0 && a < opts.length)) return null;
  const d = ["facil", "media", "dificil"].includes(x.diff) ? x.diff : diff && diff !== "mix" ? diff : "media";
  return { q: x.q.trim(), opts, a, exp: String(x.exp || "").trim(), diff: d };
}
function shuffleOpts(q) { const ord = shuffle(q.opts.map((_, i) => i)); return { ...q, opts: ord.map(i => q.opts[i]), a: ord.indexOf(q.a) }; }
const DIFF_RULES = "Fácil: un dato directo de los apuntes. Media: distinguir normas, convenios, órganos o fechas parecidas. Difícil: un matiz fino, un detalle literal o combinar dos datos.";
const Q_RULES = "4 opciones por pregunta, una sola correcta, como en el examen final. Distractores plausibles sacados del propio tema (otro número de directiva o convenio, otro año, otro órgano).";
function qPrompt(t, n, diff, focus) {
  const have = bank(t.id).questions.map(q => "- " + q.q).join("\n").slice(0, 12000);
  return `Eres profesor del Máster Universitario en Prevención de Riesgos Laborales y preparas preguntas tipo test para el tema «${t.title}».
Genera ${n} preguntas NUEVAS ${diff === "mix" ? "con dificultad variada (fácil, media y difícil a partes iguales)" : "de dificultad " + DIFF[diff].toLowerCase()}.${focus ? `\nCéntrate en: ${focus}.` : ""}
Reglas:
- Usa solo información de los APUNTES. Nada inventado.
- ${Q_RULES}
- "exp": 1-2 frases que expliquen por qué es correcta y citen la norma.
- ${DIFF_RULES}
- No repitas ni reformules estas preguntas que ya existen:
${have || "(ninguna)"}
Responde solo con un array JSON: [{"q":"enunciado","opts":["...","...","...","..."],"a":0,"exp":"...","diff":"facil|media|dificil"}]

APUNTES:
${srcOf(t)}`;
}
let genCtl = null;
async function genRun() {
  const t = S.topics[S.p.tid]; if (!t || !canAI()) return;
  S.p.focus = $("#gfocus")?.value.trim() || "";
  const n = S.p.n || 10, diff = S.p.diff || "media";
  genCtl = new AbortController(); S.lock = true;
  const P = S.p; const here = () => S.view === "gen" && S.p === P;
  Object.assign(P, { running: true, error: null, status: "Claude está pensando…" }); render();
  try {
    const out = await S.sample.json(qPrompt(t, n, diff, P.focus), { signal: genCtl.signal, onText: () => { if (P.status !== "Claude está escribiendo…") { P.status = "Claude está escribiendo…"; if (here()) render(); } } });
    const arr = Array.isArray(out) ? out : (out && out.questions) || [];
    const res = arr.map(x => normQ(x, diff)).filter(Boolean).map(q => ({ ...shuffleOpts(q), keep: true }));
    Object.assign(P, { running: false, result: res, error: res.length ? null : "No llegó ninguna válida. Prueba otra vez." });
  } catch (e) { Object.assign(P, { running: false, error: e && e.code === "cancelled" ? null : sampleErr(e) }); }
  if (here()) render();
}
async function genSave() {
  const t = S.topics[S.p.tid]; const keep = (S.p.result || []).filter(x => x.keep); if (!t || !keep.length) return;
  const b = clone(bank(t.id));
  keep.forEach(x => b.questions.push({ id: rid(), q: x.q, opts: x.opts, a: x.a, exp: x.exp, diff: x.diff, origin: "claude" }));
  S.banks[t.id] = b;
  if (await writeBank(t.id)) { toast(`${keep.length} ${keep.length === 1 ? "añadida" : "añadidas"} a ${t.code}`); go("topic", { tid: t.id, tab: "banco" }); }
}
async function why() {
  const r = S.run; const i = r.idx; const it = r.items[i]; const q = runQ(i); const t = S.topics[it.tid]; if (!q || !t) return;
  S.p.why = i; const box = $("#whyBox"); if (box) box.querySelector("button")?.remove();
  const show = txt => { const o = S.view === "run" && S.run === r && r.idx === i && $("#whyOut"); if (o) o.textContent = txt; };
  show("Claude está pensando…");
  const chosen = r.answers[i];
  const prompt = `Eres profesor del Máster en Prevención de Riesgos Laborales. Un alumno responde un test. Explícale en 3-5 frases, en español y tuteando, ${chosen === q.a ? "por qué su respuesta es correcta y una forma de recordarlo" : "por qué la respuesta correcta lo es, por qué falla la que eligió y un truco para no confundirlas"}. Básate solo en los apuntes. Sin títulos ni listas.

Pregunta: ${q.q}
Opciones:
${q.opts.map((o, k) => `${k + 1}. ${o}`).join("\n")}
Correcta: ${q.opts[q.a]}
Elegida por el alumno: ${chosen == null ? "ninguna" : q.opts[chosen]}

APUNTES:
${srcOf(t, 60000)}`;
  try { await S.sample(prompt, { modelTier: "quick", onText: ({ text }) => show(text) }); }
  catch (e) { show((e && e.text) || sampleErr(e)); }
}

/* PDF / text extraction */
let pdfjsP = null;
function loadPdfJs() {
  if (pdfjsP) return pdfjsP;
  pdfjsP = new Promise((res, rej) => { const s = document.createElement("script"); s.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"; s.onload = () => { try { window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js"; res(window.pdfjsLib); } catch (e) { rej(e); } }; s.onerror = () => { pdfjsP = null; rej(new Error("No se pudo cargar el lector de PDF")); }; document.head.appendChild(s); });
  return pdfjsP;
}
async function fileText(file) {
  if (/\.pdf$/i.test(file.name) || file.type === "application/pdf") {
    const lib = await loadPdfJs(); const doc = await lib.getDocument({ data: await file.arrayBuffer() }).promise; let out = "";
    for (let i = 1; i <= doc.numPages; i++) { const pg = await doc.getPage(i); const tc = await pg.getTextContent(); out += tc.items.map(it => it.str + (it.hasEOL ? "\n" : " ")).join("") + "\n\n"; }
    return out.replace(/[ \t]{2,}/g, " ").trim();
  }
  return (await file.text()).trim();
}
// Las preguntas de la autoevaluación se copian tal cual, con las opciones que traigan (normalmente 3).
function autoPrompt(text, src) {
  return `Este texto es una autoevaluación tipo test del Máster en Prevención de Riesgos Laborales. Extrae TODAS sus preguntas, con el enunciado y las opciones tal cual (sin la letra delante).
La respuesta correcta suele ir marcada (✓, "correcta", asterisco, negrita…). Si no está marcada, dedúcela de los APUNTES y pon "unsure": true.
"exp": 1-2 frases sobre por qué es la correcta, basadas en los apuntes. "diff": facil, media o dificil según ${DIFF_RULES}
Responde solo con un array JSON: [{"q":"...","opts":["..."],"a":0,"exp":"...","diff":"media","unsure":false}]

AUTOEVALUACIÓN:
${text.slice(0, 60000)}

APUNTES:
${(src || "").slice(0, 80000)}`;
}
const officialFrom = arr => (Array.isArray(arr) ? arr : arr?.questions || []).map(x => { const q = normQ(x); return q && { id: rid(), ...q, origin: "oficial", ...(x.unsure ? { check: true } : {}) }; }).filter(Boolean);
async function importAuto(tid, file) {
  const t = S.topics[tid]; if (!t || !canAI()) return;
  S.busy = { kind: "auto", msg: "Leyendo la autoevaluación…" }; render();
  try {
    const text = await fileText(file);
    S.busy.msg = "Claude está extrayendo las preguntas…"; render();
    const qs = officialFrom(await S.sample.json(autoPrompt(text, t.source)));
    if (!qs.length) throw { code: "empty_completion" };
    const b = clone(bank(tid)); b.questions.push(...qs); S.banks[tid] = b; await writeBank(tid);
    S.busy = null; toast(`${qs.length} preguntas oficiales añadidas`); render();
  } catch (e) { S.busy = { kind: "auto", msg: e && e.code ? sampleErr(e) : "No se pudo leer el archivo. Prueba con un PDF con texto seleccionable o un .txt." }; render(); }
}
async function createTopic(form) {
  if (!canAI()) return;
  const P = S.p; const here = () => S.view === "newtopic" && S.p === P;
  const sv = $("#nt_s").value; const isNew = sv === "__new" || !subjects().length;
  const sname = isNew ? $("#nt_sn").value.trim() : subjects().find(s => s.id === sv)?.name;
  if (isNew && !sname) { P.error = "Escribe el nombre de la asignatura."; return keepForm(render); }
  const f = $("#nt_f").files[0], fa = $("#nt_a").files[0]; const pasted = $("#nt_x").value.trim();
  if (!f && !pasted) { P.error = "Sube los apuntes o pega el texto del tema."; return keepForm(render); }
  const code = $("#nt_c").value.trim() || nextCode(sv); const title0 = $("#nt_t").value.trim();
  const steps = [{ l: "Leer los archivos" }, { l: "Resumen y recursos interactivos" }, { l: "Banco de preguntas" }, ...(fa ? [{ l: "Preguntas de la autoevaluación" }] : []), { l: "Guardar el tema" }];
  Object.assign(P, { steps, running: true, error: null, code }); S.lock = true; keepForm(render);
  const step = (i, st) => { steps[i].st = st; if (here()) { const ul = $(".steps"); if (ul) ul.outerHTML = `<ul class="steps">${steps.map(s => `<li class="${s.st || ""}"><span class="dot"></span><span>${esc(s.l)}</span></li>`).join("")}</ul>`; } };
  let k = 0;
  try {
    step(k, "run"); let src = pasted; if (f) src = (await fileText(f)) + (pasted ? "\n\n" + pasted : ""); const auto = fa ? await fileText(fa) : ""; src = src.slice(0, 100000);
    if (src.length < 300) throw new Error("El texto de los apuntes es muy corto. Si el PDF es escaneado, pega el texto."); step(k++, "done");
    step(k, "run");
    const A = await S.sample.json(`Eres profesor del Máster Universitario en Prevención de Riesgos Laborales. A partir de los APUNTES crea el material de estudio del tema ${code}${title0 ? ` («${title0}»)` : ""}. Español, frases cortas, sin relleno.
Devuelve solo un objeto JSON:
{"title":"título corto del tema","summary":[{"h":"título del bloque","keys":[{"r":"referencia corta: norma, artículo, año o cifra (o vacío)","t":"idea clave en una frase"}],"trap":"la confusión típica en el test, en una frase"}],
"resources":[{"type":"match","title":"...","pairs":[["término","definición corta"]]},{"type":"classify","title":"...","categories":["..."],"items":[["elemento",0]]},{"type":"order","title":"...","items":[["hecho","año o detalle"]]}]}
Reglas: 4-7 bloques con 3-6 keys cada uno; todo debe salir de los apuntes; 2-4 recursos con 5-10 pares o elementos; usa "order" solo si hay una cronología o secuencia real (en orden correcto); en "classify" el número es el índice de la categoría.

APUNTES:
${src}`);
    step(k++, "done");
    step(k, "run");
    const B = await S.sample.json(`Eres profesor del Máster Universitario en Prevención de Riesgos Laborales. Con los APUNTES del tema ${code}, crea 24 preguntas tipo test (8 fáciles, 8 medias, 8 difíciles).
${Q_RULES} "exp" de 1-2 frases citando la norma. ${DIFF_RULES}
Solo información de los apuntes.
Devuelve solo un objeto JSON: {"questions":[{"q":"...","opts":["...","...","...","..."],"a":0,"exp":"...","diff":"facil"}]}

APUNTES:
${src}`);
    step(k++, "done");
    let official = [];
    if (fa) { step(k, "run"); official = officialFrom(await S.sample.json(autoPrompt(auto, src))); step(k++, "done"); }
    step(k, "run");
    const tid = "t" + rid(); const sid = isNew ? "s" + rid() : sv;
    const summary = (A && Array.isArray(A.summary) ? A.summary : []).filter(b => b && b.h).map(b => ({ h: String(b.h), keys: (b.keys || []).map(x => typeof x === "string" ? { t: x } : { r: String(x.r || ""), t: String(x.t || "") }).filter(x => x.t), trap: String(b.trap || "") }));
    const resources = (A && Array.isArray(A.resources) ? A.resources : []).filter(r => r && ((r.type === "match" && Array.isArray(r.pairs) && r.pairs.length > 1) || (r.type === "classify" && Array.isArray(r.items) && Array.isArray(r.categories) && r.items.every(it => Array.isArray(it) && it[1] >= 0 && it[1] < r.categories.length)) || (r.type === "order" && Array.isArray(r.items) && r.items.length > 1)));
    const subj = isNew ? null : subjects().find(s => s.id === sid);
    const short = subj ? subj.short : sname.length > 34 ? sname.slice(0, 32) + "…" : sname;
    const topic = { subject: sid, subjectName: sname, subjectShort: short, code, title: title0 || String(A?.title || code), order: +(code.match(/\d+/)?.[0] || 99), createdAt: Date.now(), summary, resources, source: src };
    if (isNew) await guarded("subject:" + sid, () => S.db.doc("subjects/" + sid).set({ name: sname, short, order: Math.max(0, ...Object.values(S.subjects).map(s => s.order || 0)) + 1 }));
    const bk = { questions: [...official, ...((B && B.questions) || []).map(x => normQ(x)).filter(Boolean).map(q => ({ id: rid(), ...shuffleOpts(q), origin: "claude" }))] };
    await guarded("topic:" + tid, () => S.db.doc("topics/" + tid).set(topic));
    await guarded("bank:" + tid, () => S.db.doc("banks/" + tid).set(bk));
    step(k, "done");
    S.topics[tid] = { id: tid, ...topic }; S.banks[tid] = bk;
    toast(`${code} creado`); go("topic", { tid, tab: "resumen" });
  } catch (e) {
    step(k, "fail"); Object.assign(P, { running: false, error: e && e.code ? sampleErr(e) : (e && e.message) || "No se pudo crear el tema." });
    if (here()) { S.lock = false; keepForm(render); } else toast(`No se pudo crear ${code}: ${P.error}`);
  }
}

/* ---------- actions ---------- */
const saveSetup = () => lsSet("setup", S.setup);
const A = {
  go: el => go(el.dataset.v),
  nav: el => { const v = el.dataset.v; if (v === "setup" && S.run && !S.run.done) return go("run"); go(v); },
  subject: el => go("subject", { sid: el.dataset.s }),
  topic: el => go("topic", { tid: el.dataset.t, tab: "resumen" }),
  tab: el => { S.p = { tid: S.p.tid, tab: el.dataset.k }; render(); },
  backTopic: el => go("topic", { tid: S.p.tid, tab: el.dataset.k }),
  bf: el => { S.p.f = el.dataset.k; render(); },
  delTopicAsk: () => { S.p.delTopic = true; render(); },
  delTopicNo: () => { S.p.delTopic = false; render(); },
  delTopic: async el => { const tid = el.dataset.t; const sid = S.topics[tid]?.subject; await guarded("bank:" + tid, () => S.db.doc("banks/" + tid).delete()); await guarded("topic:" + tid, () => S.db.doc("topics/" + tid).delete()); delete S.topics[tid]; delete S.banks[tid]; S.setup.tids = S.setup.tids.filter(x => x !== tid); saveSetup(); toast("Tema eliminado"); go("subject", { sid }); },
  practiceTopic: el => { S.setup.tids = [el.dataset.t]; S.setup.mode = "practica"; saveSetup(); go("setup"); },
  quick: el => { const s = subjects().find(x => x.id === el.dataset.s); S.setup.tids = s ? s.topics.map(t => t.id) : []; S.setup.mode = el.dataset.m; saveSetup(); go("setup"); },
  newTopicFor: el => go("newtopic", { sid: el.dataset.s }),
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
  next: () => { S.run.idx = Math.min(S.run.items.length - 1, S.run.idx + 1); S.p.why = null; S.p.submitAsk = false; render(); window.scrollTo(0, 0); },
  prev: () => { S.run.idx = Math.max(0, S.run.idx - 1); render(); window.scrollTo(0, 0); },
  jump: el => { S.run.idx = +el.dataset.k; render(); window.scrollTo(0, 0); },
  flag: () => { const r = S.run; r.flags[r.idx] = !r.flags[r.idx]; render(); },
  submitAsk: () => { S.p.submitAsk = true; render(); },
  submitNo: () => { S.p.submitAsk = false; render(); },
  finish: () => finishRun(false),
  why: () => why(),
  retryWrong: () => { const R = S.lastResult; const items = R.rows.filter(x => !x.ok).map(x => ({ ...findQ(x.tid, x.qid), tid: x.tid })).filter(q => q.id); if (!items.length) return; S.run = buildRun({ ...S.setup, mode: "practica", n: 0 }, shuffle(items)); go("run"); },
  gen: el => { const tid = el.dataset.t || topicList()[0]?.id; if (!tid) return; go("gen", { tid, n: 10, diff: "media" }); },
  genSet: el => { S.p.focus = $("#gfocus")?.value || S.p.focus; S.p[el.dataset.f] = el.dataset.f === "n" ? +el.dataset.k : el.dataset.k; render(); },
  genRun: () => genRun(),
  genStop: () => genCtl && genCtl.abort(),
  genSave: () => genSave(),
  importAuto: () => $("#autoFile")?.click(),
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
  const sw = $("#nt_sn_w"); if (sw) sw.hidden = $("#nt_s").value !== "__new";
}
const C = {
  exmin: el => { const v = Math.max(1, Math.min(240, +el.value || 1)); S.setup.min = v; saveSetup(); },
  pen: el => { S.setup.penalty = el.checked; saveSetup(); },
  shuf: el => { S.setup.shuf = el.checked; saveSetup(); },
  genKeep: el => { S.p.result[+el.dataset.i].keep = el.checked; const btn = $('[data-act="genSave"]'); const n = S.p.result.filter(x => x.keep).length; if (btn) { btn.textContent = `Añadir ${n} al tema`; btn.disabled = !n; } },
  autoFile: el => { const f = el.files[0]; if (f) importAuto(el.dataset.t, f); el.value = ""; }
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
document.addEventListener("change", e => { const el = e.target.closest("[data-chg]"); if (el && C[el.dataset.chg]) C[el.dataset.chg](el, e); if (e.target.id === "nt_s") { const w = $("#nt_sn_w"); if (w) w.hidden = e.target.value !== "__new"; const c = $("#nt_c"); if (c && c.dataset.auto) c.value = nextCode(e.target.value); } });
document.addEventListener("input", e => { if (e.target.id === "nt_c") delete e.target.dataset.auto; });
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
    const nq = { id: old ? old.id : rid(), q, opts: kept.map(x => x.o), a: kept.findIndex(x => x.i === ai), exp: $("#q_e").value.trim(), diff, origin: old ? old.origin : "propia" };
    if (old) b.questions[b.questions.indexOf(old)] = nq; else b.questions.push(nq);
    S.banks[tid] = b; if (await writeBank(tid)) { toast("Pregunta guardada"); go("topic", { tid, tab: "banco" }); }
  } else if (f.id === "fnt") createTopic(f);
  else if (f.id === "fkey") { const k = $("#k_key").value.trim(); AI.setKey(k); if (!k) { S.p.keyMsg = null; return render(); } Object.assign(S.p, { keyMsg: "Probando la clave…", keyOk: null }); render(); try { await AI.test(); Object.assign(S.p, { keyMsg: "Clave correcta. Ya puedes generar con Claude.", keyOk: true }); } catch (err) { Object.assign(S.p, { keyMsg: sampleErr(err), keyOk: false }); } if (S.view === "settings") render(); }
});

/* ----- settings ----- */
VIEWS.settings = () => {
  const key = AI.getKey();
  return `<div class="stack-lg">
    <div class="stack"><p class="eyebrow">Configuración</p><h1>Ajustes</h1></div>
    <section class="stack"><h2>Claude</h2>
      <p class="muted">Genera preguntas, temas nuevos y explicaciones. Usa tu clave de la API de Anthropic (console.anthropic.com → API Keys). Se guarda solo en este navegador y el uso se paga aparte de la suscripción de Claude.</p>
      <form class="stack" id="fkey"><div class="field"><label for="k_key">Clave de API</label><input class="input mono" id="k_key" type="password" autocomplete="off" spellcheck="false" placeholder="sk-ant-…" value="${esc(key)}"></div>
        <div class="row"><button class="btn" type="submit">Guardar y probar</button>${key ? `<button class="btn quiet" type="button" data-act="delKey" style="color:var(--bad)">Quitar clave</button>` : ""}</div>
        ${S.p.keyMsg ? `<div class="callout ${S.p.keyOk ? "ok" : S.p.keyOk === false ? "bad" : "accent"} small">${esc(S.p.keyMsg)}</div>` : ""}</form>
    </section>
    <section class="stack"><h2>Copia de seguridad</h2>
      <p class="muted">Los temas y preguntas que añadas se guardan solo en este dispositivo. Descarga una copia para pasarlos a otro o para recuperarlos.</p>
      <div class="row"><button class="btn ghost" data-act="exportAll">Descargar copia</button><button class="btn ghost" data-act="importAsk">Restaurar copia</button></div>
      <input type="file" id="impFile" accept=".json,application/json" hidden data-chg="impFile">
    </section>
  </div>`;
};
Object.assign(A, {
  delKey: () => { AI.setKey(""); S.p.keyMsg = null; render(); },
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
