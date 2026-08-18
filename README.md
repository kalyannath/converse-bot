# ConverseBot

A voice conversation bot: click the mic, speak, and get a spoken + typed reply streamed back from OpenAI in real time — the bot starts talking before its full reply has even finished streaming.

- **Frontend**: Vue 3 + TypeScript (Composition API, `<script setup>`) + Vite. Speech-to-text via the browser's Web Speech API, text-to-speech via `SpeechSynthesis`.
- **Backend**: NestJS + TypeScript, Socket.IO gateway, streams replies from OpenAI (`gpt-4o-mini`).
- **Transport**: WebSockets (Socket.IO).

## Project structure

```
converse-bot/
├── frontend/   # Vue 3 + Vite SPA
└── backend/    # NestJS + Socket.IO API
```

## Setup

### 1. Backend

```bash
cd backend
npm install
cp .env.example .env
# edit .env and set a real OPENAI_API_KEY
```

### 2. Frontend

```bash
cd frontend
npm install
cp .env.example .env.local
# VITE_API_URL defaults to http://localhost:3000, which matches the backend's default port
```

## Local development

Run both apps in separate terminals:

```bash
# terminal 1
cd backend && npm run start:dev

# terminal 2
cd frontend && npm run dev
```

- Backend: http://localhost:3000 (health check at `/api/health`)
- Frontend: http://localhost:5173

Open the frontend URL, allow microphone access, and click the mic button. Firefox doesn't support the Web Speech API's `SpeechRecognition`, so the app automatically falls back to a text input there (TTS still works).

## WebSocket events contract

| Event | Direction | Payload | Notes |
|---|---|---|---|
| `user_message` | Client → Server | `{ messages: { role: 'user' \| 'assistant'; content: string }[] }` | Last ≤10 turns, oldest first. Server validates shape, enforces 1 in-flight request per socket and a 10 msg/60s rate limit. |
| `cancel` | Client → Server | *(no body)* | Aborts the in-flight OpenAI stream for this socket. Client also cancels local `SpeechSynthesis` immediately, without waiting for a response. |
| `bot_token` | Server → Client | `{ token: string }` | Emitted per streamed chunk from OpenAI, in order. |
| `bot_done` | Server → Client | `{ fullText: string }` | Emitted once when the stream completes naturally (never after an abort). |
| `bot_error` | Server → Client | `{ message: string }` | User-friendly message only; real errors are logged server-side. |

Connection lifecycle (built-in Socket.IO events, consumed by `useSocket`): `connect` → connected; `disconnect` → reconnecting; `connect_error` persisting >5s on the first attempt → "waking" (Render cold-start UX); `reconnect`/`reconnect_attempt`/`reconnect_failed` drive the same status indicator. Messages sent while disconnected are queued client-side and flushed automatically on reconnect.

## Manual test checklist

- [ ] Mic permission denied → friendly message shown, mic returns to idle
- [ ] Stay silent after clicking mic → "Didn't catch that" message
- [ ] Happy path: speak → interim transcript updates → user bubble appears → bot reply streams in (typewriter) → TTS starts on the first completed sentence, before the full reply has streamed
- [ ] Click mic again (or "Stop") while the bot is talking → speech stops immediately and a `cancel` event is sent
- [ ] Send messages rapidly → after 10 in 60s, further sends get a rate-limit `bot_error`
- [ ] Stop the backend process while connected → status badge shows reconnecting; restart backend → auto-reconnects and delivers anything queued
- [ ] Open the app in Firefox → mic button is replaced by a text input, same pipeline works
- [ ] Settings panel: change voice/rate, confirm the next spoken sentence reflects it; "Clear conversation" empties the transcript
- [ ] Put an invalid `OPENAI_API_KEY` in `backend/.env` and restart → sending a message yields a generic `bot_error`, not a raw error

## Deployment (free tiers)

### Backend → Render

1. Push this repo to GitHub.
2. Render dashboard → **New → Web Service** → connect the repo → set **Root Directory** to `backend`.
3. Build command: `npm install && npm run build`. Start command: `node dist/main.js`. Instance type: **Free**.
4. Set environment variables in the Render dashboard:
   - `OPENAI_API_KEY` — your real OpenAI key
   - `CORS_ORIGIN` — `https://<your-vercel-app>.vercel.app,http://localhost:5173` (comma-separated; update once the Vercel URL exists, see step 6 below)
   - `PORT` is injected automatically by Render.
5. `render.yaml` at the repo root defines this service as infra-as-code (secrets are `sync: false`, so they must still be set manually in the dashboard).
6. Deploy and note the URL, e.g. `https://conversebot-backend.onrender.com`.

**Cold starts**: Render's free tier spins the service down after ~15 minutes of inactivity; the next request can take up to ~50 seconds to wake it back up. The frontend's connection-status indicator shows a "waking up" message during this window, and any message sent while waking is queued and auto-delivered once connected.

### Frontend → Vercel

1. Vercel dashboard → **New Project** → import the same repo → set **Root Directory** to `frontend`.
2. Framework preset: Vite (auto-detected). Build command: `npm run build`. Output directory: `dist`.
3. Set `VITE_API_URL` in Vercel's environment variables (Production + Preview) to the Render backend URL, e.g. `https://conversebot-backend.onrender.com`. The Socket.IO client upgrades to `wss://` automatically from an `https://` base.
4. `frontend/vercel.json` pins the build settings and adds an SPA rewrite fallback.
5. Deploy and note the URL, e.g. `https://conversebot.vercel.app`.
6. Go back to Render and update `CORS_ORIGIN` with this real Vercel URL, then redeploy/restart the backend.

### Post-deploy smoke test

- [ ] No CORS errors in the browser console on the live Vercel URL
- [ ] DevTools → Network → WS shows a `wss://` connection with `101 Switching Protocols`
- [ ] `curl https://<render-url>/api/health` returns `200 { "status": "ok" }`
- [ ] A real message on the live URL gets a real streamed reply (confirms `OPENAI_API_KEY` is set correctly)
- [ ] Leave the backend idle >15 minutes, reload the frontend, confirm the "waking up" status appears and resolves to "connected" within ~50s
- [ ] Repeat the interrupt-mid-sentence test against the live URLs
