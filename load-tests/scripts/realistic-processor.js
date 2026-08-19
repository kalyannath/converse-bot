'use strict';

// Drives the real-AI tests (ceiling-ai-without-mock.yml, burst-ai.yml).
//
// Those can't use the emit+response sugar the mock-mode tests use
// (ceiling-with-ai-mock.yml, soak-trail.yml): that sugar's fast-path match
// (engine_socketio.js isValid()) requires an EXACT string/object match
// against response.data, but real gpt-4o-mini replies are unpredictable
// text. Without an exact match it still "succeeds" eventually, but only
// after silently eating the full response timeout for every single VU
// (confirmed by reading the engine source). This custom step drives the raw
// socket directly so it can time from emit to bot_done/bot_error precisely,
// regardless of what the model actually says.
//
// It also listens to `bot_token` (backend/src/chat/chat.gateway.ts emits one
// per streamed token, in both real and mock mode), which is what makes the
// streaming-specific metrics below possible — a plain send->bot_done timer
// can't see them:
//
//   realistic.ttft                 emit -> FIRST token. What the user
//                                  actually perceives as "did it respond?",
//                                  and the standard headline metric for
//                                  streaming LLM apps.
//   realistic.inter_token_latency  mean gap between consecutive tokens for
//                                  one reply. Governs whether the reply
//                                  *reads* smoothly once it has started.
//   realistic.response_time        emit -> bot_done. Whole round trip.
//   realistic.output_tokens        tokens streamed back for this reply.
//
// ttft + (inter_token_latency x tokens) roughly reconstructs response_time,
// which is the point: it splits one opaque number into "time waiting to
// start" vs "time spent generating", and those two degrade for completely
// different reasons under load.

const RESPONSE_TIMEOUT_MS = 25_000;

// --- Prompt mix -----------------------------------------------------------
// Every VU sending the same short string is the most common way an LLM load
// test ends up measuring nothing useful: identical trivial prompts produce
// identical trivial replies, so the reply-length variance that drives real
// tail latency never shows up, and p95/p99 come out artificially flat.
// These span the range a voice assistant actually sees, and are tagged by
// expected reply size so the report can show the mix that was actually sent.
const PROMPTS = [
  // short: one-line answers
  { size: 'short', text: 'Say hello in one short sentence.' },
  { size: 'short', text: 'What time zone is UTC+0 usually called?' },
  { size: 'short', text: 'Give me one word for very happy.' },
  { size: 'short', text: 'Is water wet? Answer briefly.' },
  // medium: a few sentences, the typical case
  { size: 'medium', text: 'What should I make for dinner if I only have eggs, rice, and some vegetables?' },
  { size: 'medium', text: 'Explain what a websocket is to someone who is not a programmer.' },
  { size: 'medium', text: 'I have a phone interview tomorrow morning. What should I do tonight to prepare?' },
  { size: 'medium', text: 'My flight got delayed by four hours. What are some good ways to pass the time at an airport?' },
  // long: multi-part questions that force a longer reply
  {
    size: 'long',
    text:
      'I am planning a three day trip to a city I have never visited. Walk me through how you would plan it: ' +
      'how to pick where to stay, how to decide what to see, and how to leave room for spontaneity.',
  },
  {
    size: 'long',
    text:
      'Compare cooking with gas versus induction. Cover heat control, cleanup, cost to run, and which one you ' +
      'would recommend for a small apartment kitchen, and explain your reasoning for each point.',
  },
];

// Rough token estimate for cost accounting. The real tokenizer (tiktoken)
// would be exact, but pulling a tokenizer into the hot path of a load test
// costs more than the precision is worth here — chars/4 is the standard
// approximation for English text and is good enough to catch "this run is
// about to cost real money", which is the whole point of tracking it.
const CHARS_PER_TOKEN = 4;
// backend/src/openai/openai.service.ts prepends this to every request, so it
// is billed on every single VU even though the test never sends it.
const SYSTEM_PROMPT_TOKENS_EST = 45;

