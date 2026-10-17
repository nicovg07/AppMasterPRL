// Conexión con Claude a través de la API de Anthropic, con la clave que guardas en Ajustes.
// La clave se queda en este navegador (localStorage) y solo se envía a api.anthropic.com.
// Misma forma de uso que en la app original: AI.sample(prompt, opts) y AI.sample.json(prompt, opts).
(function () {
  const KEY = "prl:apikey";
  const getKey = () => { try { return localStorage.getItem(KEY) || ""; } catch (_) { return ""; } };

  function parseLoose(text) {
    const t = text.trim();
    try { return JSON.parse(t); } catch (_) {}
    const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) { try { return JSON.parse(fence[1]); } catch (_) {} }
    const a = t.search(/[[{]/), b = Math.max(t.lastIndexOf("}"), t.lastIndexOf("]"));
    if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch (_) {} }
    return undefined;
  }

  async function call(input, opts = {}, wantJson = false) {
    const key = getKey();
    if (!key) throw { code: "no_key", message: "Falta la clave de API" };
    const quick = opts.modelTier === "quick";
    const model = (window.CONFIG && CONFIG.models && (quick ? CONFIG.models.quick : CONFIG.models.default)) || "claude-sonnet-5-5";
    const messages = typeof input === "string" ? [{ role: "user", content: input }] : input;
    if (wantJson) messages[messages.length - 1] = { role: "user", content: messages[messages.length - 1].content + "\n\nTu respuesta se leerá con un programa: devuelve solo el JSON, sin texto antes ni después." };
    let res;
    try {
      res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST", signal: opts.signal,
        headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
        body: JSON.stringify({ model, max_tokens: opts.maxTokens || (quick ? 1200 : 16000), messages })
      });
    } catch (e) {
      if (e && e.name === "AbortError") throw { code: "cancelled" };
      throw { code: "upstream_error", message: String(e) };
    }
    if (!res.ok) {
      let msg = ""; try { msg = (await res.json()).error?.message || ""; } catch (_) {}
      const code = res.status === 401 || res.status === 403 ? "bad_key" : res.status === 429 ? "rate_limited" : res.status === 413 || /too long|too large/i.test(msg) ? "prompt_too_large" : res.status === 400 && /credit|billing/i.test(msg) ? "no_credit" : res.status === 404 ? "bad_model" : res.status >= 500 ? "overloaded" : "upstream_error";
      throw { code, message: msg || "HTTP " + res.status };
    }
    const j = await res.json();
    const text = (j.content || []).filter(b => b.type === "text").map(b => b.text).join("");
    if (!text.trim()) throw { code: "empty_completion" };
    if (opts.onText) { try { opts.onText({ text, delta: text }); } catch (_) {} }
    return { text, truncated: j.stop_reason === "max_tokens" };
  }

  const sample = (input, opts) => call(input, opts, false);
  sample.json = async (input, opts) => {
    const r = await call(input, opts, true);
    const v = parseLoose(r.text);
    if (v === undefined || r.truncated) throw { code: "invalid_json", text: r.text };
    return v;
  };

  window.AI = {
    sample,
    hasKey: () => !!getKey(),
    getKey,
    setKey(k) { try { if (k) localStorage.setItem(KEY, k.trim()); else localStorage.removeItem(KEY); } catch (_) {} },
    // Comprueba la clave con una llamada mínima.
    async test() { await call("Responde solo: ok", { modelTier: "quick", maxTokens: 5 }); return true; }
  };
})();
