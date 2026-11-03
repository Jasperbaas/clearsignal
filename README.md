# ClearSignal

**Check a war post before you share it.** ClearSignal runs a live web fact check with real sources, shows when a claim or video was first debunked, and scores the text on the 20 indicators of the PSYOPS Identification Tool V8.3. One clear answer sits on top, from "Likely fake news" to "No signs of fake news found", and a person makes the final call.

Built for the Creathon *Truth in the Age of AI* (GIPA × Hogeschool Leiden, Tbilisi 2026).

## How it works

1. **Add the post.** Paste the text, upload up to four screenshots, or load a link.
2. **Results.**
   - Claude scores the text on 20 observable signals, with exact quotes only.
   - At the same time, Claude picks the checkable claims and the server searches the web for each one (Parallel Search API).
   - Claude then weighs every claim against the pages that came back, and only those pages. Every quote is found again on its page, or the verdict becomes "Not verified".
   - The fake news check on top follows fixed rules, so the same evidence always gives the same answer.
3. **Review.** Your team agrees or disagrees with each finding.
4. **Share.** Download a report or copy a summary.

ClearSignal measures how strongly a text uses manipulation techniques and what sources say about its claims. It never claims that a post is a psychological operation.

## Deploy on Vercel (about 15 minutes)

1. **Get the keys.**
   - **Claude API key:** create one at [console.anthropic.com](https://console.anthropic.com). Also set a monthly spend limit there.
   - **Parallel API key:** create one at [platform.parallel.ai](https://platform.parallel.ai).
2. **Import this repository** in Vercel: *Add New → Project*, pick the repository, and keep the framework preset on *Other*. There is no build step.
3. **Add the environment variables** before the first deploy:
   - `ANTHROPIC_API_KEY`
   - `PARALLEL_API_KEY`
4. **Deploy.** Open the URL Vercel gives you and run the example post.

The optional settings are in `.env.example`:

- **Models:** `CS_MODEL` (default `claude-sonnet-5-5`) and `CS_MODEL_FAST` (default `claude-haiku-5-5`, used to pick the claims).
- **Limits:** `CS_AI_PER_HOUR` and `CS_SEARCH_PER_HOUR` set calls per visitor per hour (default 40 each, about 10 checks). `CS_AI_PER_DAY` and `CS_SEARCH_PER_DAY` set calls for the whole site per day (default 800 each, about 200 checks).
- **Shared counts:** add Upstash Redis through the Vercel Marketplace. With its `KV_REST_API_URL`/`KV_REST_API_TOKEN`, or `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN`, the limits hold across all server instances. Without it, each instance counts on its own.

## Cost per check

This is a rough estimate at list prices, with `claude-sonnet-5-5` for the signals and the verdicts:

- the 20 signals cost about $0.04;
- weighing the claims costs about $0.02;
- picking the claims with Haiku costs well under $0.001;
- two or three Parallel searches cost about $0.01–0.015.

That comes to roughly **$0.07–0.10 per check**, so 100 checks cost about $7–10. The same post checked again in the same browser within six hours is served from that browser's store and costs nothing.

## Safety

- The API keys stay on the server. The page never sees them.
- The server builds every prompt itself from the visitor's input, so `/api/ai` only runs ClearSignal's four tasks and cannot be used as a general chatbot.
- Requests from other websites are refused, and input sizes are capped.
- Links to private or local addresses are refused.
- Each visitor gets an hourly limit, and the whole site gets a daily limit.

## Run it locally

```bash
ANTHROPIC_API_KEY=... PARALLEL_API_KEY=... node dev-server.js
# open http://localhost:3000
```

The end-to-end test uses mock Claude and Parallel servers, so it needs no keys. It needs Playwright installed:

```bash
node test/e2e.js
```

## Files

- `public/index.html` is the whole front end: one page, no framework.
- `api/ai.js` runs the Claude tasks: `signals` (streamed), `transcribe`, `claims` and `assess`.
- `api/search.js` runs a web search for one claim through Parallel Search.
- `api/fetch.js` reads the page behind a link through Parallel Extract.
- `lib/logic.js` holds the prompts, validation and scoring. The page and the server share it.
- `lib/server.js` holds input checks, rate limits and the Claude and Parallel calls.
