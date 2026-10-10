# Implementation Phases

> Last audited: 2026-02-14
> Status key: ✅ Done | 🔶 Partial (code exists, not fully working) | ❌ Not started

---

## Phase 1: Skeleton (Socket Round-Trip) — ✅ DONE

- [x] Scaffold `server/` with Express + Socket.io + TypeScript
  - `server/src/index.ts` — Express app, CORS, Socket.io server on port 3001
  - Health check at `/health`
- [x] Scaffold `client/` with Next.js (React 19)
  - `client/src/app/page.tsx` renders `<VoiceAgent />`
- [x] Server: Socket.io connection handling
  - `server/src/socket/handler.ts` — `createHandler()` factory, wires supervisor + TTS + pipeline per connection
- [x] Client: `useSocket` hook with event registration
  - Events: `user_message`, `stop_audio`, `assistant_text`, `audio_chunk`, `audio_done`, `status`, `error`
- [x] Verified end-to-end socket round-trip

---

## Phase 2: Voice I/O (Ears & Mouth) — ✅ DONE

### STT (Ears) — Dual path

**Web Speech API (client-side, current default):**
- [x] `client/src/hooks/useSpeechRecognition.ts` — Chrome `webkitSpeechRecognition`
  - Continuous listening with interim results
  - Auto-restart after silence
  - `onFinalTranscript` callback for completed speech
  - `onInterimUpdate` callback for live typing / barge-in detection
- [x] Barge-in support — speech detected during playback → instant audio stop + server abort

**Deepgram Nova-2 (server-side, wired but client capture not done):**
- [x] `server/src/stt/deepgram.ts` — `DeepgramSTT` class
  - Creates live transcription connection to Deepgram
  - Nova-2, smart_format, interim_results, VAD, endpointing (300ms), utterance_end (1000ms)
  - Keep-alive interval (8s) to prevent timeout
  - Buffers audio before connection opens, flushes on open
  - Events emitted to client: `stt_transcript`, `stt_speech_started`, `stt_utterance_end`
- [x] Server socket events wired in `handler.ts`: `stt_start`, `stt_audio`, `stt_stop`
- [ ] **Client-side mic capture → socket not implemented** — `useSpeechRecognition.ts` still uses Web Speech API, not the Deepgram socket path

> **NOTE**: Web Speech API is broken in Electron. Deepgram server-side is ready but client needs to send raw audio via socket for the full Deepgram path to work.

### TTS (Mouth) — Cartesia Sonic-2 (server-side)
- [x] `server/src/tts/cartesia.ts` — Cartesia TTS via raw WebSocket (`ws` package)
  - Connects to `wss://api.cartesia.ai/tts/websocket`
  - Context management for prosody continuity across chunks
  - PCM s16le @ 24kHz output format
  - `sendChunk()` / `finalizeContext()` / `cancelContext()` API
- [x] `client/src/hooks/useAudioPlayer.ts` — WebAudio API playback
  - PCM s16le → Float32 decoding
  - Jitter buffer (200ms @ 24kHz) for smooth playback
  - Batch flushing (~80ms) to reduce AudioNode overhead
  - Instant stop for barge-in

### Voice Pipeline (Orchestrator)
- [x] `server/src/pipeline/voicePipeline.ts` — sentence/clause splitting → TTS
  - Sentence boundary detection (`[.?!]\s`) for natural TTS chunking
  - Clause-level splitting (`[,;:]\s`) for faster time-to-first-audio (40 char threshold)
  - Hard flush for long buffers (> 150 chars)
  - AbortController threading for user interruption
  - `processSupervisorResponse()` — accepts text from supervisor and sends to TTS
  - Status state machine: `idle` → `thinking` → `speaking` → `idle`

### Client Components
- [x] `client/src/components/VoiceAgent.tsx` — Main orchestrator (wires hooks, handles barge-in, derives state)
- [x] `client/src/components/MicButton.tsx` — Mic toggle with pulse animation
- [x] `client/src/components/StatusIndicator.tsx` — Status badge (idle/listening/thinking/speaking)
- [x] `client/src/components/Transcript.tsx` — Chat-style message history with streaming cursor
- [x] `client/src/lib/types.ts` — `AgentState`, `TranscriptEntry`

---

## Phase 3: Browser (The Hands) — ✅ DONE

- [x] `@browserbasehq/stagehand` installed in `server/package.json`
- [x] `server/src/lib/stagehand.ts` — Stagehand wrapper
  - Singleton pattern for visible Chromium (local, non-headless)
  - `initStagehand()` — launches browser with Sonnet 4.5
  - `getStagehand()` / `closeStagehand()` — lifecycle
  - `createExecutionContext()` — wraps all Stagehand methods:
    - `extract(instruction, schema?)` → `ExtractResult`
    - `act(instruction)` → `ActResult`
    - `observe(instruction?)` → `ObserveResult`
    - `navigate(url)` → `NavigateResult`
  - All methods catch errors → return `{ success, data/error }`, never throw