function estimateTokens(text) {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

// --- Cost circuit breaker -------------------------------------------------
// Guards against the failure mode where a misconfigured ramp (or a rerun
// someone forgot was pointed at the real model) quietly bills for tens of
// thousands of live completions. Tracked per Artillery worker process, so
// with N workers the effective ceiling is N x the cap — deliberately
// conservative rather than trying to share state across processes, since the
// goal is a backstop, not exact accounting.
const COST_PER_1M_INPUT = Number(process.env.LOAD_TEST_COST_PER_1M_INPUT ?? 0.15);
const COST_PER_1M_OUTPUT = Number(process.env.LOAD_TEST_COST_PER_1M_OUTPUT ?? 0.6);
const COST_CAP_USD = Number(process.env.LOAD_TEST_COST_CAP_USD ?? 0); // 0 = disabled

let spentUsd = 0;
let capTripped = false;

function recordSpend(inputTokens, outputTokens) {
  spentUsd += (inputTokens / 1e6) * COST_PER_1M_INPUT + (outputTokens / 1e6) * COST_PER_1M_OUTPUT;
}

function capExceeded() {
  return COST_CAP_USD > 0 && spentUsd >= COST_CAP_USD;
}

async function sendAndTime(context, events) {
  const socket = context.sockets[''];

  if (capExceeded()) {
    // Fail fast without touching the model. These show up as failed VUs with
    // a distinct counter so the report can't be mistaken for "the server
    // broke at this load" — it's the test stopping itself.
    if (!capTripped) {
      capTripped = true;
      console.error(
        `\n[cost cap] Estimated spend hit $${COST_CAP_USD} (LOAD_TEST_COST_CAP_USD). ` +
          'Remaining VUs will fail immediately instead of calling the model.\n',
      );
    }
    events.emit('counter', 'realistic.cost_cap_skipped', 1);
    throw new Error('cost cap reached — VU skipped, not a server failure');
  }

  const prompt = PROMPTS[Math.floor(Math.random() * PROMPTS.length)];
  const message = prompt.text;
  events.emit('counter', `realistic.prompt_${prompt.size}`, 1);

  await new Promise((resolve, reject) => {
    let settled = false;
    const startedAt = process.hrtime();

    let tokenCount = 0;
    let firstTokenAtMs = null;
    let lastTokenAtMs = null;
    // Sum of gaps between consecutive tokens. Kept as a running total rather
    // than an array so a long reply doesn't allocate per token.
    let interTokenTotalMs = 0;

    const cleanup = () => {
      socket.off('bot_token', onToken);
      socket.off('bot_done', onDone);
      socket.off('bot_error', onError);
      clearTimeout(timer);
    };

    const elapsedMs = () => {
      const delta = process.hrtime(startedAt);
      return delta[0] * 1000 + delta[1] / 1e6;
    };

    const onToken = () => {
      if (settled) return;
      const now = elapsedMs();
      tokenCount += 1;
      if (firstTokenAtMs === null) {
        firstTokenAtMs = now;
        events.emit('histogram', 'realistic.ttft', now);
      } else {
        interTokenTotalMs += now - lastTokenAtMs;
      }
      lastTokenAtMs = now;
    };

    const onDone = () => {
      if (settled) return;
      settled = true;
      cleanup();
      const totalMs = elapsedMs();

      events.emit('histogram', 'realistic.response_time', totalMs);
      events.emit('counter', 'realistic.completed', 1);

      if (tokenCount > 0) {
        events.emit('histogram', 'realistic.output_tokens', tokenCount);
        // Needs 2+ tokens to have a gap to measure at all.
        if (tokenCount > 1) {
          events.emit('histogram', 'realistic.inter_token_latency', interTokenTotalMs / (tokenCount - 1));
        }
      } else {
        // bot_done with no bot_token means the reply came back empty — worth
        // surfacing separately, since it "succeeds" but the user got nothing.
        events.emit('counter', 'realistic.empty_reply', 1);
      }

      const inputTokens = estimateTokens(message) + SYSTEM_PROMPT_TOKENS_EST;
      events.emit('counter', 'realistic.input_tokens_est', inputTokens);
      events.emit('counter', 'realistic.output_tokens_total', tokenCount);
      recordSpend(inputTokens, tokenCount);

      resolve();
    };

    const onError = (payload) => {
      if (settled) return;
      settled = true;
      cleanup();
      events.emit('counter', 'realistic.bot_error', 1);
      // Input tokens are billed even when generation fails partway.
      recordSpend(estimateTokens(message) + SYSTEM_PROMPT_TOKENS_EST, tokenCount);
      reject(new Error(`bot_error: ${payload && payload.message}`));
    };

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      events.emit('counter', 'realistic.timeout', 1);
      // Distinguishes "never started replying" from "started, then stalled
      // mid-stream" — very different failures that a plain timeout counter
      // collapses into one.
      events.emit('counter', firstTokenAtMs === null ? 'realistic.timeout_before_first_token' : 'realistic.timeout_mid_stream', 1);
      recordSpend(estimateTokens(message) + SYSTEM_PROMPT_TOKENS_EST, tokenCount);
      reject(new Error('response timeout'));
    }, RESPONSE_TIMEOUT_MS);

    socket.on('bot_token', onToken);
    socket.once('bot_done', onDone);
    socket.once('bot_error', onError);

    socket.emit('user_message', { messages: [{ role: 'user', content: message }] });
  });
}

module.exports = { sendAndTime, PROMPTS };
