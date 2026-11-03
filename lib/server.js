/* Shared helpers for the ClearSignal API: input checks, rate limits, Claude and Parallel calls.
   API keys only ever live in environment variables on the server. */
"use strict";

const env = (k, d) => (process.env[k] === undefined || process.env[k] === "" ? d : process.env[k]);
const ANTHROPIC_BASE = () => env("ANTHROPIC_BASE_URL", "https://api.anthropic.com").replace(/\/$/, "");
const PARALLEL_BASE = () => env("PARALLEL_BASE_URL", "https://api.parallel.ai").replace(/\/$/, "");

class ApiError extends Error {
  constructor(status, code, message) { super(message || code); this.status = status; this.code = code; }
}

function send(res, status, obj) {
  if (res.headersSent) { try { res.end(); } catch { /* closed */ } return; }
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(obj));
}
function fail(res, e) {
  if (e instanceof ApiError) return send(res, e.status, { code: e.code, message: e.message });
  console.error(e);
  return send(res, 500, { code: "upstream_error", message: "Something went wrong on the server." });
}

/* Only this site may call the API: browsers send Origin on POST, and it must be our own host. */
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  try { return new URL(origin).host === host; } catch { return false; }
}
function clientIp(req) {
  const xf = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return xf || String(req.headers["x-real-ip"] || "") || (req.socket && req.socket.remoteAddress) || "unknown";
}
async function body(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") { try { return JSON.parse(req.body); } catch { throw new ApiError(400, "bad_request", "The request is not valid JSON."); } }
  return {};
}
function guard(req) {
  if (req.method !== "POST") throw new ApiError(405, "bad_request", "Use POST.");
  if (!sameOrigin(req)) throw new ApiError(403, "forbidden", "This API only serves the ClearSignal site.");
}

/* ---------- input checks ---------- */
const str = (v, max, name, required) => {
  if (v === undefined || v === null) { if (required) throw new ApiError(400, "bad_request", `${name} is missing.`); return ""; }
  if (typeof v !== "string") throw new ApiError(400, "bad_request", `${name} must be text.`);
  if (v.length > max) throw new ApiError(413, "prompt_too_large", `${name} is too long.`);
  if (required && !v.trim()) throw new ApiError(400, "bad_request", `${name} is empty.`);
  return v;
};
const arr = (v, max, name) => {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new ApiError(400, "bad_request", `${name} must be a list.`);
  if (v.length > max) throw new ApiError(413, "prompt_too_large", `Too many ${name}.`);
  return v;
};
function isoDay(v) {
  const today = new Date().toISOString().slice(0, 10);
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return today;
  const diff = Math.abs(Date.parse(v + "T12:00:00Z") - Date.parse(today + "T12:00:00Z"));
  return diff <= 2 * 864e5 ? v : today; // the visitor's own date, within a day or two of ours
}

/* ---------- rate limits: per visitor per hour, and per day for the whole site ----------
   With Upstash Redis configured the counts are shared by every server instance;
   without it each instance counts on its own, which still stops a single visitor hammering it. */
const mem = new Map();
function memIncr(key, ttl) {
  const now = Date.now();
  if (mem.size > 5000) for (const [k, v] of mem) if (v.exp < now) mem.delete(k);
  const e = mem.get(key);
  if (!e || e.exp < now) { mem.set(key, { n: 1, exp: now + ttl * 1000 }); return 1; }
  e.n++; return e.n;
}
async function limit(req, bucket) {
  const per = Number(env(bucket === "ai" ? "CS_AI_PER_HOUR" : "CS_SEARCH_PER_HOUR", 40));
  const daily = Number(env(bucket === "ai" ? "CS_AI_PER_DAY" : "CS_SEARCH_PER_DAY", 800));
  const ip = clientIp(req);
  const hour = Math.floor(Date.now() / 3600e3), day = new Date().toISOString().slice(0, 10);
  const k1 = `cs:${bucket}:ip:${ip}:${hour}`, k2 = `cs:${bucket}:day:${day}`;
  let n1, n2;
  const url = env("UPSTASH_REDIS_REST_URL", env("KV_REST_API_URL", "")), tok = env("UPSTASH_REDIS_REST_TOKEN", env("KV_REST_API_TOKEN", ""));
  if (url && tok) {
    try {
      const r = await fetch(url.replace(/\/$/, "") + "/pipeline", {
        method: "POST", headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
        body: JSON.stringify([["INCR", k1], ["EXPIRE", k1, 3700], ["INCR", k2], ["EXPIRE", k2, 90000]])
      });
      const j = await r.json();
      n1 = Number(j[0] && j[0].result); n2 = Number(j[2] && j[2].result);
    } catch (e) { console.error("rate limit store", e); }
  }
  if (!Number.isFinite(n1) || !Number.isFinite(n2)) { n1 = memIncr(k1, 3700); n2 = memIncr(k2, 90000); }
  if (n2 > daily) throw new ApiError(429, "rate_limited", "ClearSignal has reached its daily limit. Try again tomorrow.");
  if (n1 > per) throw new ApiError(429, "rate_limited", "Too many checks from this connection in the last hour. Try again later.");
}

