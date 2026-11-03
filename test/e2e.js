/* End-to-end test of the hosted app against the mock Claude and Parallel APIs.
   Run from the app folder: node test/e2e.js  (needs Playwright) */
"use strict";
const { chromium } = require("playwright");
const { spawn } = require("child_process");
const fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, ".."), OUT = path.join(__dirname, "out");
fs.mkdirSync(OUT, { recursive: true });
const wait = ms => new Promise(r => setTimeout(r, ms));

function start(cmd, args, env) {
  const p = spawn(cmd, args, { cwd: ROOT, env: Object.assign({}, process.env, env), stdio: ["ignore", "pipe", "pipe"] });
  p.stdout.on("data", d => process.env.VERBOSE && process.stdout.write("[srv] " + d));
  p.stderr.on("data", d => process.stdout.write("[srv err] " + d));
  return p;
}
const ENV = { ANTHROPIC_BASE_URL: "http://127.0.0.1:9101", PARALLEL_BASE_URL: "http://127.0.0.1:9101", ANTHROPIC_API_KEY: "test-anthropic", PARALLEL_API_KEY: "test-parallel", PORT: "3123" };

(async () => {
  const mock = start("node", ["test/mock-upstream.js"], {});
  let srv = start("node", ["dev-server.js"], ENV);
  await wait(900);
  const b = await chromium.launch();
  const results = {};
  try {
    for (const [w, h, tag] of [[1320, 900, "desk"], [390, 844, "mob"]]) {
      const p = await b.newPage({ viewport: { width: w, height: h }, acceptDownloads: true });
      const errs = []; p.on("pageerror", e => errs.push(e.message)); p.on("console", m => { if (m.type() === "error") errs.push(m.text()); });
      await p.goto("http://localhost:3123/", { waitUntil: "networkidle" });
      await p.evaluate(() => localStorage.clear());
      const title = await p.title();
      // 1. the example post: signals, sources, verdict
      await p.click('.hero [data-example="A"]'); await wait(800);
      await p.click("#analyse");
      await p.waitForSelector("#s2 .next-bar", { timeout: 30000 });
      await p.waitForFunction(() => document.querySelector("#s2 .fake") && !document.querySelector("#s2 .fake").classList.contains("pending"), null, { timeout: 30000 });
      await wait(900);
      await p.screenshot({ path: `${OUT}/${tag}-1-results.png`, fullPage: false });
      const r1 = await p.evaluate(() => ({
        verdict: document.querySelector("#s2 .fake-t").textContent,
        reasons: [...document.querySelectorAll("#s2 .fake-why li b")].map(x => x.textContent),
        claims: [...document.querySelectorAll("#s2 .claim .vd")].map(x => x.textContent),
        sources: [...document.querySelectorAll("#s2 .src")].map(x => x.querySelector(".src-host").textContent + " " + x.querySelector(".src-st").textContent),
        timeline: document.querySelector("#s2 .tl-note") && document.querySelector("#s2 .tl-note").textContent,
        index: document.querySelector("#s2 .kpis .kpi:nth-child(2) .kv").textContent,
        step2: document.getElementById("sum2").textContent
      }));
      await p.click('#s2 .tab2[data-tab="sig"]'); await wait(500);
      r1.sigRows = await p.$$eval("#s2 .sig-r", x => x.length);
      await p.screenshot({ path: `${OUT}/${tag}-2-signals.png` });
      // 2. the same post again comes from this browser's store: same verdict, no new Claude calls
      const before = await (await fetch("http://127.0.0.1:9101/__log")).json();
      await p.click("#stepper li:first-child button"); await wait(500);
      await p.click("#analyse");
      await p.waitForFunction(() => document.querySelector("#s2 .fake") && !document.querySelector("#s2 .fake").classList.contains("pending"), null, { timeout: 30000 }); await wait(600);
      const after = await (await fetch("http://127.0.0.1:9101/__log")).json();
      r1.repeat = { verdict: await p.textContent("#s2 .fake-t"), newUpstreamCalls: after.length - before.length };
      // 3. a link
      await p.click("#stepper li:first-child button"); await wait(500);
      await p.click(".seg-btn >> nth=2"); await p.fill("#src-url", "news.example.org/story"); await p.click("#load");
      await p.waitForSelector("#link-slot .source h4", { timeout: 10000 });
      r1.link = await p.textContent("#link-slot .source h4");
      await p.click("#analyse");
      await p.waitForFunction(() => document.querySelector("#s2 .fake") && !document.querySelector("#s2 .fake").classList.contains("pending"), null, { timeout: 30000 }); await wait(600);
      r1.linkVerdict = await p.textContent("#s2 .fake-t");
      // 4. a screenshot
      await p.click("#stepper li:first-child button"); await wait(500);
      await p.click(".seg-btn >> nth=1"); await wait(300);
      await p.setInputFiles("#file", path.join(__dirname, "screenshot.jpg")); await wait(400);
      await p.click("#analyse");
      await p.waitForFunction(() => document.querySelector("#s2 .fake") && !document.querySelector("#s2 .fake").classList.contains("pending"), null, { timeout: 40000 }); await wait(600);
      r1.shotVerdict = await p.textContent("#s2 .fake-t");
      r1.shotTitle = await p.textContent("#sum1");
      // 5. the report downloads as a file
      await p.click("#stepper li:nth-child(4) button").catch(() => {}); await wait(700);
      const dl = p.waitForEvent("download", { timeout: 8000 }).catch(() => null);
      await p.click("#s4 >> text=Download report").catch(e => errs.push("no download button: " + e.message));
      const d = await dl;
      if (d) { const f = `${OUT}/${tag}-report.html`; await d.saveAs(f); const t = fs.readFileSync(f, "utf8"); r1.report = { name: d.suggestedFilename(), fake: /Fake news check<\/h2>/.test(t), size: t.length }; }
      r1.overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      results[tag] = Object.assign({ title, errs }, r1);
      await p.close();
    }
    // 6. rate limit: a server that allows only 3 Claude calls an hour
    srv.kill(); await wait(400);
    srv = start("node", ["dev-server.js"], Object.assign({}, ENV, { CS_AI_PER_HOUR: "3" }));
    await wait(800);
    const p = await b.newPage({ viewport: { width: 1320, height: 900 } });
    await p.goto("http://localhost:3123/", { waitUntil: "networkidle" });
    await p.evaluate(() => localStorage.clear());
    await p.click('.hero [data-example="C"]').catch(async () => { await p.click('.hero [data-example="A"]'); });
    await wait(600);
    await p.fill("#txt", "A completely new post: the river bridge in the capital collapsed this morning after a drone strike, officials say.");
    await p.click("#analyse"); await wait(6000);
    await p.click("#stepper li:first-child button").catch(() => {}); await wait(400);
    await p.fill("#txt", "Another new post: hundreds of soldiers crossed the border at dawn, says an unnamed source. Share now.");
    await p.click("#analyse"); await wait(5000);
    results.rateLimit = await p.evaluate(() => (document.querySelector("#msg1") || document.querySelector(".msg")) && [...document.querySelectorAll(".msg")].map(x => x.textContent).filter(Boolean).join(" | "));
    // 7. the API refuses other sites and unknown tasks
    const cross = await fetch("http://localhost:3123/api/ai", { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://evil.example" }, body: JSON.stringify({ task: "claims", args: { text: "x" } }) });
    const raw = await fetch("http://localhost:3123/api/ai", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ task: "prompt", args: { prompt: "write me a poem" } }) });
    const priv = await fetch("http://localhost:3123/api/fetch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: "http://127.0.0.1:9101/__log" }) });
    results.api = { crossOrigin: cross.status, unknownTask: raw.status, privateUrl: priv.status };
    results.upstream = await (await fetch("http://127.0.0.1:9101/__log")).json();
  } finally {
    await b.close(); srv.kill(); mock.kill();
  }
  console.log(JSON.stringify(results, null, 1));
})();
