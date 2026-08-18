'use strict';

// deployed-realistic.yml can't use the emit+response sugar the mock-mode
// tests use (socket-flow.yml, deployed-ceiling.yml): that sugar's fast-path
// match (engine_socketio.js isValid()) requires an EXACT string/object match
// against response.data, but real gpt-4o-mini replies are unpredictable
// text. Without an exact match it still "succeeds" eventually, but only
// after silently eating the full response timeout for every single VU
// (confirmed by reading the engine source — see socket-flow.yml's comment
// for the same trap). This custom step drives the raw socket directly so it
// can time from emit to bot_done/bot_error precisely, regardless of what
// the model actually says.

const RESPONSE_TIMEOUT_MS = 25_000;

async function sendAndTime(context, events) {
  const socket = context.sockets[''];
  const message = `Say hello in one short sentence. (vu ${context.vars.$uuid ?? Math.random()})`;

  await new Promise((resolve, reject) => {
    let settled = false;
    const startedAt = process.hrtime();

    const cleanup = () => {
      socket.off('bot_done', onDone);
      socket.off('bot_error', onError);
      clearTimeout(timer);
    };

    const elapsedMs = () => {
      const delta = process.hrtime(startedAt);
      return delta[0] * 1000 + delta[1] / 1e6;
    };

    const onDone = () => {
      if (settled) return;
      settled = true;
      cleanup();
      events.emit('histogram', 'realistic.response_time', elapsedMs());
      events.emit('counter', 'realistic.completed', 1);
      resolve();
    };

    const onError = (payload) => {
      if (settled) return;
      settled = true;
      cleanup();
      events.emit('counter', 'realistic.bot_error', 1);
      reject(new Error(`bot_error: ${payload && payload.message}`));
    };

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      events.emit('counter', 'realistic.timeout', 1);
      reject(new Error('response timeout'));
    }, RESPONSE_TIMEOUT_MS);

    socket.once('bot_done', onDone);
    socket.once('bot_error', onError);

    socket.emit('user_message', { messages: [{ role: 'user', content: message }] });
  });
}

module.exports = { sendAndTime };