- [x] `server/src/types/index.ts` — Execution layer types
  - `ExtractResult`, `ActResult`, `ObserveResult`, `AvailableAction`, `NavigateResult`, `ExecutionContext`

---

## Phase 4: Supervisor + Routing (The Brain) — ✅ DONE

- [x] LangGraph dependencies installed: `@langchain/langgraph@0.2.74`, `@langchain/anthropic@0.3.34`, `@langchain/core@0.3.80`
- [x] Supervisor types defined in `server/src/types/index.ts`:
  - `ConversationTurn`, `PageSnapshot`, `UserProfile`, `AgentCategory`, `ClassificationResult`, `SupervisorResult`
- [x] `server/src/agents/supervisor.ts` — LangGraph StateGraph (263 lines)
  - Node 1 (`classify`): Haiku 4.5 intent classification → `{ category, subIntent, entities }`
  - Node 2a (`commerceAgent`): Delegates to `commerce.ts`
  - Node 2b (`codingAgent`): Delegates to `coding.ts`
  - Node 2c (`generalAgent`): Delegates to `general.ts`
  - Node 3 (`formatResponse`): Strips markdown, URLs, list markers for TTS
  - Router: conditional edges — 3-way routing based on classification
  - Graph flow: `START → classify → [commerceAgent|codingAgent|generalAgent] → formatResponse → END`
- [x] Supervisor wired into `handler.ts` via `createHandler(executionContext)`
  - Graph compiled once per server start, reused across all connections
  - Conversation history tracked per socket connection
  - `runSupervisor()` called on every `user_message` event
  - Response text fed to `pipeline.processSupervisorResponse()` → TTS
- [x] User profile loaded from `server/data/seed-user-profile.json` at module load
- [x] Graceful degradation: works in text-only mode when Stagehand is unavailable

---

## Phase 5: Real Agents (The Specialists) — 🔶 PARTIAL

> Agents exist and can invoke browser tools, but run into errors during execution. Not demo-ready.

### Browser Tools
- [x] `server/src/agents/tools.ts` — LangChain `DynamicStructuredTool` wrappers for Stagehand
  - `navigate_to_url` — navigate browser to a URL
  - `click_element` — click, type, scroll via natural language instruction
  - `extract_data` — extract structured info from current page
  - `observe_page` — discover available actions on current page
  - All tools receive `ExecutionContext`, return JSON results

### Commerce Agent
- [x] `server/src/agents/commerce.ts` — ReAct loop with browser tools
  - System prompt tailored for blind user shopping (top 3 products, ordinal references, budget tracking)
  - Uses Sonnet 4.5 with `bindTools()` for tool calling
  - Max 10 tool steps per request
  - Falls back to text-only when no ExecutionContext
  - **Can search and navigate but frequently errors during multi-step flows**
- [ ] Product reference resolution ("the Sony ones", "the first one")
- [ ] Commerce state tracking (cart items, cart total, last search results)
- [ ] Budget checking against user profile

### General Agent
- [x] `server/src/agents/general.ts` — ReAct loop with browser tools
  - System prompt with spatial description rules for accessibility
  - Same ReAct architecture as commerce agent
  - Falls back to text-only when no ExecutionContext
  - **Can navigate and describe pages but errors during complex interactions**
- [ ] Spatial page description (layout-first, not sequential DOM)
- [ ] Article summarization with "read more" flow
- [ ] Web search → summarize top results

### Coding Agent
- [x] `server/src/agents/coding.ts` — Text-only stub
  - System prompt for blind developer assistance
  - Sonnet 4.5, no tool use
  - Explains code, helps debug, suggests fixes — all conversational
- [ ] Agent-S integration (Python sidecar, desktop control) — NOT STARTED

### What needs fixing:
- [ ] Debug and fix agent errors during browser tool execution
- [ ] Improve tool call reliability (observe before act, error recovery)
- [ ] Test end-to-end: voice query → supervisor routing → agent tool use → TTS response
- [ ] Add interim speech during long browser operations ("Searching Amazon now...")

---

## Phase 6: Streaming Pipeline — ❌ NOT STARTED

> Switch from `invoke()` to `stream()` for real-time token-level TTS and interim events.

