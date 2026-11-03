/* POST /api/search — one web search for one claim, through the Parallel Search API.
   Body: { objective: string, search_queries: string[] } */
"use strict";
const S = require("../lib/server.js");

module.exports = async (req, res) => {
  try {
    S.guard(req);
    const b = await S.body(req);
    const objective = S.str(b.objective, 600, "The objective", true);
    const queries = S.arr(b.search_queries, 3, "queries").map((q, k) => S.str(q, 140, "Query " + (k + 1), true));
    if (!queries.length) throw new S.ApiError(400, "bad_request", "No search query.");
    await S.limit(req, "search");
    const payload = { objective, search_queries: queries, max_chars_total: 30000, advanced_settings: { max_results: 10, excerpt_settings: { max_chars_per_result: 3000 } } };
    const mode = S.env("CS_SEARCH_MODE", "");
    if (mode) payload.mode = mode;
    const j = await S.parallel("/v1/search", payload);
    S.send(res, 200, { search_id: j.search_id, results: Array.isArray(j.results) ? j.results : [] });
  } catch (e) { S.fail(res, e); }
};
