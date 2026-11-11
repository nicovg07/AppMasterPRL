/* Asistente de estudio con Claude (API de Anthropic). Lo carga app.js la primera vez que se abre la pestaña
   «Asistente» (vista "ia"), así no pesa en el arranque.
   - La clave de la API la pega Nico en la propia pestaña y se guarda solo en este dispositivo ("prl:ia_key", fuera del
     Store: no entra en la copia de seguridad ni en el repositorio). Las peticiones van del navegador a api.anthropic.com.
   - Contexto: los apuntes visuales (resumen y para memorizar) de la asignatura elegida, descargados de apuntes/src/ y
     pasados a texto. Van en el system con caché de 1 h; la conversación, con la caché automática de 5 min.
   - Una conversación por asignatura ("prl:ia_chat"). Solo se añade al final y se devuelven los bloques de pensamiento tal
     cual: el modelo comprueba que no se reescribe el historial. Si los apuntes cambian, drop_block descarta el
     pensamiento viejo en vez de dar error.
   - Sin librerías: fetch y lectura del streaming (SSE) a mano. */
(() => {
const API = "https://api.anthropic.com";
// precios por millón de tokens: [entrada, salida, lectura de caché] (escribir en caché: ×1,25 a 5 min, ×2 a 1 h)
const MODELS = {
  "claude-opus-5-5": { name: "Opus 5.5", note: "El más capaz. Recomendado", p: [4, 20, 0.2] },
  "claude-sonnet-5-5": { name: "Sonnet 5.5", note: "Muy bueno, a mitad de precio", p: [2, 10, 0.1] },
  "claude-haiku-5-5": { name: "Haiku 5.5", note: "Rápido y muchísimo más barato", p: [0.1, 0.5, 0.01] }
};
const DEF_MODEL = "claude-opus-5-5";
const SUGGEST = ["Resúmeme el tema 1 en cinco ideas", "¿Qué trampas típicas hay en el test de esta asignatura?", "Ponme tres preguntas tipo test del tema 2"];

const model = () => MODELS[lsGet("ia_model")] ? lsGet("ia_model") : DEF_MODEL;
const apiKey = () => { const k = lsGet("ia_key"); return typeof k === "string" ? k : ""; };
const st = S.ia = { sid: lsGet("ia_sid"), draft: "", busy: null, live: null, err: null, ctrl: null, ctx: {}, chats: lsGet("ia_chat") || {}, newAsk: false };
const chatOf = sid => st.chats[sid] || (st.chats[sid] = { msgs: [], cost: 0 });
function saveChats() {
  for (const k in st.chats) if (!st.chats[k].msgs.length) delete st.chats[k];
  try { localStorage.setItem("prl:ia_chat", JSON.stringify(st.chats)); } catch (e) { console.warn("ia_chat", e); toast("No se pudo guardar la conversación: el navegador no deja más espacio."); }
}
// asignaturas con apuntes, con su número (Asignatura N) como en Inicio
const iaSubjects = () => subjects().map((s, i) => ({ ...s, n: i + 1 })).filter(s => s.topics.some(t => (t.apuntes || []).length));

/* ---------- apuntes de la asignatura en texto ---------- */
const BLOCK = /^(DIV|P|UL|OL|LI|TABLE|THEAD|TBODY|TFOOT|TR|SECTION|ARTICLE|ASIDE|HEADER|FOOTER|H[1-6]|DL|DT|DD|FIGURE|FIGCAPTION|BLOCKQUOTE|DETAILS|SUMMARY)$/;
const tidy = s => s.replace(/\s+/g, " ").replace(/ ([,.;:!?)\]»%])/g, "$1").replace(/([(\[«¿¡]) /g, "$1").trim();
const inText = n => n.nodeType === 3 ? n.textContent : n.nodeType === 1 ? " " + [...n.childNodes].map(inText).join("") + " " : "";
const hasBlock = e => [...e.children].some(c => BLOCK.test(c.tagName));
function htmlText(html) {
  const d = new DOMParser().parseFromString(html, "text/html");
  d.querySelectorAll(".pg").forEach(e => { e.textContent = `(${e.textContent.trim()})`; });
  const out = [];
  (function walk(el) {
    let buf = "";
    const flush = () => { const t = tidy(buf); if (t) out.push(t); buf = ""; };
    for (const n of el.childNodes) {
      if (n.nodeType === 3) { buf += n.textContent; continue; }
      if (n.nodeType !== 1 || /^(SCRIPT|STYLE)$/.test(n.tagName)) continue;
      const tag = n.tagName;
      if (!BLOCK.test(tag)) { buf += inText(n); continue; }
      flush();
      const t = tidy(inText(n));
      if (/^H\d$/.test(tag)) out.push("", "#".repeat(Math.min(+tag[1], 4)) + " " + t);
      else if (tag === "LI") out.push("- " + t);
      else if (tag === "TR") out.push("| " + [...n.children].map(c => tidy(inText(c))).join(" | ") + " |");
      else if (!hasBlock(n)) { if (t) out.push(tag === "DT" ? "* " + t : t); }
      else walk(n);
    }
    flush();
  })(d.body);
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
const attr = s => String(s ?? "").replace(/[&"<>]/g, c => ({ "&": "&amp;", '"': "&quot;", "<": "&lt;", ">": "&gt;" }[c]));
async function context(s) {
  if (st.ctx[s.id]) return st.ctx[s.id];
  const topics = s.topics.filter(t => (t.apuntes || []).length);
  const parts = await Promise.all(topics.map(async t => {
    const docs = (await Promise.all(t.apuntes.filter(k => DOCS[k]).map(async k => {
      try { const r = await fetch(`apuntes/src/${t.id}-${k}.html`); return r.ok ? [k, await r.text()] : null; } catch (_) { return null; }
    }))).filter(Boolean);
    if (!docs.length) return null;
    let meta = {}; try { meta = JSON.parse((docs[0][1].match(/^\s*<!--(.*?)-->/) || [])[1] || "{}"); } catch (_) {}
    return `<tema codigo="${attr(t.code)}" titulo="${attr(t.title)}"${meta.ud ? ` ud="${attr(meta.ud)}"` : ""}${meta.pags ? ` paginas="${attr(meta.pags)}"` : ""}>\n`
      + docs.map(([k, h]) => { const tag = k === "resumen" ? "resumen" : "para_memorizar"; return `<${tag}>\n${htmlText(h)}\n</${tag}>`; }).join("\n") + "\n</tema>";
  }));
  const ok = parts.filter(Boolean);
  if (!ok.length) throw Object.assign(new Error("apuntes"), { ia: "No se pudieron cargar los apuntes de la asignatura. Revisa la conexión." });
  return st.ctx[s.id] = `<apuntes asignatura="${attr(s.name)}">\n${ok.join("\n\n")}\n</apuntes>`;
}
// Fijo para cada asignatura (cambiarlo invalida la caché): sin fecha ni nada que varíe entre peticiones.
const rules = s => `Eres un asistente de estudio para un alumno del Máster Universitario en Prevención de Riesgos Laborales de la Universidad Nebrija. Ahora está estudiando la asignatura «${s.name}».

Más abajo, entre <apuntes>, tienes los apuntes de esta asignatura que usa en su app: por cada tema, un resumen y una hoja «para memorizar», preparados a partir de los apuntes oficiales del máster. Entre paréntesis van las páginas de los apuntes impresos, que son los que él tiene delante.

Cómo responder:
- En español de España, tuteando, claro y al grano, como un buen profesor que prepara un examen tipo test.
- Básate en los apuntes. Cuando la respuesta esté en ellos, di dónde con el formato «Tema N · pág. X».
- Si la pregunta va más allá de los apuntes, puedes responder con lo que sabes, pero avísalo al principio («Esto no viene en tus apuntes, pero…») y no lo presentes como materia de examen. Si es de otra asignatura del máster, respóndela y dile que esos apuntes no los tienes aquí.
- Los apuntes de aquí son un resumen: si te falta un detalle, dilo y dile qué páginas de los impresos mirar.
- Si los apuntes no coinciden con la norma vigente, explica lo que dicen los apuntes, que es lo que se evalúa, y avisa de la diferencia.
- No inventes artículos, fechas, plazos ni cifras. Si no estás seguro, dilo.
- Si te pregunta por una pregunta de test, explica por qué la correcta lo es y por qué fallan las demás, y dale un truco para recordarlo.
- Sé breve: párrafos cortos, listas y **negritas** para lo clave. Markdown sencillo, sin tablas ni títulos.`;

/* ---------- llamada a la API con streaming ---------- */
function headers(key, betas) {
  const h = { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2026-10-21", "anthropic-dangerous-direct-browser-access": "true" };
  if (betas && betas.length) h["anthropic-beta"] = betas.join(",");
  return h;
}
async function readSSE(res, on) {
  const rd = res.body.getReader(), dec = new TextDecoder(); let buf = "";
  for (;;) {
    const { value, done } = await rd.read(); if (done) break;
    buf += dec.decode(value, { stream: true }).replace(/\r/g, "");
    let i; while ((i = buf.indexOf("\n\n")) >= 0) {
      const data = buf.slice(0, i).split("\n").filter(l => l.startsWith("data:")).map(l => l.slice(5).trimStart()).join("\n");
      buf = buf.slice(i + 2);
      if (data) on(JSON.parse(data));
    }
  }
}
function onEvent(ev, m) {
  if (ev.type === "message_start") { m.model = ev.message.model || m.model; Object.assign(m.usage, ev.message.usage || {}); }
  else if (ev.type === "content_block_start") m.content[ev.index] = { ...ev.content_block };
  else if (ev.type === "content_block_delta") {
    const b = m.content[ev.index], d = ev.delta; if (!b) return;
    if (d.type === "text_delta") { b.text = (b.text || "") + d.text; paintLive(m); }
    else if (d.type === "thinking_delta") b.thinking = (b.thinking || "") + d.thinking;
    else if (d.type === "signature_delta") b.signature = d.signature;
  }
  else if (ev.type === "message_delta") { if (ev.delta) { m.stop = ev.delta.stop_reason; m.stopDetails = ev.delta.stop_details; } Object.assign(m.usage, ev.usage || {}); }
  else if (ev.type === "error") throw Object.assign(new Error("stream"), { api: ev.error || {} });
}
const textOf = content => typeof content === "string" ? content : (content || []).filter(b => b && b.type === "text").map(b => b.text || "").join("");
// Lo que se devuelve en el siguiente turno: todo tal cual, salvo bloques de texto vacíos y, si hubo cambio de modelo
// a media respuesta (bloque "fallback"), el pensamiento y las herramientas de antes del último cambio.
function echo(content) {
  const list = content.filter(Boolean);
  const fb = list.map(b => b.type).lastIndexOf("fallback");
  return list.filter((b, i) => !(b.type === "text" && !b.text) && !(i < fb && /^(thinking|redacted_thinking|tool_use|server_tool_use)$/.test(b.type)));
}
function costOf(u, mid) {
  const p = (MODELS[mid] || MODELS[model()]).p, cc = u.cache_creation || {};
  const write = cc.ephemeral_5m_input_tokens != null || cc.ephemeral_1h_input_tokens != null ? (cc.ephemeral_5m_input_tokens || 0) * 1.25 + (cc.ephemeral_1h_input_tokens || 0) * 2 : (u.cache_creation_input_tokens || 0) * 1.25;
  return (((u.input_tokens || 0) + write) * p[0] + (u.cache_read_input_tokens || 0) * p[2] + (u.output_tokens || 0) * p[1]) / 1e6;
}
function errText(status, e) {
  const msg = (e && e.message) || "";
  if (/credit balance/i.test(msg)) return "No te queda saldo en la API de Anthropic. Recárgalo en console.anthropic.com.";
  if (status === 401 || (e && e.type === "authentication_error")) return "La clave de la API no es válida. Cámbiala en Ajustes del asistente.";
  if (status === 403 || (e && e.type === "permission_error")) return "Tu clave no tiene permiso para usar este modelo. Prueba con otro en Ajustes del asistente.";
  if (status === 429 || (e && e.type === "rate_limit_error")) return "Has hecho muchas preguntas seguidas. Espera un minuto y vuelve a intentarlo.";
  if (status === 529 || (e && e.type === "overloaded_error")) return "Los servidores de Anthropic están saturados. Prueba dentro de un momento.";
  if (status >= 500 || (e && e.type === "api_error")) return "Ha fallado el servidor de Anthropic. Vuelve a intentarlo.";
  return "No se pudo responder" + (msg ? ": " + msg : ".");
}

async function send(text) {
  text = String(text || "").trim();
  const s = iaSubjects().find(x => x.id === st.sid), key = apiKey();
  if (!text || st.busy || !s || !key) return;
  const sid = s.id, c = chatOf(sid), mid = model();
  c.msgs.push({ role: "user", content: text });
  st.busy = sid; st.err = null; st.draft = ""; st.newAsk = false;
  const m = st.live = { content: [], usage: {}, model: mid, stop: null };
  saveChats(); paint(true);
  const ctrl = st.ctrl = new AbortController();
  const back = err => { c.msgs.pop(); st.draft = text; st.err = err; }; // la pregunta vuelve a la caja para reintentarla
  try {
    const ctx = await context(s);
    const fallback = mid !== "claude-haiku-5-5"; // Haiku no tiene modelo de respaldo
    const body = {
      model: mid, max_tokens: 16000, stream: true,
      system: [{ type: "text", text: rules(s) }, { type: "text", text: ctx, cache_control: { type: "ephemeral", ttl: "1h" } }],
      cache_control: { type: "ephemeral" },
      thinking: { type: "adaptive", block_binding: { prefix_mismatch_behavior: "drop_block" } },
      output_config: { effort: "medium" },
      messages: c.msgs.map(x => ({ role: x.role, content: x.content })),
      ...(fallback ? { fallbacks: "default" } : {})
    };
    const betas = ["thinking-binding-controls-2026-08-01", ...(fallback ? ["server-side-fallback-2026-07-01"] : [])];
    const res = await fetch(API + "/v1/messages", { method: "POST", headers: headers(key, betas), body: JSON.stringify(body), signal: ctrl.signal });
    if (!res.ok) { let e = null; try { e = (await res.json()).error; } catch (_) {} throw Object.assign(new Error("http"), { status: res.status, api: e }); }
    await readSSE(res, ev => onEvent(ev, m));
    c.cost += costOf(m.usage, m.model);
    if (m.stop === "refusal") back("El asistente no ha querido responder a esto. Prueba a preguntarlo de otra forma.");
    else {
      const content = echo(m.content);
      if (!content.length) back("La respuesta ha llegado vacía. Vuelve a intentarlo.");
      else c.msgs.push({ role: "assistant", content, ...(m.stop === "max_tokens" ? { cut: 1 } : {}) });
    }
  } catch (e) {
    if (e.name === "AbortError") {
      c.cost += costOf(m.usage, m.model);
      const part = textOf(m.content);
      if (part.trim()) c.msgs.push({ role: "assistant", content: [{ type: "text", text: part }], cut: 2 }); // lo recibido, sin el pensamiento a medias
      else back(null);
    } else back(e.ia || (e.status || e.api ? errText(e.status, e.api) : navigator.onLine === false ? "Sin conexión: el asistente necesita internet." : "No se pudo conectar con Anthropic. Vuelve a intentarlo."));
    if (e.name !== "AbortError" && !e.ia) console.warn("asistente", e.status || "", e.api || e);
  } finally {
    st.busy = null; st.live = null; st.ctrl = null;
    saveChats(); paint(true);
  }
}

/* ---------- pintar ---------- */
// Markdown sencillo sobre texto ya escapado: párrafos, listas, negrita, cursiva, código y tablas.
function md(src) {
  const inl = s => s.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/(^|[\s(«])\*(?!\s)([^*]+?)\*(?=$|[\s.,;:!?)»])/g, "$1<i>$2</i>").replace(/`([^`]+)`/g, '<span class="ref">$1</span>');
  const out = []; let list = null, rows = null;
  const endList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  const endRows = () => { if (rows) { out.push(`<div class="tw"><table>${rows.join("")}</table></div>`); rows = null; } };
  for (const line of esc(src).split("\n")) {
    const l = line.trim().replace(/^&gt;\s?/, ""); let x;
    if (/^\|.*\|$/.test(l)) { endList(); if (!/^\|[\s:|-]+\|$/.test(l)) (rows = rows || []).push("<tr>" + l.slice(1, -1).split("|").map(c => `<td>${inl(c.trim())}</td>`).join("") + "</tr>"); continue; }
    endRows();
    if ((x = l.match(/^[-*•]\s+(.*)$/))) { if (list !== "ul") { endList(); out.push("<ul>"); list = "ul"; } out.push(`<li>${inl(x[1])}</li>`); }
    else if ((x = l.match(/^(\d{1,3})[.)]\s+(.*)$/))) { if (list !== "ol") { endList(); out.push(`<ol start="${x[1]}">`); list = "ol"; } out.push(`<li>${inl(x[2])}</li>`); }
    else if ((x = l.match(/^#{1,6}\s+(.*)$/))) { endList(); out.push(`<p class="h">${inl(x[1])}</p>`); }
    else if (!l || /^([-*_])\1{2,}$/.test(l)) endList();
    else { endList(); out.push(`<p>${inl(l)}</p>`); }
  }
  endList(); endRows();
  return out.join("");
}
const CUT = { 1: "Respuesta cortada: era demasiado larga.", 2: "Respuesta detenida." };
function bubble(x) {
  if (x.role === "user") return `<div class="msg me">${esc(x.content)}</div>`;
  return `<div class="msg ai">${md(textOf(x.content))}${x.cut ? `<p class="note">${CUT[x.cut]}</p>` : ""}</div>`;
}
const liveHTML = m => { const t = textOf(m.content); return t ? md(t) : `<p class="note pulse">Pensando…</p>`; };
let rafP = 0;
function paintLive(m) {
  if (rafP) return;
  rafP = requestAnimationFrame(() => {
    rafP = 0; const el = $("#iaLive"); if (!el || st.live !== m) return;
    const stick = innerHeight + scrollY >= document.documentElement.scrollHeight - 140;
    el.innerHTML = liveHTML(m); if (stick) scrollEnd();
  });
}
const scrollEnd = () => window.scrollTo(0, document.documentElement.scrollHeight);
// La caja crece con el texto (hasta el 40 % de la pantalla).
function fitText(t = $("#iaText")) { if (!t) return; t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight + 2, innerHeight * 0.4) + "px"; }
// Repinta sin perder lo que se está escribiendo (foco y cursor) y baja al final.
function paint(end) {
  if (S.view !== "ia") return;
  const a = document.activeElement, id = a && a.id, sel = id && "selectionStart" in a ? [a.selectionStart, a.selectionEnd] : null;
  render();
  const b = id && document.getElementById(id);
  if (b) { b.focus({ preventScroll: true }); if (sel) try { b.setSelectionRange(...sel); } catch (_) {} }
  if (end) setTimeout(scrollEnd);
}
const money = v => v < 0.01 ? "menos de 1 céntimo" : `${v.toFixed(2).replace(".", ",")} $`;

function cfgHTML(key) {
  const m = model();
  return `<section class="stack"><h2>Tu clave de la API</h2>
      <p class="muted">El asistente usa tu cuenta de Anthropic. Crea una clave en <a class="link" href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">console.anthropic.com</a> y pégala aquí.</p>
      ${key ? `<div class="row"><span>Guardada:</span><span class="ref">sk-ant-…${esc(key.slice(-4))}</span><button class="btn quiet sm" style="color:var(--bad)" data-act="iaKeyDel">Borrar clave</button></div>` : ""}
      <form id="iaKeyForm" class="stack"><input class="input mono" id="iaKey" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="${key ? "Pega una clave nueva para cambiarla" : "sk-ant-…"}" aria-label="Clave de la API">
      <div class="row"><button class="btn" type="submit">Guardar clave</button>${key ? `<button class="btn ghost" type="button" data-act="iaChatGo">Volver al chat</button>` : ""}</div></form>
      <div class="callout small">🔒 Se guarda solo en este dispositivo: no va en la copia de seguridad ni en la web, y solo se envía a Anthropic. Pon un límite de gasto mensual en la consola por si acaso.</div>
    </section>
    <section class="stack"><h2>Modelo</h2>
      <div>${Object.entries(MODELS).map(([id, x]) => `<label class="toggle" for="m_${id}"><span><b>${x.name}</b><br><span class="small muted">${x.note} · ${String(x.p[0]).replace(".", ",")} $ / ${String(x.p[1]).replace(".", ",")} $ por millón de tokens (entrada / salida)</span></span><input type="radio" name="iaModel" id="m_${id}" value="${id}" ${id === m ? "checked" : ""} data-chg="iaModel"></label>`).join("")}</div>
      <p class="small muted">Con cada pregunta se envían los apuntes de la asignatura (de 20.000 a 35.000 tokens, según cuál). La primera de cada hora los guarda en caché y las siguientes salen mucho más baratas. Con Opus 5.5, la primera cuesta unos 15–30 céntimos y las siguientes, 2 o 3; con Haiku 5.5, casi nada.</p>
    </section>`;
}

VIEWS.ia = () => {
  if (contentLoading()) return loadingView();
  const subs = iaSubjects(), key = apiKey();
  if (S.iaAsk) { askDraft(S.iaAsk); S.iaAsk = null; }
  if (!subs.find(s => s.id === st.sid)) st.sid = subs[0] && subs[0].id;
  const head = `<div class="stack"><p class="eyebrow">Pregunta tus dudas</p><div class="spread"><h1>Asistente</h1>${key && !S.p.cfg ? `<button class="btn quiet sm" data-act="iaCfg">Ajustes</button>` : ""}</div></div>`;
  if (!key || S.p.cfg) return `<div class="stack-lg">${head}${key ? "" : `<p class="muted">Pregúntale lo que no entiendas: responde con tus apuntes de la asignatura y te dice el tema y la página.</p>`}${cfgHTML(key)}</div>`;
  if (!subs.length) return `<div class="stack-lg">${head}<p class="empty">Aún no hay apuntes con los que responder.</p></div>`;
  const s = subs.find(x => x.id === st.sid), c = chatOf(s.id), busy = !!st.busy;
  const live = st.busy === s.id && st.live ? `<div class="msg ai" id="iaLive">${liveHTML(st.live)}</div>` : "";
  const empty = !c.msgs.length && !live ? `<div class="stack"><p class="muted">Pregúntale lo que no entiendas de <b>${esc(s.short)}</b>. Responde con tus apuntes y te dice dónde está cada cosa.</p><div class="chips">${SUGGEST.map(t => `<button class="chip" data-act="iaSug" data-k="${esc(t)}" ${busy ? "disabled" : ""}>${esc(t)}</button>`).join("")}</div></div>` : "";
  setTimeout(() => { fitText(); if (c.msgs.length || live) scrollEnd(); }); // ya pintado (setTimeout también corre con la app en segundo plano)
  return `<div class="stack-lg">${head}
    <div class="stack" style="gap:8px"><div class="chips">${subs.map(x => `<button class="chip" aria-pressed="${x.id === s.id}" data-act="iaSub" data-s="${esc(x.id)}" ${busy && x.id !== s.id ? "disabled" : ""}>Asignatura ${x.n}</button>`).join("")}</div><span class="small muted">${esc(s.name)}</span></div>
    ${empty}<div class="chat">${c.msgs.map(bubble).join("")}${live}</div>
    ${st.err ? `<div class="callout bad small">${esc(st.err)}</div>` : ""}
    ${c.msgs.length > 40 ? `<p class="small muted">La conversación ya es larga y cada pregunta la reenvía entera. Empieza una nueva para que salga más barato.</p>` : ""}
    <div class="stack" style="gap:8px">
      <form id="iaForm" class="composer"><textarea class="input" id="iaText" rows="1" placeholder="Escribe tu duda…" aria-label="Tu pregunta" enterkeyhint="send">${esc(st.draft)}</textarea>${busy ? `<button class="btn" type="button" data-act="iaStop">Parar</button>` : `<button class="btn" type="submit">Enviar</button>`}</form>
      <div class="spread small muted"><span>${MODELS[model()].name} · esta conversación: ${money(c.cost || 0)} aprox.</span>${c.msgs.length && !busy ? (st.newAsk ? `<span class="confirm"><span>¿Borrarla?</span><button class="btn danger sm" data-act="iaNew">Borrar</button><button class="btn quiet sm" data-act="iaNewNo">No</button></span>` : `<button class="link small" data-act="iaNewAsk">Nueva conversación</button>`) : ""}</div>
    </div>
  </div>`;
};

// Duda desde una pregunta corregida (o desde un tema): deja el texto preparado en la caja, sin enviarlo.
function askDraft(a) {
  const t = S.topics[a.tid]; if (!t) return;
  st.sid = t.subject; lsSet("ia_sid", st.sid); st.err = null;
  const q = a.qid && findQ(a.tid, a.qid);
  if (!q) { st.draft = `Sobre el ${t.code} (${t.title}): `; return; }
  const ord = String(a.ord || "").split(",").map(Number).filter(i => q.opts[i] != null);
  const order = ord.length === q.opts.length ? ord : q.opts.map((_, i) => i);
  const L = i => LET[order.indexOf(i)];
  st.draft = [`Tengo una duda con esta pregunta del ${t.code} (${t.title}):`, "", `«${q.q}»`, ...order.map((i, p) => `${LET[p]}) ${q.opts[i]}`), "",
    `La correcta es la ${L(q.a)}.` + (a.a == null ? " La dejé en blanco." : a.a !== q.a ? ` Yo marqué la ${L(a.a)}.` : ""),
    ...(q.exp ? [`Explicación de la app: ${q.exp}`] : []), ...(q.src && q.src.pg ? [`En los apuntes: ${srcText(q.src, a.tid)}${q.src.sec ? " (" + q.src.sec + ")" : ""}`] : []),
    "", "¿Me lo explicas?"].join("\n");
}

Object.assign(A, {
  iaSub: el => { if (st.busy) return; st.sid = el.dataset.s; lsSet("ia_sid", st.sid); st.err = null; st.newAsk = false; render(); },
  iaSug: el => send(el.dataset.k),
  iaStop: () => { if (st.ctrl) st.ctrl.abort(); },
  iaNewAsk: () => { st.newAsk = true; render(); },
  iaNewNo: () => { st.newAsk = false; render(); },
  iaNew: () => { delete st.chats[st.sid]; st.newAsk = false; st.err = null; saveChats(); render(); },
  iaCfg: () => go("ia", { cfg: 1 }),
  iaChatGo: () => go("ia", {}, "replace"),
  iaKeyDel: () => { try { localStorage.removeItem("prl:ia_key"); } catch (_) {} toast("Clave borrada de este dispositivo"); render(); }
});
Object.assign(C, { iaModel: el => { lsSet("ia_model", el.value); toast(`Modelo: ${MODELS[el.value].name}`); } });

document.addEventListener("submit", async e => {
  const f = e.target;
  if (f.id === "iaForm") { e.preventDefault(); const t = $("#iaText"); send(t ? t.value : ""); }
  if (f.id === "iaKeyForm") {
    e.preventDefault();
    const k = ($("#iaKey").value || "").trim();
    if (!/^sk-ant-[\w-]{20,}$/.test(k)) return toast("Eso no parece una clave de Anthropic (empieza por sk-ant-).");
    // Se comprueba gratis pidiendo la lista de modelos; si no hay conexión, se guarda igualmente.
    let ok = true, note = "";
    try { const r = await fetch(API + "/v1/models?limit=1", { headers: headers(k) }); if (r.status === 401 || r.status === 403) ok = false; else if (!r.ok) note = " (no se ha podido comprobar)"; }
    catch (_) { note = " (no se ha podido comprobar)"; }
    if (!ok) return toast("Anthropic dice que esa clave no es válida.");
    lsSet("ia_key", k); toast("Clave guardada" + note); go("ia", {}, "replace");
  }
});
document.addEventListener("input", e => {
  if (e.target.id !== "iaText") return;
  st.draft = e.target.value; fitText(e.target);
});
document.addEventListener("keydown", e => {
  if (e.target.id !== "iaText" || e.key !== "Enter" || e.shiftKey || e.isComposing) return;
  try { if (matchMedia("(pointer: coarse)").matches) return; } catch (_) {} // en el móvil, Intro hace salto de línea
  e.preventDefault(); if (!st.busy) send(e.target.value);
});

if (S.view === "ia") render();
})();