- [ ] Switch `runSupervisor()` from `invoke()` to `stream()` with `streamMode: ["messages", "custom"]`
- [ ] Sentence-boundary streaming: regex avoids false breaks on "Dr.", "$4.99"
- [ ] Emit `{ type: "interim_speech", text: "..." }` via `config.writer()` during browser work
- [ ] Token-level TTS: stream LLM tokens → sentence buffer → Cartesia as sentences complete
- [ ] Target: ~700ms time-to-first-audio

---

## Phase 7: Multi-turn Memory — ❌ NOT STARTED

> Reference resolution and context across turns. Targets Greylock prize (7+ turn conversations).

- [ ] Track `lastResults`, `recentEntities` in agent state
- [ ] Reference resolution: "the first one", "that cheaper one", "go back"
- [ ] Refinement: "filter by price under 50", "show me only wireless"
- [ ] Context carryover: agent knows what page is open, what products were shown
- [ ] Test: 7+ turn shopping flow end-to-end

---

## Phase 8: Elasticsearch + JINA (Knowledge Base) — ❌ NOT STARTED

> Semantic browsing memory. Targets Elastic prize ($2k/$1k).

- [ ] Sign up for Elastic Cloud (14-day free trial, no credit card)
- [ ] Get JINA API key (free 10M tokens)
- [ ] Install `@elastic/elasticsearch` in server
- [ ] `server/src/lib/elasticsearch.ts` — Elastic client, JINA inference endpoint, index management
- [ ] Create JINA inference endpoint in Elasticsearch (`semantic_text` auto-embeds via JINA)
- [ ] Indices: `browsing-history` (semantic), `user-profile`, `products-viewed`
- [ ] Auto-index every page Stagehand extracts → semantic browsing memory
- [ ] Semantic search: "find that article I read earlier" → JINA-embedded kNN search
- [ ] KnowledgeBase interface: `getProfile()`, `indexPageVisit()`, `searchBrowsingHistory()`

---

## Phase 9: Client Deepgram Migration — ❌ NOT STARTED

> Server-side Deepgram is ready but client still uses Web Speech API.

- [ ] New `useDeepgramSTT.ts` hook on client
  - Mic capture via `MediaRecorder` or `AudioWorklet` → raw audio → `stt_audio` socket event
  - Listen for `stt_transcript` events from server
  - `onFinalTranscript` callback (same interface as current hook)
- [ ] Wire into `VoiceAgent.tsx` replacing `useSpeechRecognition`
- [ ] Verify barge-in still works with Deepgram path
- [ ] Remove Web Speech API fallback (or keep as option)

---

## Phase 10: Electron Overlay — ❌ NOT STARTED (deferred)

> Next.js client is fine for demo. Migrate later if time permits.

- [ ] Scaffold Electron app with `electron-vite` (alex8088)
- [ ] Migrate Next.js client UI into Electron renderer
- [ ] Always-on-top, transparent, frameless, click-through window
- [ ] Global keyboard shortcuts
- [ ] Deepgram STT required (Web Speech API broken in Electron)

---

## Phase 11: Polish + Demo Prep — ❌ NOT STARTED

- [ ] Thread AbortSignal through supervisor → agents → Stagehand → Cartesia
- [ ] Status events: emit `thinking` / `acting` / `speaking` / `listening` with labels
- [ ] Error recovery: retry failed `act()` with `observe()` fallback
- [ ] Demo mode: slight action delay so judges can follow the browser
- [ ] Demo scripts for each prize track (timed, rehearsed):
  1. Shopping flow (Visa $10k): search → compare → cart → checkout in 5+ turns
  2. General browsing: article summarization, page description
  3. Coding for blind devs (YC/SigmaOS)
- [ ] Visible browser choreography
- [ ] Devpost submission writeup

---

## Current Dependency State (`server/package.json`)

### Installed:
- `@anthropic-ai/sdk` — Claude API
- `@browserbasehq/stagehand` — Browser automation
- `@deepgram/sdk` — Deepgram STT (server-side)
- `@google/genai` — Gemini API
- `@langchain/langgraph@0.2.74` — Supervisor graph
- `@langchain/anthropic@0.3.34` — Claude for LangGraph
- `@langchain/core@0.3.80` — LangChain core
- `express`, `socket.io`, `cors` — Server framework
- `ws` — WebSocket client (for Cartesia TTS)
- `zod` — Schema validation
- `uuid`, `dotenv` — Utilities

### Missing (needed for remaining phases):
- `@elastic/elasticsearch` — Phase 8 (knowledge base)

> **Version pinning**: Stagehand needs `@langchain/core@0.3.x`. Use `@langchain/anthropic@0.3.x` and `@langchain/langgraph@0.2.x` (NOT latest which requires core@1.x).
