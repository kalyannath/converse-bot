import type { Config, Scenario } from 'artillery';
import type { Page } from 'playwright';

// Point this at the frontend dev server (or a deployed URL) via env var,
// e.g. LOAD_TEST_TARGET=https://your-app.vercel.app
const TARGET = process.env.LOAD_TEST_TARGET ?? 'http://localhost:4173';

export const config: Config = {
  target: TARGET,
  phases: [
    // Staged ramp to find the real ceiling now that openai.service.ts is
    // mocked (LOAD_TEST=true) — each VU finishes in ~1-2s instead of tens
    // of seconds, so this arrival rate stays realistic for real Chromium
    // instances on one machine instead of drowning it like an earlier,
    // much lower rampTo did against the slow dev server + real OpenAI.
    { name: 'warm up', duration: 15, arrivalRate: 1 },
    { name: 'ramp to 5', duration: 20, arrivalRate: 1, rampTo: 5 },
    { name: 'sustain at 5', duration: 20, arrivalRate: 5 },
    { name: 'ramp to 8', duration: 20, arrivalRate: 5, rampTo: 8 },
    { name: 'sustain at 8', duration: 15, arrivalRate: 8 },
  ],
  engines: {
    playwright: {
      trace: { enabled: false },
    },
  },
};

export const scenarios: Scenario[] = [
  {
    engine: 'playwright',
    testFunction: chatFlow,
  },
];

async function chatFlow(page: Page, vuContext: any, events: any, test: any) {
  const { step } = test;

  // Headless Chromium exposes `webkitSpeechRecognition` even though it has
  // no working speech backend. App.vue picks the mic UI vs the text
  // fallback based on isSpeechRecognitionSupported() (browserSupport.ts),
  // so we strip the API before the app boots to force the deterministic
  // text-input path (App.vue:124-125) instead of trying to fake mic audio.
  await page.addInitScript(() => {
    // @ts-expect-error - deliberately removing a browser API for the test
    delete window.SpeechRecognition;
    // @ts-expect-error
    delete window.webkitSpeechRecognition;
  });

  await step('load_app', async () => {
    await page.goto(TARGET);
    await page.getByPlaceholder('Type your message…').waitFor({ state: 'visible' });
  });

  const message = `Say hello in one short sentence. (vu ${vuContext.vars.$uuid})`;

  await step('send_message', async () => {
    await page.getByPlaceholder('Type your message…').fill(message);
    await page.getByRole('button', { name: 'Send' }).click();
  });

  // Race the happy path against the error path. Deliberately NOT using
  // `.cursor` here: it's a transient element (attached on the first token,
  // removed the instant bot_done fires — ChatMessageBubble.vue), and for
  // short replies the whole stream can arrive in one burst, faster than
  // Playwright's polling can catch a blink-and-you-miss-it attach. The
  // assistant bubble itself is created on the first token and never
  // removed, so waiting on it can't race against how fast the reply is.
  let gotError = false;
  await step('time_to_first_token', async () => {
    const outcome = await Promise.race([
      page.locator('.row.assistant .bubble:not(.error)').first().waitFor({ state: 'attached', timeout: 15_000 }).then(() => 'token' as const),
      page.locator('.bubble.error').first().waitFor({ state: 'attached', timeout: 15_000 }).then(() => 'error' as const),
    ]);
    gotError = outcome === 'error';
  });

  if (gotError) {
    events.emit('counter', 'chat.bot_error', 1);
    return;
  }

  // The cursor (ChatMessageBubble.vue) disappears once bot_done fires and
  // finalizeBotMessage() clears isStreaming.
  await step('time_to_full_response', async () => {
    await page.locator('.cursor').waitFor({ state: 'detached', timeout: 30_000 });
  });

  events.emit('counter', 'chat.completed', 1);
}
