# ConverseBot load tests

Load testing for a **streaming, WebSocket-based AI chat backend** — ConverseBot's
NestJS/Socket.IO server talking to `gpt-4o-mini`.

Built on [Artillery](https://artillery.io) 2.x, with a custom measurement layer and
report generator on top. Every run leaves a self-contained HTML report next to its raw
JSON, the way a Playwright run leaves `playwright-report/index.html`.

---

## Why this exists

Generic load testing tools answer *"how many requests per second before it breaks?"*
That question is a poor fit for a streaming LLM app, for three reasons:

1. **A reply isn't one event, it's a stream.** The backend emits `bot_token` per token.
   "Response time" collapses *waiting for the reply to start* and *waiting for it to
   finish* into a single number — and those two degrade for completely different
   reasons.
2. **There's no fixed expected response.** Artillery's `emit`/`response` matching needs
   a literal string match. Real model output never matches, so the built-in sugar
   silently eats the full response timeout on every request instead of measuring it.
3. **Every request costs money.** A misconfigured ramp against a live model bills for
   real.

This suite addresses all three directly.

---

## Features

### Streaming-aware measurement

Rather than one opaque timer, each request is decomposed:

| Metric | What it captures |
|---|---|
| `realistic.ttft` | Send → **first** token. The silence a user actually sits through. |
| `realistic.inter_token_latency` | Mean gap between consecutive tokens. Whether text streams smoothly. |
| `realistic.response_time` | Send → **last** token. The full round trip. |
| `realistic.output_tokens` | Tokens per reply. |

Roughly, `ttft + (inter_token_latency × tokens) ≈ response_time`.

**This split is the suite's most useful output.** In our ceiling runs, generation speed
held at 9.2–9.3 ms/token *while the system was collapsing*, and ~90% of timeouts
occurred before a single token arrived. Conclusion: requests die queued waiting to
start, not while generating. A single send→reply timer cannot show that.

### Failure modes separated

Timeouts split into `timeout_before_first_token` vs `timeout_mid_stream` — "never
started" and "started then stalled" are different bugs with different fixes. Also
tracked: `bot_error` (server said no) and `empty_reply` (server said done, sent
nothing — counts as success everywhere else, but the user got nothing).

### Cost control, three layers

1. **Before the run** — the runner prints an estimated cost, computed from the config's
   own phases. An accidental 10,000-call run is visible while it can still be cancelled.
2. **During** — `LOAD_TEST_COST_CAP_USD` trips a circuit breaker that stops calling the
   model. Skipped requests are counted separately so they can't be mistaken for server
   failures.
3. **After** — the report shows actual spend from real token counts (output counted
   exactly, input estimated at ~4 chars/token).

### Realistic prompt mix

Requests are sampled from a pool spanning one-line questions to multi-part ones.
Identical trivial prompts produce identical trivial replies, which flattens the
reply-length variance that drives real tail latency. Switching from a single fixed
prompt to this mix raised output tokens per reply ~4.7× and roughly doubled median
latency — the earlier numbers had been measuring an unrealistically easy workload.

### Reports built to be read

Two tabs — **Overview** (plain language, for whoever reads headline numbers) and
**Engineering details** — from the same data. Every metric carries a human label with
its raw name kept underneath; values are unit-aware (durations render `1.4s`, counts
render plain); each table has a "what these mean" expander; and a FAQ answers the
questions the numbers reliably provoke.

The report also reconciles **configured vs. actual traffic** per phase, so config drift
and Artillery's arrival jitter are visible rather than silently absorbed.

---

## How this differs from other tools

The market splits into four groups, none of which covers this ground:

| Category | Examples | What they solve | Gap for this use case |
|---|---|---|---|
| General load engines | k6, Locust, Gatling, JMeter, Artillery | Concurrent traffic over many protocols | No notion of streaming, tokens, or model cost |
| Socket.IO SaaS testers | Testable, LoadForge, BlazeMeter | Hosted load generators, huge VU counts | Scale and ops — not interpretation |
| LLM inference benchmarkers | NVIDIA AIPerf, Ray LLMPerf | TTFT/ITL against an inference endpoint | Benchmark the *model*; no concept of a user session |
| Hybrid LLM-app testers | TrueFoundry LLM Locust | Token-level metrics + concurrency | Closest analog; HTTP/completions-oriented, not Socket.IO |

What's distinctive here:

- **Streaming metrics over a Socket.IO session, not an HTTP completions endpoint.** The
  LLM benchmarkers assume an OpenAI-style REST call. This measures TTFT across a real
  WebSocket session with connect/stream/disconnect lifecycle.
- **Concurrency is estimated and explained.** None of the Socket.IO SaaS tools translate
  connections/sec into "how many people were talking at once." This applies Little's Law
  per window and shows the arithmetic inline.
- **Config-vs-actual reconciliation.** No tool in the list verifies that the ramp you
  configured is the ramp that ran.
- **The report is the product.** Competitors either dump percentile tables or sell a
  hosted dashboard. Here the report is optimized as a comprehension artifact — narrative,
  glossary, methodology, and self-checking numbers.
- **Cost as a first-class metric,** with a circuit breaker. Not present in any general
  load tool.
- **The engine's own bug is patched.** Artillery 2.0.34's Socket.IO engine double-invokes
  its connection callback under heavy churn, crashing the worker (`Callback was already
  called`, exit 11). `patches/artillery+2.0.34.patch` fixes it and reapplies on install.

---

## Setup

```bash
cd load-tests
npm install          # postinstall applies patches/artillery+2.0.34.patch
```

Requires Node 18+ (developed on v24). The Artillery patch is applied automatically —
**do not skip `postinstall`**, or heavy runs will crash partway through.

---

## The tests

| Command | Target | AI | Shape | Cost |
|---|---|---|---|---|
| `npm run test:ceiling-with-ai-mock` | Render | mocked | ramp 2→200/sec, 250s | free |
| `npm run test:ceiling-ai-without-mock` | Render | **real** | ramp 2→200/sec, 130s | ~$0.05–0.65 |
| `npm run test:burst-ai` | Render | **real** | 2 identical bursts w/ idle gaps, 120s | ~$0.05 |
| `npm run test:soak-trail` | localhost | mocked | steady 40/sec, 310s | free |
| `npm run test:chat` | — | — | Playwright browser flow | — |

**Mock mode requires `LOAD_TEST=true` on the server**, which makes the backend stream a
canned reply instead of calling OpenAI. This is what makes the mock tests free and
deterministic.

Which to reach for:

- **Server capacity, no model noise** → `ceiling-with-ai-mock`
- **What real users actually experience** → `ceiling-ai-without-mock`
- **Cold-start behavior** → `burst-ai` (two identical bursts separated by idle; any
  difference between them is the cold-start cost, which a monotonic ramp can never
  isolate)
- **Leaks and slow degradation** → `soak-trail`

### Cost estimate ranges

`ceiling-ai-without-mock` is quoted as a range because the pre-run estimate assumes
every request completes. In a ceiling test most requests fail before generating
billable output — measured runs came in at **~$0.05** against a $0.65 estimate. Treat
the printed number as an upper bound.

---

## Running

```bash
npm run test:ceiling-ai-without-mock

# with a hard spend cap (per worker process)
LOAD_TEST_COST_CAP_USD=1.00 npm run test:ceiling-ai-without-mock

# skip auto-opening the report
npm run test:burst-ai -- --no-open
```

Output lands in:

```
reports/<test-name>/<timestamp>/result.json   # raw Artillery output
reports/<test-name>/<timestamp>/report.html   # generated report
reports/<test-name>/latest.html               # copy of the most recent
```

### Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `LOAD_TEST_COST_CAP_USD` | `0` (off) | Stop calling the model past this estimated spend. Per worker, so N workers ⇒ N× the cap. |
| `LOAD_TEST_COST_PER_1M_INPUT` | `0.15` | Input token price. Set `0` for mock runs. |
| `LOAD_TEST_COST_PER_1M_OUTPUT` | `0.60` | Output token price. |
| `LOAD_TEST_TARGET` | parsed from config | Sets the target shown in the **report header only** — it does *not* redirect traffic. Useful for `flows/chat-flow.ts`, where no `target:` can be parsed. To change where traffic goes, edit the config's `target:`. |

### Before a real-AI run

1. **Confirm `LOAD_TEST` is unset on the server.** Unlike the mock config (which fails
   loudly if the flag is wrong), the real-AI configs work either way — they'd just
   silently measure mocked latency and label it "real AI". Send one message and check
   whether the reply is the canned mock string.
2. **Warm the server.** Render free instances spin down after ~15 min idle; a cold start
   takes 30–60s and will distort early windows.

---

## Reading a report

Start on **Overview**: a plain-language verdict, then comfortable capacity, breaking
point, error rate, wait-to-start, reply time, and estimated cost. The explainer boxes
show how each headline number was derived.

**Engineering details** has per-window tables, latency percentiles, the error breakdown,
prompt mix, cost, and config-vs-actual traffic.

### Which numbers to trust

Measured across three identical runs:

| Stable (≤4% spread) | Unstable (>90% spread) |
|---|---|
| Completed requests | Estimated concurrency |
| Failure rate | p95 / p99 latency |
| Output tokens per reply | Timeout counts |
| Inter-token latency | Breaking-point window |

**Report capacity as a range, not a point.** "Comfortable capacity" is picked from a
single window and expressed in concurrency, which multiplies in session-length noise —
it varied 229–437 across identical runs, while the underlying arrival rate varied only
33.7–39.4/sec. Prefer arrival rate.

Per-window error rates past the breaking point are largely noise: a window can show 0%
sandwiched between 96% windows, because completions land in whichever window they
*finish* in, not the one they started in.

---

## Layout

```
load-tests/
├── *.yml                        # test configs (traffic shape)
├── scripts/
│   ├── run-with-report.js       # wraps `artillery run`; pre-run cost estimate
│   ├── realistic-processor.js   # custom step: streaming metrics, prompts, cost
│   └── generate-report.js       # result.json -> HTML
├── flows/chat-flow.ts           # Playwright browser flow
├── patches/                     # Artillery Socket.IO crash fix
└── reports/                     # per-run output
```

### Why a custom processor instead of `emit`/`response`

Artillery's Socket.IO sugar validates responses by exact match. Real model replies are
unpredictable text, so the match never succeeds — and rather than failing fast, the
engine waits out the full response timeout on **every** request, reporting timeout
latency instead of real latency. `sendAndTime` drives the socket directly, timing
`user_message` → `bot_token`/`bot_done`/`bot_error` regardless of reply content.

The mock tests can still use the sugar, because `LOAD_TEST=true` makes replies exactly
predictable.

---

## Extending

**New traffic shape** — copy a `.yml`, adjust `phases`, add an npm script. Keep phase
durations in multiples of 10s so they align with Artillery's fixed 10-second reporting
window; otherwise the report flags misaligned rows with `*`.

**New metric** — emit it from `realistic-processor.js`:

```js
events.emit('histogram', 'realistic.my_metric', valueMs);  // distribution
events.emit('counter', 'realistic.my_counter', 1);         // running total
```

Then add an entry to `METRIC_INFO` in `generate-report.js` so it renders with a label,
description, and correct units. Undocumented metrics still appear — just with their raw
name — so this never breaks a report.
