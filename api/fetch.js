/* POST /api/fetch — reads one public web page (a link to a post or article) through the
   Parallel Extract API, so the visitor does not have to copy the text. Body: { url: string } */
"use strict";
const S = require("../lib/server.js");

const PRIVATE = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.|\[?::1\]?$|.*\.local$|.*\.internal$)/i;

module.exports = async (req, res) => {
  try {
    S.guard(req);
    const b = await S.body(req);
    const raw = S.str(b.url, 1000, "The link", true).trim();
    let u;
    try { u = new URL(raw); } catch { throw new S.ApiError(400, "bad_request", "That doesn't look like a web address."); }
    if (!/^https?:$/.test(u.protocol) || PRIVATE.test(u.hostname)) throw new S.ApiError(400, "bad_request", "Only public web pages can be loaded.");
    await S.limit(req, "search");
    const j = await S.parallel("/v1/extract", {
      urls: [u.href], objective: "Read the full text of this page or post",
      advanced_settings: { full_content: { max_chars_per_result: 40000 } }
    });
    S.send(res, 200, { results: Array.isArray(j.results) ? j.results : [], errors: Array.isArray(j.errors) ? j.errors : [] });
  } catch (e) { S.fail(res, e); }
};
