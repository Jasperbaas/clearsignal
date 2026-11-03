/* Local preview without the Vercel CLI: serves public/ and the api/ functions.
   Run: ANTHROPIC_API_KEY=... PARALLEL_API_KEY=... node dev-server.js  (then open http://localhost:3000) */
"use strict";
const http = require("http"), fs = require("fs"), path = require("path");
const PORT = Number(process.env.PORT || 3000), ROOT = path.join(__dirname, "public");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".jpg": "image/jpeg", ".png": "image/png", ".mp4": "video/mp4", ".webm": "video/webm", ".json": "application/json" };
http.createServer((req, res) => {
  const u = new URL(req.url, "http://localhost");
  const api = u.pathname.match(/^\/api\/([a-z]+)$/);
  if (api) {
    const file = path.join(__dirname, "api", api[1] + ".js");
    if (!fs.existsSync(file)) { res.statusCode = 404; return res.end("Not found"); }
    let raw = "";
    req.on("data", c => { raw += c; if (raw.length > 4.5e6) req.destroy(); });
    req.on("end", () => {
      try { req.body = raw ? JSON.parse(raw) : {}; } catch { req.body = raw; }
      Promise.resolve(require(file)(req, res)).catch(e => { console.error(e); res.statusCode = 500; res.end(); });
    });
    return;
  }
  let p = path.normalize(decodeURIComponent(u.pathname)).replace(/^(\.\.[/\\])+/, "");
  if (p === "/" || p === "\\") p = "/index.html";
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.statusCode = 404; return res.end("Not found"); }
  res.setHeader("Content-Type", TYPES[path.extname(f)] || "application/octet-stream");
  fs.createReadStream(f).pipe(res);
}).listen(PORT, () => console.log(`ClearSignal on http://localhost:${PORT}`));
