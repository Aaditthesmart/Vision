# Server Layer — Orchestrator

> The brain's switchboard. Receives user messages via Socket.io, proxies mic audio to Deepgram for STT, dispatches messages to the LangGraph supervisor, synthesizes audio via Cartesia TTS, and handles barge-in interruptions.

---

## Responsibilities

1. Maintain persistent Socket.io connections with clients
2. Proxy mic audio to Deepgram Nova-3 WebSocket for STT
3. Dispatch user messages to the LangGraph supervisor (`runSupervisor()`)
4. Stream Cartesia TTS audio chunks back to the client in real time
5. Handle interruption signals — cancel in-flight supervisor/TTS pipelines
6. Manage session state: conversation history, page snapshot, abort controller
7. Manage Stagehand browser instance (singleton, visible Chromium)

---

## File Structure

```
/server
  /src
    index.ts                    # Entry point: Express + Socket.io + cors + dotenv
    /agents
      supervisor.ts             # LangGraph StateGraph: classify → commerce|general → formatResponse
    /lib
      stagehand.ts              # Stagehand + visible Chromium setup (singleton)
      deepgram.ts               # Deepgram Nova-3 WebSocket STT proxy
      cartesia.ts               # Cartesia Sonic-2 TTS streaming
    /types
      index.ts                  # All shared types (events, payloads, supervisor, execution)
  /data
    seed-user-profile.json      # Demo user profile (hardcoded, migrates to Elasticsearch in Phase 5)
  .env                          # API keys (ANTHROPIC, CARTESIA, DEEPGRAM)
```

---

## Entry Point: `index.ts`

```typescript
import "dotenv/config";
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";

// Express + CORS, Socket.io with wildcard CORS
// Health check: GET /health → { status: "ok" }
// Loads seed user profile from data/seed-user-profile.json
// Initializes Stagehand singleton (visible Chromium)
// Delegates all socket connections to connection handler
```

**Key decisions:**
- `dotenv/config` import loads `.env` automatically (ESM-compatible)
- `"type": "module"` in package.json for ESM
- Stagehand initialized at startup as a singleton (all agents share one browser)
- User profile loaded from seed JSON, injected into supervisor calls
- Single health check endpoint

---

## Connection Handler

Each client connection gets its own session state:

```typescript
socket.on("session:start", ({ sessionId }) => {
  // Create session state: conversation history, page snapshot, abort controller
});

socket.on("user:message", async ({ text, sessionId }) => {
  // 1. Emit status: "thinking"
  // 2. Abort previous pipeline if running
  // 3. Call runSupervisor({ userInput, conversationHistory, userProfile, pageSnapshot })
  // 4. Append to conversation history
  // 5. Stream response through Cartesia TTS → audio:chunk events
  // 6. Emit agent:response, status: "speaking", audio:done, status: "listening"
});

socket.on("audio:interrupt", ({ sessionId }) => {
  // 1. Abort current pipeline (AbortController)
  // 2. Cancel Cartesia TTS context
  // 3. Emit status: "listening"
});

// Deepgram STT proxy
socket.on("stt:start", ({ sessionId, mimeType }) => {
  // Open Deepgram WebSocket connection for this session
});

socket.on("stt:audio-chunk", ({ sessionId, data }) => {
  // Forward base64 audio to Deepgram WebSocket
});

socket.on("stt:stop", ({ sessionId }) => {
  // Close Deepgram WebSocket connection
});
```

---

## Deepgram STT Proxy: `lib/deepgram.ts`

Server acts as a proxy between the client's mic audio and Deepgram's WebSocket API:

```typescript
// Client mic → Socket.io "stt:audio-chunk" → Server → Deepgram WebSocket
// Deepgram → Server → Socket.io "stt:transcript" / "stt:utterance-end" → Client

// Deepgram Nova-3 config:
// - model: "nova-3"
// - language: "en"
// - smart_format: true
// - interim_results: true
// - utterance_end_ms: 1000
// - vad_events: true
```

**Key behaviors:**
- One Deepgram WebSocket per client session (opened on `stt:start`, closed on `stt:stop`)
- Forwards interim and final transcripts to client via `stt:transcript`
- Fires `stt:utterance-end` when Deepgram detects end of speech
- Client commits the final transcript as `user:message` after utterance end

---

## LangGraph Supervisor Dispatch

The server delegates all agent logic to the LangGraph supervisor:

```typescript
import { runSupervisor } from "./agents/supervisor.js";

// On "user:message":
const result = await runSupervisor({
  userInput: text,
  conversationHistory: session.history,
  userProfile: seedUserProfile,
  pageSnapshot: session.currentPage,
});

// result: { responseText, agentCategory, actions? }
// responseText is TTS-ready (markdown stripped, voice-formatted)
```