/* ---------- Claude ---------- */
function claudeHeaders() {
  const key = env("ANTHROPIC_API_KEY", "");
  if (!key) throw new ApiError(500, "not_configured", "The server has no Claude API key yet.");
  return { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" };
}
async function claudeError(r) {
  let j = {}; try { j = await r.json(); } catch { /* not json */ }
  const msg = (j.error && j.error.message) || "";
  if (r.status === 400 && /too long|too many tokens|context/i.test(msg)) return new ApiError(413, "prompt_too_large", "This source is too long for one analysis.");
  if (r.status === 429 || r.status === 529) return new ApiError(503, "overloaded", "Claude is busy. Try again in a moment.");
  if (r.status === 401 || r.status === 403) return new ApiError(500, "not_configured", "The server's Claude API key is not accepted.");
  console.error("claude", r.status, msg);
  return new ApiError(502, "upstream_error", "Claude did not answer.");
}
async function claude(payload, signal) {
  const r = await fetch(ANTHROPIC_BASE() + "/v1/messages", { method: "POST", headers: claudeHeaders(), body: JSON.stringify(payload), signal });
  if (!r.ok) throw await claudeError(r);
  const j = await r.json();
  const text = (j.content || []).filter(c => c.type === "text").map(c => c.text).join("");
  return { text, truncated: j.stop_reason === "max_tokens" };
}
/* Streams Claude's text straight through as plain text. */
async function streamClaude(req, res, payload) {
  const ctl = new AbortController();
  req.on("close", () => { if (!res.writableEnded) ctl.abort(); });
  const r = await fetch(ANTHROPIC_BASE() + "/v1/messages", { method: "POST", headers: claudeHeaders(), body: JSON.stringify(Object.assign({}, payload, { stream: true })), signal: ctl.signal });
  if (!r.ok) throw await claudeError(r);
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Accel-Buffering", "no");
  const reader = r.body.getReader(), dec = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line.startsWith("data:")) continue;
        let ev; try { ev = JSON.parse(line.slice(5)); } catch { continue; }
        if (ev.type === "content_block_delta" && ev.delta && ev.delta.type === "text_delta" && ev.delta.text) res.write(ev.delta.text);
        else if (ev.type === "error") console.error("claude stream", ev.error);
      }
    }
  } catch (e) { if (!ctl.signal.aborted) console.error("stream", e); }
  res.end();
}
/* Claude's JSON answer: the outermost object in the reply. */
function parseJson(text) {
  const s = String(text || "").replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(s.slice(a, b + 1)); } catch { return null; }
}

/* ---------- Parallel ---------- */
async function parallel(path, payload) {
  const key = env("PARALLEL_API_KEY", "");
  if (!key) throw new ApiError(500, "not_configured", "The server has no Parallel API key yet.");
  const r = await fetch(PARALLEL_BASE() + path, { method: "POST", headers: { "x-api-key": key, "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  if (!r.ok) {
    let j = {}; try { j = await r.json(); } catch { /* not json */ }
    console.error("parallel", path, r.status, JSON.stringify(j).slice(0, 300));
    if (r.status === 429) throw new ApiError(503, "overloaded", "The web search is busy. Try again in a moment.");
    if (r.status === 401 || r.status === 403) throw new ApiError(500, "not_configured", "The server's Parallel API key is not accepted.");
    throw new ApiError(502, "upstream_error", "The web search did not answer.");
  }
  return r.json();
}

module.exports = { env, ApiError, send, fail, guard, body, str, arr, isoDay, limit, claude, streamClaude, parseJson, parallel, clientIp };
