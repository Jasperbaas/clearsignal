/* ClearSignal, hosted. The page was built to run inside claude.ai, where it asks the viewer's own
   Claude and connectors. Here the same page talks to this site's own server instead:
   Claude tasks go to /api/ai, web searches to /api/search, links to /api/fetch.
   Every check is fresh; a call that asks for caching may reuse an answer from the last six hours. */
window.__CLEARSIGNAL_HOSTED = true;
(() => {
  "use strict";
  const KEEP = 6 * 3600 * 1000;
  const hash = async s => {
    const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
    return "cs1:" + [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
  };
  const cacheGet = k => {
    try { const v = JSON.parse(localStorage.getItem(k)); if (v && Date.now() - v.t < KEEP) return v.v; } catch { /* storage off */ }
    return undefined;
  };
  const cacheSet = (k, v) => {
    const put = () => localStorage.setItem(k, JSON.stringify({ t: Date.now(), v }));
    try { put(); } catch {
      try { Object.keys(localStorage).filter(x => x.startsWith("cs1:")).forEach(x => localStorage.removeItem(x)); put(); } catch { /* storage full or off */ }
    }
  };
  async function post(path, body, signal) {
    let r;
    try { r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal }); }
    catch { throw { code: signal && signal.aborted ? "cancelled" : "upstream_error", message: "The connection to ClearSignal failed." }; }
    if (!r.ok) {
      let j = {}; try { j = await r.json(); } catch { /* not json */ }
      throw { code: j.code || (r.status === 429 ? "rate_limited" : "upstream_error"), message: j.message || "Request failed", retryable: r.status >= 500 };
    }
    return r;
  }
  /* screenshots go up as JPEG, at most 1600 pixels on the long side */
  async function shrink(blob) {
    const bmp = await createImageBitmap(blob);
    const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(bmp.width * k)); c.height = Math.max(1, Math.round(bmp.height * k));
    const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.drawImage(bmp, 0, 0, c.width, c.height);
    const out = await new Promise(res => c.toBlob(res, "image/jpeg", 0.85));
    const data = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(",")[1]); fr.onerror = rej; fr.readAsDataURL(out); });
    return { type: "image/jpeg", data };
  }
  const refreshing = o => !!(o && o.cache && o.cache.refresh);
  const caching = o => !!(o && o.cache);

  /* sample: only named tasks; the server never takes a raw prompt */
  const sample = async () => { throw { code: "not_declared", message: "Use a named task." }; };
  sample.json = sample;
  sample.limits = async () => ({ images: { maxCount: 4, maxInputBytes: 20000000, mediaTypes: ["image/png", "image/jpeg", "image/webp"] } });
  sample.task = async (task, args, o = {}) => {
    const key = await hash("ai|" + task + "|" + JSON.stringify(args));
    if (caching(o) && !refreshing(o)) {
      const hit = cacheGet(key);
      if (typeof hit === "string") { if (o.onText) o.onText({ text: hit, delta: hit }); return { text: hit, truncated: false }; }
    }
    const r = await post("/api/ai", { task, args }, o.signal);
    const reader = r.body.getReader(), dec = new TextDecoder();
    let text = "";
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const delta = dec.decode(value, { stream: true });
        if (!delta) continue;
        text += delta;
        if (o.onText) o.onText({ text, delta });
      }
    } catch { throw { code: o.signal && o.signal.aborted ? "cancelled" : "upstream_error", text }; }
    if (caching(o) && text.length > 200) cacheSet(key, text);
    return { text, truncated: false };
  };
  sample.taskJson = async (task, args, o = {}) => {
    const send = Object.assign({}, args);
    if (o.images && o.images.length) send.images = await Promise.all([...o.images].map(shrink));
    const key = send.images || !caching(o) ? null : await hash("ai|" + task + "|" + JSON.stringify(send));
    if (key && !refreshing(o)) { const hit = cacheGet(key); if (hit !== undefined) return hit; }
    const r = await post("/api/ai", { task, args: send }, o.signal);
    const j = await r.json();
    if (j && j.value !== undefined) { if (key) cacheSet(key, j.value); return j.value; }
    throw { code: "invalid_json" };
  };

  /* mcp: the page's "Parallel Search" connector becomes this site's search API */
  const mcp = {
    callTool: async (server, tool, input, o = {}) => {
      if (server !== "Parallel Search") throw { code: "server_not_connected", message: "Not part of the hosted app.", server };
      const path = tool === "web_search" ? "/api/search" : tool === "web_fetch" ? "/api/fetch" : "";
      if (!path) throw { code: "not_in_manifest", server };
      const body = tool === "web_search" ? { objective: input.objective, search_queries: input.search_queries } : { url: (input.urls || [])[0] };
      const useCache = !!(o && o.cache);
      const key = await hash(path + "|" + JSON.stringify(body));
      if (useCache && !refreshing(o)) { const hit = cacheGet(key); if (hit !== undefined) return { content: [], structuredContent: hit, payload: hit }; }
      const r = await post(path, body, o.signal);
      const j = await r.json();
      if (useCache) cacheSet(key, j);
      return { content: [{ type: "text", text: JSON.stringify(j) }], structuredContent: j, payload: j };
    },
    listTools: async () => ({ servers: [{ server: "Parallel Search", authStatus: "connected", tools: [{ name: "web_search", description: "" }, { name: "web_fetch", description: "" }] }] })
  };

  /* downloads: a normal file download */
  const downloads = {
    save: async ({ filename, data }) => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([data], { type: "text/html;charset=utf-8" }));
      a.download = filename; document.body.append(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
      return { status: "saved" };
    }
  };

  window.claude = Object.freeze({ use: async name => name === "sample" ? sample : name === "mcp" ? mcp : name === "downloads" ? downloads : null });
})();