The server has **no knowledge of agents or routing logic**. It passes the user's message to the supervisor and receives a formatted response. The supervisor handles all classification, routing, and agent coordination internally.

---

## Session State

```typescript
interface SessionState {
  sessionId: string;
  conversationHistory: ConversationTurn[];  // Append-only
  currentPage: PageSnapshot | null;         // Updated by Stagehand navigation
  abortController: AbortController | null;  // For cancelling in-flight pipelines
  deepgramConnection: DeepgramWS | null;    // Active Deepgram WebSocket
}

interface ConversationTurn {
  role: "user" | "assistant";
  text: string;
  agent?: string;   // Which agent handled this turn
  timestamp: number;
}

interface PageSnapshot {
  url: string;
  title: string;
  description?: string;
}
```

---

## Socket Events

### Received (Client → Server)

| Event | Payload | Handler |
|-------|---------|---------|
| `session:start` | `{ sessionId }` | Create session state |
| `user:message` | `{ text, sessionId }` | Dispatch to supervisor → TTS |
| `audio:interrupt` | `{ sessionId }` | Abort pipeline + cancel TTS |
| `stt:start` | `{ sessionId, mimeType? }` | Open Deepgram WebSocket |
| `stt:audio-chunk` | `{ sessionId, data }` | Forward audio to Deepgram |
| `stt:stop` | `{ sessionId }` | Close Deepgram WebSocket |

### Emitted (Server → Client)

| Event | Payload | When |
|-------|---------|------|
| `session:ready` | `{ sessionId, greeting }` | Session created |
| `agent:response` | `{ text, agent, actions? }` | Supervisor returned response |
| `status` | `{ state, label }` | Pipeline state transitions |
| `audio:chunk` | `{ data, index, final, sampleRate, encoding }` | PCM f32le from Cartesia |
| `audio:done` | `{ sessionId }` | TTS finished |
| `stt:transcript` | `{ text, isFinal, confidence, speechFinal }` | Deepgram transcript |
| `stt:utterance-end` | `{}` | Deepgram detected end of speech |
| `stt:ready` | `{}` | Deepgram connection established |
| `stt:error` | `{ message }` | Deepgram error |
| `error` | `{ code, message, recoverable }` | Server error |

---

## Interruption Handling

When `audio:interrupt` is received:
1. `abortController.abort()` — signals supervisor/LLM to stop
2. Cartesia TTS context cancelled
3. Emit `status` with `state: "listening"`
4. Server is ready for next message immediately

AbortSignal is threaded through:
- LangGraph supervisor invocation
- Cartesia TTS chunk sending
- Any in-flight browser actions

---

## Status State Machine

```
listening → thinking → speaking → listening
                    ↘ acting → speaking → listening
```

The server MUST:
- Send `status: "thinking"` before any processing begins
- Send `status: "speaking"` before the first `audio:chunk`
- Send `audio:done` after the final chunk of every utterance
- Send `status: "listening"` after `audio:done`

---

## Environment Variables

```env
PORT=3001
ANTHROPIC_API_KEY=...          # Claude Haiku (supervisor) + Sonnet (agents)
CARTESIA_API_KEY=...           # Cartesia Sonic-2 TTS
DEEPGRAM_API_KEY=...           # Deepgram Nova-3 STT
BROWSERBASE_API_KEY=...        # Optional: Browserbase cloud fallback
BROWSERBASE_PROJECT_ID=...     # Optional: Browserbase cloud fallback
```

---

## Dependencies

```json
{
  "@anthropic-ai/sdk": "^0.74.0",
  "@browserbasehq/stagehand": "^3.0.8",
  "@deepgram/sdk": "^3.x",
  "@cartesia/cartesia-js": "^1.x",
  "@langchain/langgraph": "^0.2.74",
  "@langchain/anthropic": "^0.3.34",
  "@langchain/core": "^0.3.80",
  "cors": "^2.8.6",
  "dotenv": "^17.3.1",
  "express": "^5.2.1",
  "socket.io": "^4.8.3",
  "uuid": "^13.0.0",
  "ws": "^8.19.0",
  "zod": "^4.3.6"
}
```

---

## Interaction with Other Layers

| Layer | Direction | Mechanism | Data |
|-------|-----------|-----------|------|
| **Client Layer** | Bi-directional | Socket.io | Events listed above |
| **LangGraph Supervisor** | Server → Supervisor | `runSupervisor()` | User message + context → response text |
| **Deepgram STT** | Server ↔ Deepgram | WebSocket proxy | Mic audio → transcripts |
| **Cartesia TTS** | Server → Cartesia | WebSocket / SDK | Response text → PCM audio chunks |
| **Stagehand** | Server manages lifecycle | Singleton init | Browser instance shared by all agents |
