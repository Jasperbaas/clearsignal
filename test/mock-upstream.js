/* Test double for the Claude and Parallel APIs, so the app can be tested without real keys.
   Run: node test/mock-upstream.js  (listens on 9101), then start the dev server with
   ANTHROPIC_BASE_URL=http://127.0.0.1:9101 PARALLEL_BASE_URL=http://127.0.0.1:9101 */
"use strict";
const http = require("http"), fs = require("fs"), path = require("path");
const logic = fs.readFileSync(path.join(__dirname, "../lib/logic.js"), "utf8");
const td = fs.readFileSync(path.join(__dirname, "testdata.js"), "utf8").replace("module.exports={DEMO,demoRaw};", "");
const T = new Function(logic + "\nconst IND = MMSA.IND;\n" + td + "; return { demoRaw };")();
const A = T.demoRaw("A"), B = T.demoRaw("B");
const log = [];

const mk = (raw, ids, withQ) => {
  const lines = raw.indicators.filter(x => ids.includes(x.id)).map(x => JSON.stringify(x));
  if (withQ) lines.push(JSON.stringify({ questions_to_ask_next: ["Which account first posted this?", "Is the footage older than the post?"], verify: [{ id: "tineye", why: "Check whether the missile footage is older than the post" }, { id: "reuters", why: "See if a news agency reported the strikes" }] }));
  return lines.join("\n");
};
const textOf = m => typeof m.content === "string" ? m.content : m.content.filter(c => c.type === "text").map(c => c.text).join("\n");
function claudeReply(body) {
  const prompt = textOf(body.messages[0]);
  const hasImg = Array.isArray(body.messages[0].content) && body.messages[0].content.some(c => c.type === "image");
  if (hasImg) { log.push("transcribe"); return JSON.stringify({ label: "Post on X with a video", text: "BREAKING: WORLD WAR 3 HAS BEGUN. Tonight the enemy launched hundreds of missiles and the world will never be the same. Share this before it gets deleted.", visual_notes: ["Video thumbnail with missile trails"] }); }
  if (prompt.includes("fact-checking team")) {
    log.push("claims");
    if (prompt.includes("Overnight, air-defence")) return JSON.stringify({ claims: [{ claim: "Air-defence units intercepted most drones and missiles overnight", query: "air defence intercepted drones missiles" }] });
    return JSON.stringify({ claims: [{ claim: "World War 3 has begun with hundreds of missiles launched tonight", query: "world war 3 has begun" }, { claim: "Mainstream media is hiding the attack", query: "media hiding missile attack" }] });
  }
  if (prompt.includes("CLAIMS:")) {
    log.push("assess");
    if (prompt.includes("Air-defence units")) return JSON.stringify({ claims: [{ i: 0, verdict: "not_found", coverage_expected: false, explanation: "No page reports this interception.", evidence: [] }], summary: "x" });
    return "Here is the result:\n" + JSON.stringify({ claims: [
      { i: 0, verdict: "contradicted", coverage_expected: true, explanation: "The pages describe this as a false narrative; the conflict is regional.", evidence: [{ page: "p1", quote: "In reality, the conflict is regional" }], debunked_by: ["p1", "p2"], seen_before: { page: "p2", quote: "the footage shows a 2023 strike" } },
      { i: 1, verdict: "contradicted", coverage_expected: false, explanation: "Newsrooms reported the strikes the same evening.", evidence: [{ page: "p3", quote: "Newsrooms reported the regional strikes the same evening, so there was no media blackout." }], debunked_by: ["p3"], seen_before: null }
    ], summary: "Not a world war." });
  }
  log.push("signals");
  const raw = prompt.includes("Overnight, air-defence") ? B : A;
  const second = prompt.includes("in this order: 11,");
  return mk(raw, second ? [11, 12, 13, 14, 15, 16, 17, 18, 19, 20] : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], second);
}
function searchResults(q) {
  if (/media/.test(q)) return [
    { url: "https://www.example-check.org/media-blackout-claim", title: "No, the media is not hiding a missile attack", publish_date: "2026-10-29", excerpts: ["Posts claim mainstream media is hiding a missile attack. " + "Newsrooms reported the regional strikes the same evening, so there was no media blackout. ".repeat(3)] },
    { url: "https://x.com/someone/status/2", title: "viral post", excerpts: ["a post"] }];
  if (/air defence/.test(q)) return [];
  return [
    { url: "https://www.veridica.ro/en/fake-news-world-war-iii-has-begun", title: "FAKE NEWS: World War III has begun | Veridica.ro", publish_date: "2026-03-20", excerpts: ["The attack led to the outbreak of World War III, according to a **false narrative** circulating widely online.\n\n...\n\nIn reality, the conflict is regional, and even in that area there have been other conflicts. ".repeat(2)] },
    { url: "https://www.reuters.com/fact-check/ww3-claim", title: "Fact Check: Has World War 3 begun?", publish_date: "2026-10-31", excerpts: ["Reuters found no evidence that World War 3 has begun. Hundreds of missiles were not launched at Europe last night; the footage shows a 2023 strike. ".repeat(2)] },
    { url: "https://www.flightatlas.org/history/2026/statistics", title: "Rocket Launch Statistics 2026", publish_date: "2026-11-02", excerpts: ["There have been many orbital launch attempts worldwide in 2026, and most launched successfully. ".repeat(3)] }];
}

http.createServer((req, res) => {
  let raw = "";
  req.on("data", c => raw += c);
  req.on("end", async () => {
    const body = raw ? JSON.parse(raw) : {};
    const json = (s, o) => { res.writeHead(s, { "Content-Type": "application/json" }); res.end(JSON.stringify(o)); };
    if (req.url === "/__log") return json(200, log);
    if (req.url === "/v1/messages") {
      if (req.headers["x-api-key"] !== "test-anthropic") return json(401, { type: "error", error: { type: "authentication_error", message: "bad key" } });
      const text = claudeReply(body);
      if (!body.stream) return json(200, { id: "m", type: "message", role: "assistant", content: [{ type: "text", text }], stop_reason: "end_turn" });
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      const ev = (t, d) => res.write(`event: ${t}\ndata: ${JSON.stringify(Object.assign({ type: t }, d))}\n\n`);
      ev("message_start", { message: { id: "m", content: [] } });
      ev("content_block_start", { index: 0, content_block: { type: "text", text: "" } });
      for (const c of text.match(/[\s\S]{1,90}/g)) { await new Promise(r => setTimeout(r, 25)); ev("content_block_delta", { index: 0, delta: { type: "text_delta", text: c } }); }
      ev("content_block_stop", { index: 0 }); ev("message_delta", { delta: { stop_reason: "end_turn" } }); ev("message_stop", {});
      return res.end();
    }
    if (req.url === "/v1/search") {
      if (req.headers["x-api-key"] !== "test-parallel") return json(401, { type: "error", error: { message: "bad key" } });
      log.push("search:" + body.search_queries.join("|"));
      return json(200, { search_id: "s1", results: searchResults(body.search_queries.join(" ")), session_id: "s" });
    }
    if (req.url === "/v1/extract") {
      log.push("extract");
      return json(200, { extract_id: "e", results: [{ url: body.urls[0], title: "Overnight interceptions reported", publish_date: "2026-11-01", excerpts: [], full_content: "# Overnight interceptions reported\n\nOvernight, air-defence units intercepted most of the drones and missiles launched toward the country, the defence ministry said in a statement on Sunday. Officials in the neighbouring country did not respond to requests for comment." }], errors: [], session_id: "s" });
    }
    json(404, {});
  });
}).listen(9101, () => console.log("mock upstream on 9101"));
