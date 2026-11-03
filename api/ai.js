/* POST /api/ai — runs one named Claude task. The server builds every prompt itself from the
   visitor's input (the same prompt builders as the page), so this cannot be used as a general
   Claude proxy. Body: { task: "signals" | "transcribe" | "claims" | "assess", args: {...} } */
"use strict";
const M = require("../lib/logic.js");
const S = require("../lib/server.js");

const MODEL = () => S.env("CS_MODEL", "claude-sonnet-5-5");
const FAST = () => S.env("CS_MODEL_FAST", "claude-haiku-5-5");
const MEDIA = ["image/jpeg", "image/png", "image/webp", "image/gif"];

const TASKS = {
  /* the 20 indicators, streamed as JSON lines */
  signals: {
    stream: true, model: MODEL, max: 8000,
    clean: a => {
      const ids = S.arr(a.ids, 20, "indicators").map(Number);
      if (!ids.length || ids.some(n => !Number.isInteger(n) || n < 1 || n > 20) || new Set(ids).size !== ids.length) throw new S.ApiError(400, "bad_request", "Unknown indicators.");
      return {
        text: S.str(a.text, 20000, "The text", true), title: S.str(a.title, 300, "The title"), ids, withQ: a.withQ === true,
        notes: S.arr(a.notes, 6, "notes").map((n, k) => S.str(n, 300, "Note " + (k + 1)))
      };
    }
  },
  /* reads up to four screenshots */
  transcribe: {
    model: MODEL, max: 4000, images: true,
    clean: a => {
      const images = S.arr(a.images, 4, "images").map((im, k) => {
        if (!im || !MEDIA.includes(im.type)) throw new S.ApiError(400, "image_rejected", "Use JPEG, PNG or WebP images.");
        const data = S.str(im.data, 2800000, "Image " + (k + 1), true);
        if (!/^[A-Za-z0-9+/=]+$/.test(data)) throw new S.ApiError(400, "image_rejected", "An image could not be read.");
        return { type: im.type, data };
      });
      if (!images.length) throw new S.ApiError(400, "bad_request", "No image was sent.");
      return { images, count: images.length };
    }
  },
  /* the checkable claims and a search query for each */
  claims: {
    model: FAST, max: 1200,
    clean: a => ({ text: S.str(a.text, 20000, "The text", true), date: S.isoDay(a.date) })
  },
  /* weighs the claims against the pages the search returned */
  assess: {
    model: MODEL, max: 3000,
    clean: a => {
      const claims = S.arr(a.claims, 3, "claims").map((c, k) => ({ claim: S.str(c && c.claim, 300, "Claim " + (k + 1), true), query: S.str(c && c.query, 160, "Query " + (k + 1)) }));
      const pages = S.arr(a.pages, 8, "pages").map((p, k) => {
        const id = String(p && p.id || "");
        if (!/^p\d{1,2}$/.test(id)) throw new S.ApiError(400, "bad_request", "Unknown page.");
        const url = S.str(p.url, 900, "Page address", true);
        if (!/^https?:\/\//i.test(url)) throw new S.ApiError(400, "bad_request", "Page addresses must be web links.");
        const date = typeof p.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(p.date) ? p.date : "";
        return { id, url, date, title: S.str(p.title, 300, "Page title"), host: S.str(p.host, 200, "Page host"), text: S.str(p.text, 6500, "Page " + (k + 1), true) };
      });
      if (!claims.length || !pages.length) throw new S.ApiError(400, "bad_request", "Nothing to weigh.");
      return { claims, pages, date: S.isoDay(a.date) };
    }
  }
};

module.exports = async (req, res) => {
  try {
    S.guard(req);
    const b = await S.body(req);
    const t = TASKS[b.task];
    if (!t) throw new S.ApiError(400, "bad_request", "Unknown task.");
    const args = t.clean(b.args || {});
    await S.limit(req, "ai");
    const prompt = M.PROMPTS[b.task](args);
    const content = t.images
      ? [...args.images.map(im => ({ type: "image", source: { type: "base64", media_type: im.type, data: im.data } })), { type: "text", text: prompt }]
      : prompt;
    const payload = { model: t.model(), max_tokens: t.max, messages: [{ role: "user", content }] };
    if (t.stream) return await S.streamClaude(req, res, payload);
    const out = await S.claude(payload);
    const value = S.parseJson(out.text);
    if (!value) throw new S.ApiError(502, "invalid_json", "Claude's answer came back incomplete. Try again.");
    S.send(res, 200, { value, truncated: out.truncated });
  } catch (e) { S.fail(res, e); }
};
