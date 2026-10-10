# Accessible Browser for Blind Users - TreeHacks 2026

> A voice-first, always-on-top desktop overlay that transforms the entire computer into a task-oriented interface for blind users.

## Project Vision

Instead of reading every DOM element sequentially, our overlay:

- **Runs above everything** as a persistent Electron overlay — always-on-top, transparent, click-through
- **Analyzes page intent** using specialized AI agents (commerce, coding, desktop, general)
- **Offers voice menus** of actions ("Add to cart", "Read main article", "Fill form")
- **Understands user context** (preferences, budget, medical profile) to filter and prioritize content
- **Handles multi-turn workflows** via a LangGraph supervisor routing to domain specialists
- **Remembers everything** — Elasticsearch + JINA embeddings provide semantic browsing memory ("find that article I read earlier")
- **Streams audio responses** with sub-100ms latency via Cartesia for conversational feel
- **Controls the full desktop** — Anthropic Computer Use beta API (`computer-use-2025-01-24`) with native macOS JXA/AppleScript for OS-level control: VS Code, Terminal, any app. Stagehand handles browser; Anthropic CUA handles desktop.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│  CLIENT LAYER (Electron overlay — primary | Next.js — fallback)  │
│                                                                  │
│  Electron: liquid-glass UI, always-on-top, Cmd+Shift+V hotkey   │
│  Server auto-spawn, tray menu, accessibility permission check    │
│  Mic capture → Deepgram STT  ←→  Cartesia Player (TTS)          │
│  React UI — lightweight voice I/O terminal                       │
│  Hooks: useSocket, useDeepgramSTT, useAudioPlayer                │
│  PCM s16le @ 24kHz audio playback with jitter buffer             │
└──────────────────────────────────────────────────────────────────┘
                    │  Socket.io (persistent, bi-directional)
                    │  Events: user_message, stt_start/audio/stop,
                    │          audio_chunk, audio_done, status, etc.
                    ▼
┌──────────────────────────────────────────────────────────────────┐
│               SERVER LAYER (Orchestrator)                         │
│                                                                  │
│   Node.js + Express + Socket.io                                  │
│   VoicePipeline: sentence splitting → Cartesia TTS → audio       │
│   LangGraph Supervisor: Haiku classify → 4-way agent routing     │
│   Elasticsearch knowledge base (auto-indexing + memory context)  │
│   REST: POST /api/chat (text-only) + GET /health                 │
└──────────────────────────────────────────────────────────────────┘
        │              │              │              │
        ▼              ▼              ▼              ▼
┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────────────┐
│ COMMERCE   │ │ CODING     │ │ DESKTOP    │ │ GENERAL            │
│ AGENT      │ │ AGENT      │ │ AGENT      │ │ AGENT              │
│            │ │            │ │            │ │                    │
│ Web search │ │ Read/write │ │ Screenshot │ │ Web search         │
│ Browser    │ │ Edit files │ │ Click/type │ │ Browser navigation │
│ Cart/buy   │ │ Run cmds   │ │ Open apps  │ │ Page description   │
│ Budget     │ │ Search code│ │ Shortcuts  │ │ Spatial layout     │
└────────────┘ └────────────┘ └────────────┘ └────────────────────┘
      │              │              │              │
      ▼              ▼              ▼              ▼
┌─────────────┐ ┌──────────┐ ┌──────────────┐ ┌─────────────┐
│ BROWSER     │ │ FILE I/O │ │ DESKTOP CTRL │ │ BROWSER     │
│ (Stagehand) │ │ + Shell  │ │ (Anthropic   │ │ (Stagehand) │
│             │ │          │ │  CUA Beta +  │ │             │
│ Chromium    │ │ fs, exec │ │  JXA/Apple-  │ │ Chromium    │
│ extract()   │ │ sandboxed│ │  Script)     │ │ extract()   │
│ act()       │ │ to       │ │              │ │ act()       │
│ observe()   │ │ workspace│ │ Screenshots  │ │ observe()   │
│ navigate()  │ │          │ │ Mouse/KB     │ │ navigate()  │
└─────────────┘ └──────────┘ └──────────────┘ └─────────────┘
                                                      │
                                                      ▼
┌──────────────────────────────────────────────────────────────────┐
│  MEMORY LAYER (Elasticsearch + JINA) — IMPLEMENTED               │
│                                                                  │
│  Elastic Cloud + JINA embeddings (RRF hybrid search)             │
│  • browsing-history (auto-indexed from browser agents)           │
│  • products-viewed (auto-indexed from commerce extractions)      │
│  • conversation-history (auto-indexed every turn)                │
│  Memory context injected into agent prompts per turn             │
│  Session restore from ES on reconnect                            │
└──────────────────────────────────────────────────────────────────┘
              │
              ▼
┌──────────────────────────────────────────────────────────────────┐
│              AUDIO SERVICES (Voice)                               │
│                                                                  │
│  Deepgram Nova-3: STT via WebSocket proxy (150ms latency)        │
│  Cartesia Sonic-2: TTS via WebSocket, PCM s16le @ 24kHz          │
│  VoicePipeline: sentence splitting, interim speech (throttled)   │
│  Perplexity Sonar: real-time web search for agents               │
└──────────────────────────────────────────────────────────────────┘
```

---

## Layer Contracts (Black Box I/O Specs)

> Every layer is a **black box**. It consumes a typed input, performs its work, and returns a typed output as a promise. No layer may reach into another layer's internals. All communication happens through these contracts.

### Contract 1: Client → Server (Socket.io Uplink)

The client is a dumb I/O terminal (Next.js, Electron migration deferred). It captures mic audio, streams to Deepgram via the server for STT, and ships final transcripts. It never decides what to do with the text.

```typescript
// ── CLIENT EMITS (Socket.io events — underscore naming) ──────

// "user_message" — final transcript from STT
interface UserMessagePayload {
  text: string;
}

// "stop_audio" — user spoke during playback (barge-in)
// No payload

// "stt_start" — begin Deepgram STT session
// No payload

// "stt_audio" — raw mic audio for Deepgram
// Payload: Buffer (WebM/Opus chunks from MediaRecorder, 250ms intervals)

// "stt_stop" — end Deepgram STT session
// No payload

// "restore_session" — reload conversation from previous session
interface RestoreSessionPayload {
  previousSessionId: string;
}
```

**Rules:**

- Client sends mic audio to server via Socket.io `stt_audio`; server proxies to Deepgram WebSocket for STT.
- Client sends `user_message` with the final transcript after UtteranceEnd from Deepgram.
- Client MUST send `stop_audio` before any new `user_message` if audio is currently playing.
- Client has NO knowledge of agents, pages, or browser state.
- All socket event names use underscores (e.g., `user_message` not `user:message`).

---

### Contract 2: Server → Client (Socket.io Downlink)

The server pushes responses back to the client. The client renders them without interpretation.

```typescript
// ── SERVER EMITS (Socket.io events — underscore naming) ──────

// "status" — UI state indicator
interface StatusPayload {
  state: "idle" | "thinking" | "speaking";
  generating?: boolean; // true while LLM is still streaming
}

// "assistant_text" — streaming text from agent response
interface AssistantTextPayload {
  text: string; // Text chunk (or empty when done)
  done: boolean; // true = final chunk
}

// "audio_chunk" — streaming TTS from Cartesia
interface AudioChunkPayload {
  data: string; // base64-encoded PCM s16le @ 24kHz audio
}

// "audio_done" — TTS finished for this utterance
// No payload: {}

// "interim_text" — interim speech during agent work
interface InterimTextPayload {
  text: string; // e.g. "Searching Amazon."
}

// "console_log" — agent action log for display
interface ConsoleLogPayload {
  message: string;
}

// "stt_transcript" — interim/final transcripts from Deepgram
interface SttTranscriptPayload {
  text: string;
  is_final: boolean;
  speech_final: boolean;
}

// "stt_utterance_end" — Deepgram detected end of speech
// "stt_speech_started" — Deepgram detected speech start
// "stt_ready" — Deepgram connection established
// "stt_error" — Deepgram error

// "session_restored" — conversation restored from ES
interface SessionRestoredPayload {
  count: number;
}

// "error"
interface ErrorPayload {
  message: string;
}
```

**Rules:**

- Server MUST send `status` with `state: "thinking"` before any processing begins.
- Server MUST send `status` with `state: "speaking"` before the first `audio_chunk`.
- Server MUST send `audio_done` after the final chunk of every utterance.
- Server MUST send `status` with `state: "idle"` after `audio_done`.
- All socket event names use underscores (not colons).

---

### Contract 3: Orchestrator → Supervisor (Intent Routing)

The orchestrator (Express handler) passes the user's message plus session context to the LangGraph supervisor. The supervisor uses a Haiku classification node for intent routing and dispatches to the appropriate agent node.

```typescript
// ── ORCHESTRATOR → SUPERVISOR ─────────────────────────────────

/** Input to runSupervisor() — called from index.ts user:message handler. */
interface SupervisorInput {
  userInput: string; // The final transcript
  conversationHistory: ConversationTurn[]; // Last N turns for context
  userProfile: UserProfile | null; // From seed profile (Phase 6: Elasticsearch)
  pageSnapshot: PageSnapshot | null; // Current browser state (null if unknown)
}

interface ConversationTurn {
  role: "user" | "assistant";
  text: string;
  agent?: string; // Which agent handled this turn
  timestamp: number;
}

interface PageSnapshot {
  url: string;
  title: string;
  description?: string;
}

interface UserProfile {
  name: string;
  preferences: Record<string, string>; // budget, currency, preferredStores, etc.
  accessibility: { screenReader: boolean; voiceOnly: boolean };
}

// ── SUPERVISOR → ORCHESTRATOR (return) ────────────────────────

type AgentCategory = "commerce" | "coding" | "desktop" | "general";

interface ClassificationResult {
  category: AgentCategory;
  secondaryCategory?: AgentCategory | null; // For compound tasks (e.g., "open VS Code and write code")
  primaryTask?: string | null; // Scoped instruction for first agent
  secondaryTask?: string | null; // Scoped instruction for second agent
  subIntent: string; // e.g. "product_search", "open_app", "navigate"
  secondarySubIntent?: string | null; // Sub-intent for second agent
  entities: Record<string, unknown>;
}

interface SupervisorResult {
  responseText: string; // TTS-ready text (markdown stripped, voice-formatted)
  agentCategory: AgentCategory;
  actions: unknown[];
}
```

**LangGraph StateGraph flow:**
```
START → classify (Haiku + parallel ES memory fetch)
  → [conditional: commerce|coding|desktop|general]
  → agent runs ReAct loop with tools
  → recheck (compound task chaining: if secondaryCategory, route to second agent)
  → formatResponse → END
```

**Rules:**

- Supervisor MUST always return a `responseText` — even if an error occurred, it must be a speakable sentence.
- Supervisor MUST populate `agentCategory` so the orchestrator can track routing accuracy.
- `conversationHistory` is append-only — the supervisor MUST NOT mutate it. The orchestrator owns history.
- If the supervisor cannot determine intent, it MUST route to `"general"` as the default.
- The `formatResponse` node strips markdown, URLs, and list markers for clean TTS output.

---

### Contract 4: Supervisor → Specialist Agent

Each specialist agent (Commerce, General) receives the same input shape and returns the same output shape. Agents are interchangeable black boxes from the supervisor's perspective.

```typescript
// ── SUPERVISOR → AGENT ────────────────────────────────────────

/** Every specialist agent receives this identical input. */
interface AgentInput {
  task: string; // Natural language task description from supervisor
  userMessage: string; // Original user transcript for context
  conversationHistory: ConversationTurn[];
  userProfile: UserProfile;
  currentPage: PageSnapshot;
  executionContext: ExecutionContext; // Handle to the execution layer
}

interface ExecutionContext {
  /** Execute browser actions. Returns result. Agent calls these — never touches Stagehand directly. */
  extract: (instruction: string, schema: ZodSchema) => Promise<ExtractResult>;
  act: (instruction: string) => Promise<ActResult>;
  observe: () => Promise<ObserveResult>;
  navigate: (url: string) => Promise<NavigateResult>;
}

// ── AGENT → SUPERVISOR (return) ───────────────────────────────

/** Every specialist agent returns this identical output. */
interface AgentOutput {
  responseText: string; // What to say to the user (plain English, conversational)
  actionsTaken: ActionLog[]; // Record of what the agent did
  dataExtracted?: Record<string, unknown>; // Structured data pulled from pages
  needsFollowUp: boolean; // true = agent needs more info from user
  followUpPrompt?: string; // If needsFollowUp, what to ask
  error?: AgentError; // Non-null if something went wrong
}

interface ActionLog {
  type: "extract" | "act" | "observe" | "navigate";
  instruction: string;
  success: boolean;
  timestamp: number;
}

interface AgentError {
  code:
    | "EXTRACTION_FAILED"
    | "ACTION_FAILED"
    | "PAGE_NOT_FOUND"
    | "TIMEOUT"
    | "SAFETY_BLOCK";
  message: string;
  recoverable: boolean;
}
```

**Rules:**

- Every agent MUST return an `AgentOutput` — never throw unhandled. Errors go in `error` field.
- Agents MUST NOT call Stagehand directly. They use the `ExecutionContext` interface which wraps Stagehand.
- Agents MUST NOT produce audio or interact with Socket.io. They return text; the orchestrator handles TTS.
- `responseText` MUST be phrased as natural speech (no markdown, no bullet points, no code).
- If `needsFollowUp` is true, `followUpPrompt` MUST be populated.

---

### Contract 5: Execution Layer (Stagehand Wrapper)

The execution layer wraps Stagehand and exposes a clean interface. Agents never touch Playwright or Stagehand directly.

```typescript
// ── EXECUTION LAYER I/O ───────────────────────────────────────

/** Result of extract(): pulls structured data from the current page. */
interface ExtractResult {
  success: boolean;
  data: Record<string, unknown> | null; // Zod-validated structured data
  error?: string;
}

/** Result of act(): performs a browser action (click, type, scroll, etc). */
interface ActResult {
  success: boolean;
  description: string; // What happened: "Clicked 'Add to Cart' button"
  newUrl?: string; // If navigation occurred
  error?: string;
}

/** Result of observe(): discovers available actions on the current page. */
interface ObserveResult {
  success: boolean;
  actions: AvailableAction[]; // What the user/agent can do on this page
  error?: string;
}

interface AvailableAction {
  description: string; // "Click the 'Sign In' button"
  selector: string; // CSS selector (for internal use only)
  type: "click" | "type" | "scroll" | "select" | "navigate";
}

/** Result of navigate(): goes to a URL. */
interface NavigateResult {
  success: boolean;
  finalUrl: string; // After redirects
  pageTitle: string;
  error?: string;
}
```

**Rules:**

- The execution layer MUST handle all Playwright/Stagehand errors internally and return `success: false` with an `error` message — never throw.
- `extract()` MUST validate returned data against the provided Zod schema. Invalid data → `success: false`.
- `act()` MUST wait for navigation/network idle after actions that trigger page changes.
- `observe()` MUST return only visible, interactable elements.
- The execution layer MUST maintain a single Chromium instance across the session — never spawn multiple browsers.

---

### Contract 5b: Desktop Execution Layer (Anthropic Computer Use Beta)

> **API**: Anthropic Computer Use beta (`computer-use-2025-01-24`)
>
> **Purpose**: Full OS-level desktop control for the **Desktop Agent**. Controls VS Code, Terminal, Finder, and any desktop app — everything Stagehand cannot reach. No Python sidecar needed — runs natively in the Node.js server via macOS JXA/AppleScript.

The desktop agent uses Anthropic's CUA beta API directly, with `computerControl.ts` providing native macOS mouse/keyboard/screenshot capabilities.

```
┌──────────────────────────────────────────────────────────────────────┐
│  Desktop Agent Node (TypeScript — server/src/agents/desktop.ts)      │
│                                                                      │
│  1. Receives user intent: "open VS Code" or "fix the bug"           │
│  2. Calls anthropic.beta.messages.create with computer_20250124 tool │
│  3. Model sees screenshot → reasons → requests action                │
│  4. computerControl.ts executes: click, type, key, scroll, etc.     │
│  5. Tool result (screenshot/text) sent back to model                 │
│  6. Loop continues until model stops requesting tool_use             │
│  7. Agent formats spoken response: "I opened VS Code for you."      │
└──────────────────────────────────────────────────────────────────────┘
        │ computerControl.ts
        ▼
┌──────────────────────────────────────────────────────────────────────┐
│  macOS Desktop Control (server/src/lib/computerControl.ts)           │
│                                                                      │
│  Native macOS control via:                                           │
│    • JXA (osascript -l JavaScript) for CoreGraphics mouse events    │
│    • AppleScript for keyboard input via System Events                │
│    • screencapture + sips for screenshot capture + resize            │
│                                                                      │
│  Actions:                                                            │
│    screenshot    — capture + resize to API dimensions (≤1280x800)    │
│    left_click    — CoreGraphics mouse down/up at screen coordinates  │
│    right_click   — right mouse button                                │
│    double_click  — click count = 2                                   │
│    mouse_move    — move cursor to position                           │
│    type          — System Events keystroke (full Unicode)            │
│    key           — keyboard shortcuts (Cmd+C, Ctrl+Shift+F, etc.)   │
│    scroll        — scroll wheel events at position                   │
│    left_click_drag — click + drag to end coordinate                  │
│    wait          — pause for N seconds                               │
│                                                                      │
│  Coordinate scaling:                                                 │
│    API coords (≤1280x800) → screen coords via aspect ratio          │
└──────────────────────────────────────────────────────────────────────┘
        │ JXA / AppleScript / screencapture
        ▼
┌──────────────────────────────────────────────────────────────────────┐
│  Desktop OS (macOS)                                                  │
│  VS Code, Terminal, Finder, Spotify, any app                         │
└──────────────────────────────────────────────────────────────────────┘
```

**Desktop Agent Implementation** (`server/src/agents/desktop.ts`):

The desktop agent uses Anthropic's computer-use beta API directly (not LangChain tools) with a native TypeScript `computerControl.ts` module for macOS control.

```typescript
// server/src/agents/desktop.ts — simplified view
import Anthropic from "@anthropic-ai/sdk";
import { createMacOSControl } from "../lib/computerControl.js";

const MAX_ITERATIONS = 15;
const anthropic = new Anthropic();
const computerControl = createMacOSControl();

// Two system prompts based on subIntent
const DESKTOP_SYSTEM_PROMPT = `You are a desktop control assistant...`;
const CODING_DESKTOP_PROMPT = `You are a coding assistant that controls the desktop...`;

// Compute API dimensions (maintain aspect ratio within 1280x800)
const displaySize = computerControl.getDisplaySize();
const scale = Math.min(1280 / displaySize.width, 800 / displaySize.height, 1);
const apiWidth = Math.round(displaySize.width * scale);
const apiHeight = Math.round(displaySize.height * scale);

const tools = [{
  type: "computer_20250124",
  name: "computer",
  display_width_px: apiWidth,
  display_height_px: apiHeight,
}];

// Main loop: model requests actions, we execute them
for (let i = 0; i < MAX_ITERATIONS; i++) {
  const response = await anthropic.beta.messages.create({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 1024,
    system: systemPrompt,
    tools,
    messages,
    betas: ["computer-use-2025-01-24"],
  });

  // Execute tool_use blocks (screenshot, click, type, key, scroll, etc.)
  // Send results back as tool_result messages
  // Loop until model stops requesting tool_use
}
```

**computerControl.ts Actions Available**:

| Action | What it does | Implementation |
|--------|-------------|----------------|
| `screenshot` | Capture screen, resize to API dimensions | `screencapture -x` + `sips` resize |
| `left_click(x,y)` | Click at coordinates | JXA CoreGraphics mouse events |
| `right_click(x,y)` | Right-click | JXA CoreGraphics mouse events |
| `double_click(x,y)` | Double-click | JXA with clickState=2 |
| `mouse_move(x,y)` | Move cursor | JXA CoreGraphics |
| `type(text)` | Type text | AppleScript System Events keystroke |
| `key(combo)` | Keyboard shortcuts | AppleScript key code + modifiers |
| `scroll(x,y,dir,amt)` | Scroll at position | JXA scroll wheel events |
| `left_click_drag` | Click and drag | Click + mouse move |
| `wait(duration)` | Pause | setTimeout |

**Infrastructure Requirements**:

| Component | Requirement | Hackathon Setup |
|-----------|-------------|-----------------|
| Anthropic API key | `ANTHROPIC_API_KEY` env var | Same key as supervisor + agents |
| macOS Accessibility | System Settings → Privacy → Accessibility | Grant to Terminal / VS Code |
| macOS Screen Recording | System Settings → Privacy → Screen Recording | Grant to Terminal |
| No Python sidecar | Runs natively in Node.js | Zero additional setup |

**Rules:**

- Desktop agent runs on the same machine as the demo (it controls the local screen).
- Uses the same `ANTHROPIC_API_KEY` as all other Claude API calls.
- ALWAYS use Spotlight (Cmd+Space) to open apps — never trust visual identification (VS Code and Cursor look identical).
- SCOPE: only perform exactly what the user asks — nothing more.
- Max 15 iterations per task to prevent runaway loops.

---

### Contract 6: User Profile & Knowledge Base (Elasticsearch + JINA) ✅ IMPLEMENTED

**Current state:** Elasticsearch fully integrated via `server/src/lib/elasticsearch.ts`. Elastic Cloud with JINA inference endpoint for `semantic_text` auto-embedding. RRF hybrid search (semantic + fuzzy) with fallback to semantic-only for older ES versions. Graceful degradation when ES unavailable — seed profile used as fallback.

```typescript
// ── USER PROFILE ─────────────────────────────────────────────

interface UserProfile {
  name: string;
  preferences: Record<string, string>; // budget, currency, preferredStores, language
  accessibility: { screenReader: boolean; voiceOnly: boolean };
}

// Seed fallback: server/data/seed-user-profile.json
// { name: "Alex", preferences: { budget: "500", currency: "USD",
//   preferredStores: "Amazon, Best Buy", language: "en" },
//   accessibility: { screenReader: true, voiceOnly: true } }

// ── KNOWLEDGE BASE (Elasticsearch + JINA — IMPLEMENTED) ─────

interface KnowledgeBase {
  isAvailable: () => boolean;
  getProfile: (sessionId: string) => Promise<UserProfile>;
  updatePreference: (sessionId: string, key: string, value: unknown) => Promise<void>;
  indexPageVisit: (data: { url: string; title: string; content: string; sessionId: string; userQuery?: string }) => Promise<void>;
  indexProductViewed: (data: { name: string; price?: string; rating?: string; store?: string; url?: string; sessionId: string }) => Promise<void>;
  searchBrowsingHistory: (query: string, sessionId?: string, limit?: number) => Promise<PageVisit[]>;
  searchProductsViewed: (query: string, sessionId?: string, limit?: number) => Promise<ProductViewed[]>;
  searchConversationHistory: (query: string, sessionId?: string, limit?: number) => Promise<ConversationEntry[]>;
  fetchMemoryContext: (query: string, sessionId?: string) => Promise<string>; // Aggregates all 3 search types + formats for agent prompt
  indexConversation: (entry: { role: string; text: string; sessionId: string; agent?: string }) => Promise<void>;
  restoreConversation: (sessionId: string, limit?: number) => Promise<ConversationTurn[]>;
}

// Indices: user-profile, browsing-history, products-viewed, conversation-history
// Search: RRF (Reciprocal Rank Fusion) combining semantic (JINA) + fuzzy matching
// Auto-indexing: commerce/general agents index page visits + products (fire-and-forget)
// Memory context: injected into agent prompts per turn via fetchMemoryContext()
```

**Rules:**

- User profile loaded from ES (falls back to seed JSON if ES unavailable).
- Every page visited is auto-indexed to Elasticsearch via `indexPageVisit` for semantic recall.
- Every product extracted is auto-indexed via `indexProductViewed`.
- Every conversation turn is indexed via `indexConversation`.
- `searchBrowsingHistory` uses JINA embeddings for semantic search via RRF hybrid.
- All methods return sensible defaults if ES is unreachable (graceful degradation).

---

### Contract 7: Audio Services (Cartesia TTS)

The audio layer converts text to streaming audio. It has no knowledge of agents or user context.

```typescript
// ── AUDIO SERVICE I/O ─────────────────────────────────────────

interface TTSRequest {
  text: string; // Plain English text to speak
  voiceId: string; // Cartesia voice ID
  speed: "slow" | "normal" | "fast"; // Maps to user preference
  emotion?: "neutral" | "friendly" | "urgent" | "empathetic";
  outputFormat: "pcm_s16le"; // 24kHz sample rate
}

/** The TTS service returns an async iterator of audio chunks. */
interface TTSStream {
  [Symbol.asyncIterator](): AsyncIterator<TTSChunk>;
  cancel: () => void; // Called on user interrupt
}

interface TTSChunk {
  audio: Buffer; // Raw PCM bytes
  chunkIndex: number;
  isFinal: boolean;
}
```

**Rules:**

- The audio service MUST begin streaming the first chunk within 200ms of receiving the request.
- `cancel()` MUST immediately stop generation and release resources.
- The audio service MUST NOT buffer the full response before streaming — chunk-by-chunk only.
- The orchestrator calls `cancel()` when it receives an `interrupt` from the client.
- `text` MUST be plain English — no SSML, no markdown. The orchestrator sanitizes before calling.

---

### Data Flow Summary

```
┌─────────┐  ClientMessage   ┌────────────┐  SupervisorInput   ┌────────────┐  AgentInput   ┌──────────┐
│ OVERLAY  │ ──────────────→ │  ORCHEST-   │ ────────────────→ │ SUPERVISOR │ ────────────→ │  AGENT   │
│(Electron)│                 │  RATOR      │                   │(LangGraph) │              │(Spec.)   │
│          │ ←────────────── │  (Express)  │ ←──────────────── │            │ ←──────────── │          │
└─────────┘  ServerMessage   └────────────┘  SupervisorOutput  └────────────┘  AgentOutput  └──────────┘
                                  │  ▲                                            │  ▲
                           TTSReq │  │ TTSStream                    ExecutionCtx  │  │ ExtractResult
                                  ▼  │                                            ▼  │  ActResult
                      ┌────────────────────┐                         ┌──────────────────────┐
                      │ DEEPGRAM  │CARTESIA│                         │ STAGEHAND │ELASTIC   │
                      │ (STT)     │(TTS)   │                         │ (Browser) │(Memory)  │
                      └────────────────────┘                         └──────────────────────┘
```

Each arrow is a **typed promise**. Every call returns a well-defined result or a structured error — never `undefined`, never raw exceptions. If you are implementing a layer, you only need to read the two contracts it touches (its input and its output).

---

## Design Decisions

| Decision               | Choice                   | Alternatives Considered  | Rationale                                                                      |
| ---------------------- | ------------------------ | ------------------------ | ------------------------------------------------------------------------------ |
| **Language**           | TypeScript (full stack)  | Python, Hybrid           | Stagehand is TS-native; single runtime across client + server                  |
| **Client Shell**       | Electron (overlay) + Next.js (fallback) | Next.js only       | Electron overlay runs above everything; global shortcuts, tray menu, click-through. Next.js as lightweight fallback |
| **Browser Engine**     | Visible Chromium (local) | Browserbase (headless)   | Judges see real-time navigation; more impressive demo. Browserbase as fallback |
| **Browser Automation** | Stagehand                | Raw Playwright, Selenium | AI-assisted selectors, `extract()`/`act()`/`agent()`, Browserbase prize        |
| **Orchestration**      | LangGraph + Haiku        | Hand-rolled, CrewAI      | StateGraph scales to more agents; conditional edges, checkpointing; Haiku for fast classification |
| **Agent Reasoning**    | Claude Sonnet 4.5        | GPT-4o, Gemini           | Best planning/reasoning for multi-step browser tasks                           |
| **Realtime Comms**     | Socket.io                | WebSockets raw, SSE      | Bi-directional; supports interruption; room-based state                        |
| **Voice Input**        | Deepgram Nova-3          | Web Speech API, Whisper  | Web Speech API broken in Electron; Deepgram: 150ms, best WER, $200 free       |
| **Voice Output**       | Cartesia Sonic-2         | ElevenLabs, Smallest.ai  | Sub-100ms streaming, emotional range, already integrated                       |
| **Knowledge/Memory**   | Elasticsearch + JINA     | SQLite + JSON            | Semantic search via JINA embeddings; browsing memory; Elastic prize track      |
| **Server**             | Node.js + Express        | Next.js API routes only  | Socket.io needs persistent connections; Express gives control                  |
| **Desktop Agent**      | Anthropic CUA Beta + JXA | Agent-S, Stagehand CUA | Native TypeScript (no Python sidecar); uses same Anthropic API key; macOS JXA for mouse/keyboard |

### Key Tradeoffs

**LangGraph Supervisor with Haiku Classification**

LangGraph StateGraph provides the orchestration layer: a classifier node (Haiku, sub-200ms) routes to 4 agent nodes (commerce, coding, desktop, general) via conditional edges. The graph scales cleanly — adding a new agent means adding one node and one conditional edge. Compound tasks chain two agents via `recheckNode` (e.g., desktop → coding). LangGraph also provides checkpointing, retries, and human-in-the-loop gates when needed later. Each agent node uses Sonnet for reasoning (desktop uses Anthropic CUA API directly).

**Three Execution Layers: Stagehand (Browser) + File I/O (Coding) + Anthropic CUA (Desktop)**

Three execution layers, each for what it's best at:
- **Stagehand** handles browser-only tasks (shopping, web navigation, form filling). Uses accessibility tree + AI-assisted selectors. Fast, TypeScript-native, no GPU needed. Used by commerce and general agents.
- **File I/O + Shell** handles coding tasks directly via filesystem. Read/write/edit files, run commands, search code. Sandboxed to workspace directory. Much faster than controlling VS Code visually. Used by the coding agent.
- **Anthropic CUA** handles full desktop GUI tasks (opening apps, clicking buttons, typing in visible apps). Uses screenshots + Claude vision + native macOS control (JXA/AppleScript). No Python sidecar or GPU needed. Used by the desktop agent.

Why Anthropic CUA instead of Agent-S? Anthropic CUA runs natively in TypeScript (no Python sidecar, no GPU for grounding model, no pyautogui). It uses the same Anthropic API key as everything else. The tradeoff is that it uses more API credits per interaction (screenshots are vision tokens), but the zero-infrastructure requirement is critical for a hackathon.

Why a separate coding agent with file I/O? The coding agent doesn't need to visually interact with VS Code — it operates directly on the filesystem. `read_file`, `edit_file`, `run_command` are much faster and more reliable than controlling VS Code through screenshots. The desktop agent handles the visual GUI interaction when needed (e.g., "open VS Code").

**Deepgram Nova-3 vs Web Speech API**

Web Speech API is fundamentally broken in Electron — Google's SpeechRecognition fails with "network error" due to shared/rate-limited API keys (electron/electron#46143, unfixed since Electron 32+). Deepgram Nova-3 provides WebSocket streaming with interim/final transcripts (same pattern), 150ms latency, best-in-class 6.84% WER, and $200 free credits (~433 hours).

**Visible Chromium vs Browserbase Headless**

Running a visible Chromium instance lets judges see the "ghost" navigating pages in real-time—far more compelling for demos than describing headless actions. We still use Stagehand's APIs (qualifying for Browserbase prize) but control a local browser. If deployment issues arise, Browserbase is the fallback.

**Electron Overlay vs Browser-Only Web App**

Running as an Electron overlay instead of a Next.js browser tab means the assistant persists above all windows — the user never has to find or switch to it. Global shortcuts (`Cmd+Shift+V`) work regardless of which app has focus. Click-through mode lets the overlay sit transparently above the desktop without blocking interaction. The overlay architecture is extensible: the desktop agent already controls any desktop app (VS Code, Terminal, Spotify) via Anthropic CUA, making the tool a true full-computer accessibility layer. Electron uses Vite + React 19 + `liquid-glass-react` for a macOS-native glassmorphism look. The Next.js client is kept as a lightweight web fallback.

**Cartesia vs Edge-TTS**

Cartesia's sub-100ms streaming latency makes the experience feel like a real conversation rather than command-response. The emotional range adds personality. This is a differentiator for Decagon (best conversation assistant) and general demo impressions.

---

## Prize Strategy

| #   | Track            | Prize                        | How We Qualify                                                                                | Priority |
| --- | ---------------- | ---------------------------- | --------------------------------------------------------------------------------------------- | -------- |
| 1   | **Visa**         | $10k in Visa cards           | Commerce Agent: full shopping flow with cart validation, budget checks, checkout              | HIGH     |
| 2   | **Healthcare**   | $4k                          | General Agent with user medical profile: condition-aware browsing, medication awareness (needs medical profile data added to seed profile) | HIGH     |
| 3   | **Greylock**     | Warriors courtside           | Multi-turn agent conversations: 5+ turn shopping, form filling, research workflows            | HIGH     |
| 4   | **YC (SigmaOS)** | YC interview                 | Browser reimagined for accessibility—same "rethink the browser" thesis as SigmaOS             | HIGH     |
| 5   | **Fetch.ai**     | Overall AI Agent             | LangGraph supervisor coordinating 2 specialist agents autonomously                            | HIGH     |
| 6   | **Elastic**      | $2k/$1k                      | Elasticsearch + JINA semantic memory, Agent Builder, Workflows, Elastic Cloud                 | HIGH     |
| 7   | **Computer Use** | YC interview                  | Coding Agent uses computer use to read VS Code, identify a bug, and fix it live              | HIGH     |
| 8   | **Perplexity**   | $1.5k + office trip          | AI-powered search result summarization and contextual answers                                 | MED      |
| 9   | **Browserbase**  | $1k                          | All browser automation through Stagehand (Browserbase's tool)                                 | MED      |
| 10  | **Decagon**      | Switch w/ Mario              | Natural conversational assistant via Cartesia streaming + multi-turn context                   | MED      |

### Prize-Specific Implementation Notes

**Visa ($10k)** — Commerce Agent must handle:

- Product search and comparison with price/rating extraction
- Cart management (add, remove, validate totals)
- Budget checking against user-set limits
- Full checkout flow with address/payment form filling
- Coupon/discount detection

**Healthcare ($4k)** — General Agent uses user profile to provide:

- Condition-aware browsing (user's medications/allergies in system prompt)
- Medication awareness when browsing pharmacy sites
- Health-conscious product filtering and recommendations

**Greylock (Warriors courtside)** — Demonstrate:

- 5+ turn conversations that maintain context
- Complex workflows spanning multiple pages
- User preference learning within a session
- Graceful error recovery mid-workflow

**YC / SigmaOS (YC interview)** — Emphasize:

- Desktop overlay as an AI-native interface, not a screen reader bolt-on
- Task-oriented rather than page-oriented interaction
- The "SigmaOS thesis" applied to accessibility: the computer should work for you
- Runs above everything — not limited to a single browser tab

**Fetch.ai (Overall AI Agent)** — Show:

- Autonomous agent coordination via supervisor pattern
- Agents that decide when to hand off to specialists
- Self-correcting behavior when actions fail

**Elastic ($2k/$1k)** — Hits all 5 judging criteria:

- Elastic Cloud deployment with JINA inference endpoint (semantic_text auto-embeds)
- Indices: browsing-history, products-viewed, drug-interactions, user-profile
- Every Stagehand page extraction auto-indexed → semantic browsing memory
- Elastic Agent Builder: agent with browsing history search + medical lookup tools
- Elastic Workflow: auto-trigger drug safety check when new page is indexed
- Demo: "find that cold medicine I was looking at earlier" → semantic recall via JINA embeddings
- Low competition (~10-20 teams at TreeHacks); accessibility angle is unique and compelling

---

## User Profile

**Current** (`server/data/seed-user-profile.json`):

```json
{
  "name": "Alex",
  "preferences": {
    "budget": "500",
    "currency": "USD",
    "preferredStores": "Amazon, Best Buy",
    "language": "en"
  },
  "accessibility": {
    "screenReader": true,
    "voiceOnly": true
  }
}
```

Profile will be extended with medical data (conditions, medications, allergies) when Elasticsearch is integrated in Phase 5.

---

## Demo Scenarios (Priority Order)

### 1. Shopping (Visa $10k + Greylock)

```
User: "I need headphones under $200"
→ Search Amazon → Filter by price/rating → Compare top 3
→ "Sony WH-1000XM5, $198, 4.7 stars. Bose QC45, $179, 4.6 stars. Want details or add to cart?"
→ User: "Add the Sony" → Add → "Added. Your cart total is $198, within your budget. Checkout?"
→ User: "Yes" → Fill shipping → Confirm order
[5+ turn flow, budget awareness, full checkout]
```

### 2. Computer Use / Coding (YC/SigmaOS)

```
User: "I have a bug in my code, can you help?"
→ Coding Agent takes screenshot of VS Code via computer use
→ "I see a Python file open. There's a syntax error on line 12 —
   you have an unclosed parenthesis in the print statement. Want me to fix it?"
→ User: "Yes, fix it"
→ Agent clicks on line 12, adds closing bracket, saves file
→ "Done. I fixed the parenthesis on line 12. Want me to run it?"
→ User: "Yes, run it"
→ Agent opens Terminal, runs the script
→ "It ran successfully — output says 'Hello World'. No errors."
[Computer use demo: read code, identify bug, fix it, verify — all visible on screen]
```

### 4. Research / Search (Perplexity + Greylock)

```
User: "Find good restaurants near campus"
→ Google search → Extract results → Summarize top options
→ "5 restaurants found nearby.
   Green Table, 4.5 stars, 0.3 miles. Sakura Ramen, 4.7 stars, 0.5 miles.
   Read reviews or get directions?"
[Search summarization, multi-turn, contextual answers]
```

### 5. General Browsing (Decagon + Fetch.ai)

```
User: "Read this article and tell me the key points"
→ Extract article text → Summarize → Speak via Cartesia
→ "This article covers 3 main points: [summary]. Want me to
   read the full text, or continue to the next article?"
[Natural conversation, streaming audio, agent autonomy]
```

---

## Tech Stack

| Layer           | Technology               | Purpose                                |
| --------------- | ------------------------ | -------------------------------------- |
| Overlay         | Electron (Vite + concurrently) | Always-on-top, transparent, click-through desktop overlay with liquid-glass UI |
| Client UI       | React + Vite             | Lightweight I/O terminal inside Electron |
| Realtime        | Socket.io                | Bi-directional streaming, interruption |
| Server          | Node.js + Express        | Orchestration, session state           |
| Supervisor      | LangGraph + Haiku        | StateGraph orchestration, 4-way intent routing + compound tasks |
| Agent Reasoning | Claude Sonnet            | Multi-step planning and reasoning      |
| Browser Control | Stagehand v3             | AI-assisted browser automation (commerce + general agents) |
| **Desktop Control** | **Anthropic CUA Beta** | **Full OS control: VS Code, Terminal, any app (desktop agent)** |
| **Desktop I/O** | **JXA + AppleScript** | **Native macOS mouse/keyboard/screenshot via computerControl.ts** |
| **Web Search**  | **Perplexity Sonar** | **Real-time web search for commerce + general agents** |
| Browser         | Visible Chromium (local) | Real-time demo visibility              |
| Voice Input     | Deepgram Nova-3          | WebSocket streaming STT, 150ms latency |
| Voice Output    | Cartesia Sonic-2         | Sub-100ms streaming TTS                |
| Memory/Search   | Elasticsearch + JINA     | Semantic browsing memory, knowledge base |
| Agent Builder   | Elastic Agent Builder    | Kibana-based agent with search tools   |
| Data Fallback   | SQLite + JSON            | Local cache, offline fallback          |

---

## Implementation Plan

### Phase 1: Foundation — Socket.io + Electron Overlay

**Setup:**

```bash
# Server
mkdir server && cd server
npm init -y
npm install express socket.io @anthropic-ai/sdk @langchain/langgraph @langchain/anthropic @langchain/core @browserbasehq/stagehand @elastic/elasticsearch zod

# Client (Electron overlay via electron-vite)
npm create @quick-start/electron@latest client -- --template react-ts
cd client && npm install socket.io-client
```

**Files (current):**

```
/server
  src/
    index.ts              # Express + Socket.io server, Stagehand init, supervisor dispatch
    /agents
      supervisor.ts       # LangGraph StateGraph: classify → 4-way routing → recheck → format
      commerce.ts         # Commerce agent: ReAct loop with browser + search + knowledge tools
      coding.ts           # Coding agent: ReAct loop with file I/O + shell + search tools
      desktop.ts          # Desktop agent: Anthropic CUA beta (screenshot + mouse/keyboard)
      general.ts          # General agent: ReAct loop with browser + search + knowledge tools
      tools.ts            # All tool factories: browser, search, knowledge, coding
    /pipeline
      voicePipeline.ts    # TTS sentence splitting, interim speech with throttling
    /tts
      cartesia.ts         # Cartesia Sonic-2 WebSocket TTS (pcm_s16le @ 24kHz)
    /stt
      deepgram.ts         # Deepgram Nova-3 WebSocket STT proxy
    /lib
      stagehand.ts        # Stagehand v3 singleton + ExecutionContext wrapper
      elasticsearch.ts    # Elasticsearch + JINA knowledge base (RRF hybrid search)
      computerControl.ts  # macOS desktop control (JXA + AppleScript + screencapture)
    /socket
      handler.ts          # Socket connection handler (createHandler factory)
    /llm
      index.ts            # LLM provider factory
      types.ts            # LLMProvider interface
      anthropic.ts        # Anthropic streaming provider
      gemini.ts           # Gemini provider (optional)
    /test
      responses.ts        # Test mode scripted demo sequences
    /types
      index.ts            # All shared types (4 AgentCategories, ClassificationResult, KnowledgeBase)
  /data
    seed-user-profile.json  # Demo user profile (fallback when ES unavailable)
  .env                    # API keys (ANTHROPIC, CARTESIA, DEEPGRAM, PERPLEXITY, ELASTIC)

/electron (Electron overlay — PRIMARY CLIENT)
  src/
    main.ts               # Electron main process: server auto-spawn, hotkey, tray, IPC
    preload.ts             # IPC bridge (toggleOverlay, setClickThrough, onServerStatus)
    main.tsx               # React root entry point
    App.tsx                # Root React component with liquid-glass effect
    components/
      VoiceAgent.tsx       # Main orchestrator: state machine, chat UI, mic/mute buttons
    hooks/
      useSocket.ts         # Socket.io client connection & event handling
      useDeepgramSTT.ts    # Deepgram STT via server relay (WebM/Opus → Socket.io)
      useAudioPlayer.ts    # WebAudio API for 24kHz PCM playback with jitter buffer
    lib/types.ts           # AgentState, TranscriptEntry types
    index.css              # Tailwind + custom scrollbar, animations, drag regions

/client (Next.js — lightweight web fallback)
  src/
    app/page.tsx           # Main page
    components/
      VoiceAgent.tsx       # Main orchestrator — wires hooks together
      MicButton.tsx        # Mic toggle with pulse animation
      StatusIndicator.tsx  # Connection + agent state display
      Transcript.tsx       # Chat-style message list with streaming text
    hooks/
      useSocket.ts         # Socket.io connection + event routing
      useDeepgramSTT.ts    # Deepgram STT via server relay (mic capture + audio streaming)
      useAudioPlayer.ts    # PCM s16le @ 24kHz playback with jitter buffer
    lib/types.ts           # AgentState, TranscriptEntry types

/visualizer (Electron audio visualizer — optional demo component)
  src/                     # React + Three.js 3D fire audio visualization
  electron-main.ts         # Electron main process for visualizer window

/agentverse (Python Agent-S adapter — legacy, replaced by Anthropic CUA)
  adapter.py               # FastAPI wrapper for Agent-S
  register.py              # Agent registration
  requirements.txt         # Python dependencies

/docs (Architecture documentation — 11 detailed guides)
  01-client-layer.md       # Voice I/O, React hooks, Socket.io event flow
  02-server-orchestrator.md # Express/Socket.io, VoicePipeline, TTS chunking
  03-langgraph-supervisor.md # StateGraph routing, classification, agent dispatch
  04-commerce-agent.md     # Stagehand-based e-commerce automation
  06-general-agent.md      # Web summarization, navigation, article reading
  07-execution-layer.md    # Stagehand API (extract, act, observe, navigate)
  08-audio-services.md     # Deepgram Nova-3 STT, Cartesia Sonic-2 TTS
  09-knowledge-base.md     # Elasticsearch + JINA semantic indexing
  stagehand-integration-notes.md # Browser automation setup & caching
```

**Deliverables (Phases 1-4 — DONE):**

- Next.js client + Electron overlay with Socket.io connection to server
- Deepgram Nova-3 STT: mic → MediaRecorder (WebM/Opus) → Socket.io → server → Deepgram WebSocket → transcripts
- Cartesia Sonic-2 TTS: server streams audio chunks back to client (pcm_s16le @ 24kHz)
- Stagehand controlling visible Chromium instance
- LangGraph supervisor: Haiku classification → 4-way routing → Sonnet agents
- Session state: conversation history, abort controller
- User profile loaded from Elasticsearch (seed JSON fallback)

### Phase 2: Voice I/O — Deepgram + Cartesia ✅

- Deepgram Nova-3 STT via WebSocket (replaces Web Speech API — broken in Electron)
- Mic capture → MediaRecorder (WebM/Opus) → Socket.io `stt_audio` → server → Deepgram → `stt_transcript` back
- Cartesia Sonic-2 TTS: server streams `audio_chunk` events back to client
- UtteranceEnd handling for natural speech commit
- Support for user interruption (`stop_audio` → abort + switch to listening)

### Phase 3: Browser — Stagehand ✅

- Stagehand v3 with visible Chromium (local, not headless)
- ExecutionContext wrapper: `extract()`, `act()`, `observe()`, `navigate()`
- Each method catches errors → returns `{ success, data/error }`, never throws
- Singleton instance initialized at server startup

### Phase 4: Supervisor + Routing — LangGraph ✅

- LangGraph StateGraph: `classify` → conditional → `commerceAgent`|`codingAgent`|`desktopAgent`|`generalAgent` → `recheck` → `formatResponse`
- Haiku 4.5 for sub-200ms intent classification → `{ category, secondaryCategory, subIntent, entities, primaryTask, secondaryTask }`
- Sonnet 4.5 agents with domain-specific system prompts + conversation history
- Compound task chaining via `recheckNode` (e.g., "open VS Code and write code" → desktop → coding)
- `formatResponse` node strips markdown/URLs/list markers for clean TTS
- Session state: conversation history (append-only), abort controller
- Parallel Elasticsearch memory context fetch during classification

### Phase 5: Streaming Voice Pipeline — Kill the Latency

> **Why first**: The current pipeline waits for the ENTIRE LangGraph execution (classify → agent → format) to finish before sending anything to TTS. This adds 2-4s of dead silence. Fixing this is the single biggest UX improvement — it makes the agent feel like a conversation instead of a command terminal.

**The Problem (Current Flow)**:
```
User speaks → Deepgram (150ms) → Haiku classify (200ms) → Sonnet agent (2-3s) → formatResponse → Cartesia TTS (40ms)
                                                                                    ↑
                                                                          User hears NOTHING for 3-4s
```

**The Fix (Streaming Flow)**:
```
User speaks → Deepgram (150ms) → Haiku classify (200ms) → Sonnet agent STREAMS tokens
                                                                ↓
                                                    Sentence boundary detector
                                                                ↓
                                                    First complete sentence → Cartesia (40ms)
                                                                ↓
                                                    User hears audio at ~700ms
```

**Target Latency Budget**:

| Stage | Target | Current |
|-------|--------|---------|
| Deepgram STT | ~150ms | ~150ms ✓ |
| Haiku classify | ~150ms | ~200ms |
| Sonnet first token | ~300ms | N/A (not streamed) |
| Sentence buffer fill | ~100ms | N/A |
| Cartesia TTFA | ~40ms | ~40ms ✓ |
| **Total to first audio** | **~700ms** | **~3-4s** |

**Implementation**:

1. **Switch `compiledGraph.invoke()` → `compiledGraph.stream()`** in socket handler

```typescript
// handler.ts — Replace invoke() with streaming
for await (const [mode, chunk] of await compiledGraph.stream(
  { userInput: text, conversationHistory, userProfile, pageSnapshot: null },
  { streamMode: ["messages", "custom"], configurable: { thread_id: socket.id } }
)) {
  if (mode === "custom" && chunk.type === "interim_speech") {
    // Speak interim status IMMEDIATELY (e.g. "Searching Amazon now...")
    await speakInterim(chunk.text);
  } else if (mode === "messages") {
    const [msg, metadata] = chunk;
    if (metadata.langgraph_node.includes("Agent") && msg.content) {
      sentenceBuffer += msg.content;
      // Flush complete sentences to Cartesia as they form
      const { complete, remainder } = extractSentences(sentenceBuffer);
      for (const sentence of complete) {
        await tts.sendChunk(contextId, sentence, true);
      }
      sentenceBuffer = remainder;
    }
  }
}
```

2. **Enhanced sentence boundary detection** (handle abbreviations, decimals)

```typescript
// Avoid false breaks on "Dr.", "Mr.", "$4.99", "U.S."
const ABBREVIATIONS = /(?:Mr|Mrs|Ms|Dr|Jr|Sr|vs|etc|Prof|Inc|Ltd|Corp)\.\s/;
const SENTENCE_END = /(?<!Mr|Mrs|Ms|Dr|Jr|Sr|vs|etc|Prof|Inc|Ltd|Corp)(?<!\d)[.?!](?:\s|$)/;

function extractSentences(buffer: string): { complete: string[]; remainder: string } {
  const sentences: string[] = [];
  let remaining = buffer;
  let match;
  while ((match = SENTENCE_END.exec(remaining))) {
    sentences.push(remaining.slice(0, match.index + match[0].length).trim());
    remaining = remaining.slice(match.index + match[0].length);
  }
  // Safety valve: flush if buffer > 150 chars without a sentence break
  if (remaining.length > 150) {
    const clauseBreak = remaining.search(/[,;:]\s/);
    if (clauseBreak > 20) {
      sentences.push(remaining.slice(0, clauseBreak + 1).trim());
      remaining = remaining.slice(clauseBreak + 2);
    }
  }
  return { complete: sentences, remainder: remaining };
}
```

3. **Interim speech from agent nodes** via `config.writer()`

```typescript
// Inside commerce agent node — user hears status while browser works
async function commerceAgent(state, config) {
  config.writer({ type: "interim_speech", text: "Let me search Amazon for that." });
  // ... browser actions (3-5 seconds) ...
  config.writer({ type: "interim_speech", text: "Found some options. Let me compare them." });
  // ... extract + format response ...
}
```

4. **Cartesia continuation context** — keep a single TTS context per response for natural prosody

```typescript
// Use Cartesia's continuation feature: all sentences in one turn share prosody
const contextId = tts.createContext();
// First sentence: continue=true
await tts.sendChunk(contextId, "I found three headphones in your budget.", true);
// Middle sentences: continue=true
await tts.sendChunk(contextId, "The top rated is Sony WH-1000XM5 at $198.", true);
// Last sentence: continue=false (finalizes)
await tts.sendChunk(contextId, "Want me to add it to your cart?", false);
```

**Deliverables**:
- [ ] LangGraph `stream()` replaces `invoke()` with `streamMode: ["messages", "custom"]`
- [ ] Sentence boundary detector feeds Cartesia as agent generates
- [ ] Interim speech events from agent nodes (user hears status during browser work)
- [ ] First audio arrives within ~700ms of user finishing speech
- [ ] Cartesia continuation contexts for natural prosody across sentences

---

### Phase 6: Real Agents — Commerce + Coding + Desktop + General Specialists ✅ DONE

> **Why this is the product**: Without real agents controlling the browser and desktop, the demo is just a chatbot. The agents ARE the product. Agent quality = demo quality = prize money.

**Current State**: ALL FOUR AGENTS FULLY IMPLEMENTED with real tool execution. Commerce and General agents use Stagehand browser tools + Perplexity web search + Elasticsearch knowledge tools. Coding agent uses sandboxed file I/O + shell tools. Desktop agent uses Anthropic Computer Use API for GUI control.

**Four Agents, Three Execution Layers**:

| Agent | Execution Layer | What it controls |
|-------|----------------|-----------------|
| **Commerce** | Stagehand (browser) + Perplexity | Amazon, shopping sites, web checkout, product research |
| **Coding** | File I/O + Shell | Read/write/edit files, run commands, search code |
| **Desktop** | Anthropic CUA (macOS native) | Any app — VS Code, Terminal, Spotify, Finder, etc. |
| **General** | Stagehand (browser) + Perplexity | Web navigation, articles, search, forms, page description |

**LangGraph Flow (with compound task chaining)**:
```
START → classify (Haiku) → [conditional: commerce|coding|desktop|general] → agent → recheck → formatResponse → END
```

The Haiku classifier routes to four agents. Compound tasks chain two agents via `recheckNode`:

```typescript
function routeByCategory(state: SupervisorStateType): string {
  switch (state.agentCategory) {
    case "commerce": return "commerceAgent";    // → Stagehand (browser)
    case "coding":   return "codingAgent";      // → File I/O + shell
    case "desktop":  return "desktopAgent";     // → Anthropic CUA (macOS)
    default:         return "generalAgent";     // → Stagehand (browser)
  }
}
```

**Architecture: ReAct Loop with Tools**

Each agent runs a ReAct (Reason + Act) loop. Commerce and General use Stagehand browser tools + Perplexity web search + Elasticsearch knowledge tools. Coding uses file I/O + shell tools. Desktop uses Anthropic CUA (screenshot + mouse/keyboard).

```
┌─────────────────────────────────────────────────────────┐
│              AGENT NODE (max 10-15 iterations)           │
│                                                         │
│   ┌──────┐     ┌───────┐     ┌─────────┐  ┌────────┐  │
│   │REASON│ ──→ │TOOL   │ ──→ │ EXECUTE │──→│OBSERVE │  │
│   │(LLM) │     │SELECT │     │(Browser/│  │(Result)│  │
│   └──────┘     └───────┘     │ File/CUA)│  └────────┘  │
│      ↑                       └─────────┘       │        │
│      └─────────────────────────────────────────┘        │
│                   (loop until final answer)              │
│                                                         │
│   Emits: interim speech via interimSpeech callback      │
│   Returns: responseText for TTS                         │
└─────────────────────────────────────────────────────────┘
```

**Tool System (4 tool factories in `tools.ts`)**:

```typescript
// server/src/agents/tools.ts — All tool factories using DynamicStructuredTool
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";

// 1. Browser tools (Commerce + General agents) — wraps Stagehand ExecutionContext
export function createBrowserTools(ctx: ExecutionContext): DynamicStructuredTool[] {
  // navigate_to_url — ctx.navigate(url) -> { success, finalUrl, pageTitle }
  // click_element   — ctx.observe(instruction) then ctx.act(instruction) [observe-before-act]
  // extract_data    — ctx.extract(instruction) -> structured JSON
  // observe_page    — ctx.observe(instruction) -> available actions list
  return [navigateToUrl, clickElement, extractData, observePage];
}

// 2. Web search (Commerce + General + Coding agents)
export function createSearchTools(): DynamicStructuredTool[] {
  // web_search — Perplexity Sonar API with recency filter and citations
  return perplexityKey ? [webSearch] : [];
}

// 3. Knowledge tools (Commerce + General agents) — wraps Elasticsearch
export function createKnowledgeTools(kb, sessionId): DynamicStructuredTool[] {
  // search_browsing_history — RRF hybrid search over visited pages
  // search_products_viewed  — RRF hybrid search over viewed products
  // search_conversation_history — RRF hybrid search over past turns
  return kb?.isAvailable() ? [searchBrowsing, searchProducts, searchConversation] : [];
}

// 4. Coding tools (Coding agent only) — sandboxed file I/O + shell
export function createCodingTools(workspacePath): DynamicStructuredTool[] {
  // read_file — with line numbers, 10K char limit, optional startLine/endLine
  // write_file — creates parent dirs, overwrites existing
  // edit_file — exact find-and-replace (oldText -> newText)
  // run_command — /bin/bash, 30s timeout, 8K output limit
  // list_directory — recursive option, excludes node_modules/.git/dist
  // search_code — grep -rn with glob filters
  return [readFile, writeFile, editFile, runCommand, listDirectory, searchCode];
}
```

*See `tools.ts` for full DynamicStructuredTool implementations.*

**Commerce Agent (Visa $10k)** — `server/src/agents/commerce.ts`:

All four agents follow the same pattern: `createXAgent()` factory returns an async function that runs a ReAct loop. The commerce agent uses `web_search` (Perplexity Sonar) for research and browser tools (Stagehand) for interaction. It auto-indexes extracted products to Elasticsearch.

```typescript
// Simplified view — see commerce.ts for full implementation
export function createCommerceAgent(executionContext, kb) {
  const agentModel = new ChatAnthropic({ model: "claude-sonnet-4-5-20250929", temperature: 0.3, maxTokens: 1024 });

  return async function commerceAgent(state, interimSpeech?, abortSignal?, sessionId?, memoryContext?) {
    const tools = [...createSearchTools(), ...createBrowserTools(executionContext), ...createKnowledgeTools(kb, sessionId)];
    const modelWithTools = agentModel.bindTools(tools);

    for (let i = 0; i < 10; i++) {
      if (abortSignal?.aborted) return { responseText: "" };
      const response = await modelWithTools.invoke(messages);
      if (!response.tool_calls?.length) return { responseText: extractText(response.content) };

      for (const toolCall of response.tool_calls) {
        if (interimSpeech) interimSpeech(getCommerceInterimPhrase(toolCall.name, toolCall.args));
        const result = await toolFn.invoke(toolCall.args);
        // Auto-index to Elasticsearch (fire-and-forget)
        if (kb && sessionId) kb.indexPageVisit(...).catch(() => {});
      }
    }
    return { responseText: "I had trouble completing that. Could you try again?" };
  };
}
```

**Coding Agent (File I/O + Shell)** — `server/src/agents/coding.ts`:

```typescript
// Simplified view — see coding.ts for full implementation
// Uses sandboxed file I/O tools, NOT browser or desktop
export function createCodingAgent(workspacePath) {
  return async function codingAgent(state, interimSpeech?, abortSignal?, sessionId?, memoryContext?) {
    const tools = [...createSearchTools(), ...createCodingTools(workspacePath)];
    // Tools: read_file, write_file, edit_file, run_command, list_directory, search_code, web_search
    // All file ops sandboxed to workspacePath via resolveSafe()
    // System prompt: read before edit, run tests after changes, describe code conversationally
    // ReAct loop: max 10 iterations
  };
}
```

**Desktop Agent (Anthropic CUA — macOS GUI Control)** — `server/src/agents/desktop.ts`:

```typescript
// Uses Anthropic SDK directly (NOT LangChain) — computer-use-2025-01-24 beta
export function createDesktopAgent() {
  return async function desktopAgent(state, interimSpeech?, abortSignal?) {
    // Single tool: computer_20250124 with display_width_px/display_height_px
    // Actions: screenshot, left_click, right_click, double_click, type, key, scroll, etc.
    // Execution: macOS native via computerControl.ts (JXA + AppleScript + screencapture)
    // Max 15 iterations
    // Two system prompts: general desktop vs coding desktop (selected by subIntent)
    // Critical rule: Always use Spotlight (Cmd+Space) to open apps
  };
}
```

**General Agent (Navigation, Summarization)** — `server/src/agents/general.ts`:

Same architecture as Commerce Agent (ReAct loop with browser + search + knowledge tools). Key difference: system prompt focuses on spatial page description and article summarization rather than shopping.

**Stagehand Initialization at Server Startup**:

```typescript
// server/src/index.ts — Initialize Stagehand ONCE, reuse across all connections
import { initStagehand, createExecutionContext } from "./lib/stagehand";

let executionContext: ExecutionContext | null = null;

async function startServer() {
  // Initialize Stagehand singleton (visible Chromium)
  const stagehand = await initStagehand();
  executionContext = createExecutionContext(stagehand);

  // Enable Stagehand caching for faster repeated actions
  // Cache key = instruction + URL → skip LLM inference on repeat
  // Pass executionContext to socket handler
}
```

**Stagehand Speed Optimizations**:

1. **Enable caching**: `new Stagehand({ cacheDir: "./stagehand-cache" })` — first run uses LLM inference, subsequent runs hit cache (no LLM call)
2. **Use `observe()` before `act()`**: Saves an LLM call on the act step since it uses the cached observation
3. **Batch extractions**: One `extract()` with a multi-field schema is faster than multiple calls
4. **Specific instructions**: "Click the red 'Add to Cart' button next to the Sony WH-1000XM5" is far more reliable than "Click the button"
5. **Reuse browser instance**: Single Chromium across all connections — never spawn per-action

**Desktop Agent Setup (Anthropic CUA — already integrated)**:

The desktop agent uses Anthropic's Computer Use API (`computer-use-2025-01-24` beta) instead of the originally planned Agent-S Python sidecar. This eliminates the need for a separate Python process, UI-TARS grounding model, or Tesseract OCR.

**Requirements**:
1. `ANTHROPIC_API_KEY` — same key used for Haiku/Sonnet (no additional API needed)
2. macOS Accessibility permission — System Settings > Privacy & Security > Accessibility
3. macOS Screen Recording permission — System Settings > Privacy & Security > Screen Recording
**Deliverables** (ALL DONE ✅):
- [x] Commerce Agent with ReAct loop: web_search, navigate, extract, click, observe + knowledge tools
- [x] **Coding Agent with file I/O**: read_file, write_file, edit_file, run_command, list_directory, search_code + web_search
- [x] **Desktop Agent with Anthropic CUA**: screenshot + mouse/keyboard via macOS native (computerControl.ts)
- [x] General Agent with ReAct loop: same tool set as commerce (web_search, browser, knowledge)
- [x] Browser tools as DynamicStructuredTool (navigate_to_url, click_element, extract_data, observe_page)
- [x] Web search via Perplexity Sonar (web_search tool available to commerce, general, and coding agents)
- [x] Knowledge tools via Elasticsearch (search_browsing_history, search_products_viewed, search_conversation_history)
- [x] Supervisor routes to 4 agents: commerce (Stagehand), coding (file I/O), desktop (CUA), general (Stagehand)
- [x] Compound task chaining via recheckNode (e.g., desktop → coding)
- [x] Stagehand initialized at server startup, execution context passed to browser agents
- [x] Interim speech with throttling (2s global cooldown, 4s dedup) during multi-step actions
- [x] Budget tracking in commerce agent
- [x] Auto-indexing of page visits and products to Elasticsearch

---

### Phase 7: Multi-Turn Memory & Reference Resolution

> **Why this matters**: The Greylock prize requires 5+ turn conversations. "The second one", "add that to cart", "actually go back" — these all need context tracking. This is what makes the agent feel intelligent.

**State Extensions**:

```typescript
// Add to SupervisorState annotations
const SupervisorState = Annotation.Root({
  // ... existing fields ...

  // Track the last set of results shown to the user (for "the second one")
  lastResults: Annotation<SearchResult[]>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),

  // Track entities mentioned across turns (for "that one", "it")
  recentEntities: Annotation<RecentEntity[]>({
    reducer: (prev, next) => [...prev, ...next].slice(-20),
    default: () => [],
  }),

  // Current page state for context
  currentPageSnapshot: Annotation<PageSnapshot | null>({
    reducer: (_prev, next) => next,
    default: () => null,
  }),
});

interface SearchResult {
  index: number;
  name: string;
  price?: string;
  rating?: string;
  url?: string;
  details: Record<string, unknown>;
}

interface RecentEntity {
  type: "product" | "page" | "link" | "element";
  name: string;
  details: Record<string, unknown>;
  turnIndex: number;
}
```

**Reference Resolution Strategy**:

The key insight: you do NOT need a separate coreference resolution system. By including `lastResults` and `recentEntities` in the agent's system prompt, the LLM handles references naturally:

```typescript
function buildContextualPrompt(state: SupervisorStateType): string {
  let context = "";

  if (state.lastResults.length > 0) {
    context += `\n\nResults you last showed the user:\n`;
    state.lastResults.forEach((r, i) => {
      context += `${i + 1}. ${r.name}${r.price ? ` - ${r.price}` : ""}${r.rating ? ` (${r.rating})` : ""}\n`;
    });
    context += `When the user says "the first one", "the second one", etc., refer to this list.\n`;
    context += `When the user says "that one" or "it", refer to the most recently discussed item.\n`;
  }

  if (state.recentEntities.length > 0) {
    context += `\nRecently discussed: ${state.recentEntities.map(e => e.name).join(", ")}\n`;
  }

  return context;
}
```

**Conversation History with Summarization**:

```typescript
// For conversations > 6 turns, summarize older turns to save context
function buildConversationContext(history: ConversationTurn[], maxTurns = 6): string {
  if (history.length <= maxTurns) {
    return history.map(t => `${t.role}: ${t.text}`).join("\n");
  }

  const older = history.slice(0, -maxTurns);
  const recent = history.slice(-maxTurns);

  // Quick summary of older context
  const summary = `[Earlier: user asked about ${extractTopics(older).join(", ")}]`;
  const recentText = recent.map(t => `${t.role}: ${t.text}`).join("\n");

  return `${summary}\n\n${recentText}`;
}
```

**LangGraph MemorySaver for Thread Persistence**:

```typescript
import { MemorySaver } from "@langchain/langgraph";

const checkpointer = new MemorySaver();
const compiledGraph = graph.compile({ checkpointer });

// Each socket connection gets a thread_id — state auto-persists between invocations
const result = await compiledGraph.stream(input, {
  streamMode: ["messages", "custom"],
  configurable: { thread_id: socket.id },
});
```

**Deliverables**:
- [ ] `lastResults` and `recentEntities` tracked in supervisor state
- [ ] Reference resolution works: "the second one", "add that", "go back"
- [ ] Conversation history summarization for 7+ turn conversations
- [ ] MemorySaver checkpointer for automatic thread persistence
- [ ] 5+ turn shopping flow works end-to-end (Greylock demo)

---

### Phase 8: Knowledge Base — Elasticsearch + JINA ✅ DONE

> **Implemented in** `server/src/lib/elasticsearch.ts`. Full Elasticsearch + JINA integration with RRF hybrid search, auto-indexing from agents, and graceful degradation.

- Elastic Cloud deployment (ELASTIC_CLOUD_ID + ELASTIC_API_KEY)
- JINA inference endpoint for `semantic_text` auto-embedding (built into Elastic index mappings)
- 4 indices: `user-profile`, `browsing-history`, `products-viewed`, `conversation-history`
- RRF hybrid search: combines semantic (JINA embeddings) + fuzzy matching, falls back to semantic-only for older ES versions
- Auto-index every page Stagehand visits → `indexPageVisit()` (fire-and-forget from commerce/general agents)
- Auto-index every product extracted → `indexProductViewed()` (fire-and-forget from commerce agent)
- Auto-index every conversation turn → `indexConversation()`
- Memory context injection: `fetchMemoryContext()` aggregates pages + products + conversations into agent prompt
- Session restore from ES on reconnect via `restoreConversation()`
- User profile from ES with seed JSON fallback
- Graceful degradation: all methods return sensible defaults if ES unreachable
- Demo: "find that cold medicine I was looking at earlier" → semantic recall via JINA embeddings

**Remaining for Elastic prize**:
- [ ] Elastic Agent Builder agent with browsing history + medical lookup tools (Kibana)
- [ ] Elastic Workflow: auto-trigger drug safety check when new page is indexed
- [ ] Add medical profile data (conditions, medications, allergies) to user profile for Healthcare prize

**Deliverables** (DONE):
- [x] Elastic Cloud deployed with JINA inference endpoint
- [x] Browsing history auto-indexed on every page visit
- [x] Products auto-indexed on every extraction
- [x] Conversation history auto-indexed every turn
- [x] Semantic search works: "find that page about headphones" returns correct results
- [x] Memory context injected into agent prompts per turn
- [x] Session restore from Elasticsearch on reconnect

---

### Phase 9: Electron Overlay ✅ DONE

> **Implemented in** `/electron/`. Full Electron overlay with liquid-glass UI, server auto-management, and all voice I/O.

- Electron app with Vite + React 19 + Tailwind + `liquid-glass-react` morphism UI
- Always-on-top, frameless, transparent, 740x390px window
- `Cmd+Shift+V` global hotkey toggles window visibility + overlay mode
- Tray menu with Show/Hide, Toggle Overlay, Quit
- Server auto-spawn: `main.ts` detects existing server or launches as child process
- Graceful shutdown: SIGTERM → SIGKILL after 3s on app exit
- Deepgram STT via server relay: MediaRecorder (WebM/Opus, 250ms chunks) → Socket.io → server Deepgram WS
- Cartesia TTS playback: 24kHz PCM with jitter buffer (200ms accumulate, 300ms max-wait)
- Mute button (toggles transcript capture, clears buffered segments)
- Barge-in: any user speech stops audio playback + kills server LLM/TTS pipeline
- macOS accessibility permission check on launch (dialog if missing)
- IPC bridge: toggleOverlay, setClickThrough, onServerStatus
- `setVisibleOnAllWorkspaces(true)`, `setSkipTaskbar(true)` for true overlay behavior
- Context isolation enabled, no nodeIntegration (secure)

---

### Phase 10: Polish + Demo Prep

- Error handling and graceful recovery in all agent paths
- Demo scripts for each scenario (timed, rehearsed)
- Visible browser choreography (make ghost navigation look good for judges)
- Status phrases that vary (not repetitive "Searching..." every time)
- Devpost submission writeup

---

## Agent Architecture Deep Dive

### Why Agent Quality = Everything

Screen readers read words. Our agent understands pages. The difference is entirely in the agents — how they navigate, extract, reason, describe, and converse. Everything else (Socket.io, TTS, STT) is plumbing. The agents are the product.

### ReAct Loop Pattern

Every agent follows the same inner loop:

```
REASON: "The user wants headphones under $50. I should search Amazon."
  → Tool: navigate_to("https://amazon.com")
OBSERVE: "Navigation successful. Page title: Amazon.com"
REASON: "Now I need to search for headphones."
  → Tool: search_on_page("wireless headphones")
OBSERVE: "Search results loaded. 48 results."
REASON: "I should filter by price under $50."
  → Tool: click_element("Click the 'Under $50' price filter")
OBSERVE: "Filter applied. 12 results remaining."
REASON: "Now extract the top 3 results to present to the user."
  → Tool: extract_data("Extract first 3 product names, prices, and ratings")
OBSERVE: { products: [{name: "Sony...", price: "$34", rating: "4.5"}, ...] }
REASON: "I have 3 products. I should describe them to the user spatially."
  → Return: "I found three headphones under fifty dollars. The top option is..."
```

### Agent System Prompts — The Quality Lever

The system prompt is the single biggest quality lever. Each agent gets a carefully tuned prompt:

**Commerce Agent Prompt Design**:
```
You are a shopping assistant for a blind user named {name}.
Their budget is ${budget}. They prefer shopping at {preferredStores}.

BEHAVIOR RULES:
1. ALWAYS acknowledge the user's request before starting browser actions.
2. When presenting products, describe the TOP 3 with name, price, and rating.
3. Use ordinal references: "The first option...", "The second option..."
4. Track running cart total. Warn if approaching budget limit.
5. After presenting options, ALWAYS ask what the user wants to do next.
6. For checkout flows, confirm each step: "I'm about to enter your shipping address. Should I continue?"
7. If an action fails, explain what happened and suggest an alternative.

VOICE FORMATTING:
- Numbers: "forty-nine ninety-nine" not "$49.99"
- Ratings: "four point five stars" not "4.5★"
- No markdown, URLs, bullet points, or code.
- Keep responses under 3 sentences unless the user asks for details.
```

**General Agent Prompt Design**:
```
You are a web browsing assistant for a blind user.

SPATIAL DESCRIPTION RULES:
- Describe layouts as physical spaces, not DOM trees.
- "At the top is the navigation bar with a search box and account menu."
- "The main content area shows an article with a large heading."
- "On the right side, there's a sidebar with related articles."
- For grids: "There are 4 items in a row. From left to right: ..."
- NEVER read raw HTML or list element IDs.

CODING ASSISTANCE:
- When the user has a code editor open, extract the visible code.
- Identify errors by reading error messages and stack traces.
- Explain the bug in plain English: "There's a missing closing bracket on line 12."
- Suggest a fix and offer to apply it: "I can fix that by adding a bracket. Want me to do it?"

ARTICLE SUMMARIZATION:
- Give a 2-3 sentence summary first.
- Then offer: "Want me to read the full article, or should we move on?"
- For long content, chunk into sections and check in: "That covers the first section. Continue?"
```

### Interim Speech — The Conversational Secret

The #1 thing that makes a voice agent feel conversational vs. robotic: **never leave the user in silence**. While the browser works (3-10 seconds for multi-step actions), speak status updates:

```typescript
const STATUS_PHRASES = {
  searching: [
    "Let me search for that.",
    "Searching now.",
    "Looking that up for you.",
  ],
  browsing: [
    "Let me take a look at this page.",
    "Scanning the results.",
    "Looking through what's available.",
  ],
  acting: [
    "I'll do that right now.",
    "On it.",
    "Adding that for you.",
  ],
  extracting: [
    "Let me read through this.",
    "Pulling up the details.",
    "Getting that information.",
  ],
};

function randomStatus(category: keyof typeof STATUS_PHRASES): string {
  const phrases = STATUS_PHRASES[category];
  return phrases[Math.floor(Math.random() * phrases.length)];
}
```

### Error Recovery

Agents MUST recover gracefully — a crash during a 5-turn shopping flow kills the demo:

```typescript
async function resilientAct(ctx: ExecutionContext, instruction: string, maxRetries = 2): Promise<ActResult> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const result = await ctx.act(instruction);
    if (result.success) return result;

    if (attempt < maxRetries) {
      // Try scrolling to find the element
      await ctx.act("scroll down");
      await new Promise(r => setTimeout(r, 500));
    }
  }
  return { success: false, description: `Could not: ${instruction}`, error: "Element not found after retries" };
}
```

---

## Speed Optimization Playbook

### The Three Speed Killers (and Fixes)

| Killer | Current Impact | Fix |
|--------|---------------|-----|
| **LangGraph `invoke()` blocks until done** | +2-3s dead time | Switch to `stream()` with sentence-boundary TTS |
| **Sonnet agent waits for all tools before responding** | +3-5s per tool chain | Emit interim speech during tool execution |
| **No Stagehand caching** | Every action = LLM inference | Enable `cacheDir`, use `observe()` → `act()` pattern |

### Latency Optimization Checklist

- [ ] **Stream LLM → TTS**: Sentence-boundary detection feeds Cartesia as Sonnet generates
- [ ] **Interim speech**: Agent emits spoken status during browser actions via `config.writer()`
- [ ] **Stagehand cache**: `cacheDir: "./stagehand-cache"` — repeat actions skip LLM inference
- [ ] **Observe then act**: `observe()` caches action descriptors → `act(descriptor)` is instant
- [ ] **Batch extractions**: One `extract()` with multi-field schema, not multiple single-field calls
- [ ] **Haiku for classify only**: Keep classification on Haiku (fast), reasoning on Sonnet (smart)
- [ ] **Cartesia continuation**: Single TTS context per response for natural prosody
- [ ] **Abort propagation**: `stop_audio` cancels LLM stream + TTS context + pending tool calls

### Streaming Architecture (Wire Diagram)

```
                    ┌────────────────────────────────────────────────┐
                    │           SOCKET HANDLER                       │
                    │                                                │
  user_message ──→  │  compiledGraph.stream(input, {                 │
                    │    streamMode: ["messages", "custom"]          │
                    │  })                                            │
                    │    │                                           │
                    │    ├─ mode="custom" ─→ interim_speech ─→ TTS  │
                    │    │                    (status updates)       │
                    │    │                                           │
                    │    ├─ mode="messages" ─→ sentence buffer ─→   │
                    │    │                      │                    │
                    │    │                      ├─ complete ─→ TTS  │
                    │    │                      └─ remainder ─→ buf │
                    │    │                                           │
                    │    └─ stream ends ─→ flush remainder ─→ TTS   │
                    │                                                │
                    └────────────────────────────────────────────────┘
```

---

## Voice UX Design Principles

### 1. Progressive Disclosure

Lead with the key info. Offer details on request.

```
BAD:  "I found the Sony WH-1000XM5 headphones priced at $298 with 4.7 stars
       from 12,847 reviews featuring active noise cancellation, 30-hour battery..."

GOOD: "I found Sony headphones for $298, rated four point seven stars.
       Want me to describe the features, or check more options?"
```

### 2. Spatial Page Description (Core Differentiator)

Screen readers read DOM order. Our agent describes spatial layout:

```
SCREEN READER: "Link: Home. Link: About. Link: Products. Heading level 1: Welcome.
               Paragraph: We are a company that..."

OUR AGENT: "This page has a navigation bar at the top with Home, About, and Products links.
            Below that is a large welcome heading in the center of the page.
            The main content area has a paragraph describing the company.
            On the right side, there's a sidebar with featured products."
```

### 3. Natural Conversational Flow

```
USER: "Find me headphones"
AGENT: "Sure, let me search Amazon for headphones."          ← interim (immediate)
       [browser navigates, searches, extracts]
AGENT: "I found three options in your budget.                 ← streamed sentence 1
        The top rated is Sony WH-1000XM5 at thirty-four      ← streamed sentence 2
        dollars with four point five stars.
        Want details or should I keep looking?"               ← streamed sentence 3

USER: "Add the Sony to my cart"
AGENT: "Adding it now."                                       ← interim (immediate)
       [browser clicks add-to-cart]
AGENT: "Done. The Sony is in your cart. Your total is         ← streamed
        thirty-four dollars, well within your five hundred
        dollar budget. Ready to checkout?"

USER: "What else is on this page?"
AGENT: "Let me describe the page layout for you."             ← interim
       [Stagehand extracts spatial layout]
AGENT: "You're on the Sony product page. At the top is        ← streamed
        the product title and a large image. Below that
        are the price and Add to Cart button, which we
        already clicked. Further down are customer reviews.
        Want me to read some reviews?"
```

### 4. Barge-In (Interruption) — Already Implemented

Client-side: instant WebAudio stop → server-side: abort LLM + TTS pipeline.
The user can redirect mid-sentence without waiting for the agent to finish.

### 5. Coding Demo Flow

```
USER: "I have a bug in my code"
AGENT: "Let me take a look at what's on your screen."         ← interim
       [Stagehand extracts code editor content]
AGENT: "I can see a Python file open. There's a syntax        ← streamed
        error on line 12 — you have an unclosed parenthesis
        in the print statement. Want me to fix it?"

USER: "Yes, fix it"
AGENT: "Fixing it now."                                       ← interim
       [Stagehand clicks on line 12, edits the code]
AGENT: "Done. I closed the parenthesis on line 12.            ← streamed
        The error should be gone now. Want me to check
        for any other issues?"
```

---

## Updated File Structure

```
/server
  src/
    index.ts                  # Express + Socket.io + Stagehand init + ES init
    /agents
      supervisor.ts           # LangGraph StateGraph: classify → 4-way routing → recheck → format
      commerce.ts             # Commerce agent: ReAct loop with browser + search + knowledge tools
      coding.ts               # Coding agent: ReAct loop with file I/O + shell + search tools
      desktop.ts              # Desktop agent: Anthropic CUA beta (screenshot + mouse/keyboard)
      general.ts              # General agent: ReAct loop with browser + search + knowledge tools
      tools.ts                # All tool factories: browser, search, knowledge, coding
    /pipeline
      voicePipeline.ts        # TTS sentence splitting, interim speech with throttling
    /tts
      cartesia.ts             # Cartesia Sonic-2 WebSocket TTS (pcm_s16le @ 24kHz)
    /stt
      deepgram.ts             # Deepgram Nova-3 WebSocket STT proxy
    /lib
      stagehand.ts            # Stagehand v3 singleton + ExecutionContext wrapper
      elasticsearch.ts        # Elasticsearch + JINA knowledge base (RRF hybrid search)
      computerControl.ts      # macOS desktop control (JXA + AppleScript + screencapture)
    /socket
      handler.ts              # Socket connection handler (createHandler factory)
    /llm
      index.ts                # LLM provider factory
      types.ts                # LLMProvider interface
      anthropic.ts            # Anthropic streaming provider
      gemini.ts               # Gemini provider (optional)
    /test
      responses.ts            # Test mode scripted demo sequences (TEST=true)
    /types
      index.ts                # All shared types (4 AgentCategories, ClassificationResult, KnowledgeBase)
  /data
    seed-user-profile.json    # Demo user profile (fallback when ES unavailable)
  .env                        # API keys (ANTHROPIC, CARTESIA, DEEPGRAM, PERPLEXITY, ELASTIC)

/electron (Electron overlay — PRIMARY CLIENT)
  src/
    main.ts                   # Main process: server auto-spawn, hotkey, tray, IPC, accessibility check
    preload.ts                # IPC bridge (toggleOverlay, setClickThrough, onServerStatus)
    main.tsx                  # React root entry point
    App.tsx                   # Root component with liquid-glass-react wrapper
    components/
      VoiceAgent.tsx          # Main orchestrator: state machine, chat UI, mic/mute buttons (~500 lines)
      MicButton.tsx           # Mic toggle with pulse ring (legacy — integrated into VoiceAgent)
      StatusIndicator.tsx     # Status dot + label (legacy — integrated into VoiceAgent)
      Transcript.tsx          # Chat log display (legacy — integrated into VoiceAgent)
    hooks/
      useSocket.ts            # Socket.io client connection & event handling
      useDeepgramSTT.ts       # Deepgram STT via server relay (WebM/Opus → Socket.io)
      useAudioPlayer.ts       # WebAudio API for 24kHz PCM playback with jitter buffer
    lib/types.ts              # AgentState, TranscriptEntry types
    index.css                 # Tailwind + custom scrollbar, animations, drag regions
  index.html                  # HTML template
  vite.config.ts              # Vite renderer config (port 5173)
  package.json                # electron, liquid-glass-react, socket.io-client, vite, tailwind

/client (Next.js — lightweight web fallback)
  src/
    app/page.tsx              # Main page
    components/
      VoiceAgent.tsx          # Main orchestrator — wires hooks together
      MicButton.tsx           # Mic toggle with pulse animation
      StatusIndicator.tsx     # Connection + agent state display
      Transcript.tsx          # Chat-style message list with streaming text
    hooks/
      useSocket.ts            # Socket.io connection + event routing
      useDeepgramSTT.ts       # Deepgram STT via server relay (mic capture + audio streaming)
      useAudioPlayer.ts       # PCM s16le @ 24kHz playback with jitter buffer
    lib/types.ts              # AgentState, TranscriptEntry types

/visualizer (Electron audio visualizer — optional demo component)
  src/                        # React + Three.js 3D fire audio visualization
  electron-main.ts            # Electron main process for visualizer window

/agentverse (Python Agent-S adapter — legacy, replaced by Anthropic CUA)
  adapter.py                  # FastAPI wrapper for Agent-S (port 8001)

/docs (Architecture documentation — 11 detailed guides)
  01-client-layer.md through 09-knowledge-base.md
  stagehand-integration-notes.md
```

---

## Demo Scripts (Timed)

### Amazon Shopping Demo (Visa $10k) — 90 seconds

```
0:00  User: "Find me wireless headphones under fifty dollars"
0:01  Agent: "Let me search Amazon for that." (interim)
0:04  [Browser: navigate → search → filter]
0:06  Agent: "Found three options under fifty. The top rated is..."
0:12  User: "Add the first one to my cart"
0:13  Agent: "Adding it now." (interim)
0:16  [Browser: click add-to-cart]
0:17  Agent: "Done. It's in your cart. Total is thirty-four dollars."
0:22  User: "Actually, what else is there?"
0:23  Agent: "Let me show you the other options." (interim)
0:26  Agent: "The second option is JBL Tune 510 at twenty-nine ninety-nine..."
0:35  User: "I'll go with the JBL instead. Remove the Sony and add the JBL."
0:36  Agent: "On it." (interim)
0:42  Agent: "Swapped. Your cart now has the JBL for twenty-nine ninety-nine."
0:48  User: "Let's checkout"
0:49  Agent: "Starting checkout." (interim)
0:55  [Browser: checkout flow]
1:00  Agent: "I've started checkout. Want me to fill in your shipping address?"
      [Multi-turn: 7 turns, budget awareness, cart management]
```

### Coding Demo (YC/SigmaOS) — 60 seconds — Anthropic CUA Desktop Control

```
0:00  User: "Can you help me with a bug in my code?"
      → Haiku classifies as "desktop" (secondary: "coding") → compound task
0:01  Agent: "Sure, let me look at what's on your screen." (interim)
0:03  [Desktop Agent: screenshot via screencapture → sent to Claude CUA as base64 image]
0:06  Agent: "I see a Python file open in VS Code. There's a red underline
       on line twelve — you have an unclosed parenthesis in the print statement."
0:14  User: "Fix it"
0:15  Agent: "Fixing it now." (interim)
0:16  [Desktop Agent: left_click(line 12 coords) → type(closing bracket) → key("cmd+s")]
0:20  Agent: "Done. I added the closing bracket and saved the file."
0:26  User: "Run it and see if it works"
0:27  Agent: "Opening the terminal." (interim)
0:28  [Desktop Agent: key("cmd+space") → type("Terminal") → key("Return") → type("python main.py") → key("Return")]
0:32  Agent: "It ran successfully. No errors. The output says 'Hello World'."
0:38  User: "Are there any other issues in the file?"
0:39  Agent: "Let me check." (interim)
0:41  [Desktop Agent: key("cmd+space") → type("VS Code") → key("Return") → screenshot → analyze]
0:44  Agent: "I also see a warning on line eight. You're using a variable
       that's defined but never used. Want me to clean that up?"
      [Multi-turn: coding assistance for blind developer via Anthropic CUA desktop control]
      [5 turns, VS Code + Terminal, real mouse/keyboard actions visible on screen]
```

---

## Success Criteria

- [x] Socket.io round-trip between client and server
- [x] Deepgram Nova-3 STT: mic → server → Deepgram WebSocket → transcripts back
- [x] Cartesia Sonic-2 TTS: streaming audio chunks to client (pcm_s16le @ 24kHz)
- [x] Stagehand controlling visible Chromium instance
- [x] LangGraph supervisor with Haiku classification routes between 4 agents
- [x] Session state: conversation history persists across turns
- [x] Socket.io supports interruption (barge-in via stop_audio)
- [x] **Real agents**: Commerce + General agents call Stagehand browser tools via ReAct loop
- [x] **Coding agent**: File I/O + shell tools for code reading, writing, debugging
- [x] **Desktop agent**: Anthropic CUA controls any macOS app (VS Code, Terminal, Spotify, etc.)
- [x] **Interim speech**: User hears status updates during browser/desktop actions (throttled: 2s global, 4s dedup)
- [x] **Spatial descriptions**: General agent system prompt describes pages spatially
- [x] **Compound tasks**: Supervisor chains two agents (e.g., desktop → coding)
- [x] **Web search**: Perplexity Sonar available to commerce, general, and coding agents
- [x] **Elasticsearch**: Full knowledge base with RRF hybrid search, auto-indexing, memory context injection
- [x] **Commerce flow**: Complete shopping (search → compare → cart → checkout) with budget tracking
- [x] **Coding demo**: Desktop agent reads VS Code, identifies bug; coding agent applies fix via file I/O
- [x] **Session restore**: Conversation history restored from Elasticsearch on reconnect
- [x] **Electron overlay**: Liquid-glass UI, always-on-top, Cmd+Shift+V hotkey, server auto-spawn, tray menu, mute, accessibility check
- [ ] **Streaming pipeline**: First audio within ~700ms (currently ~2-3s — VoicePipeline uses full response, not token streaming)
- [ ] **Multi-turn entity tracking**: "the second one", "add that" via lastResults/recentEntities (partially done via conversation history)
- [ ] **Healthcare profile**: Medical data (conditions, medications, allergies) in user profile for Healthcare prize

---

## Optional Enhancements (If Time Permits)

- [ ] Browserbase cloud deployment as fallback for visible Chromium
- [ ] HeyGen avatar for visual demo component
- [x] Perplexity Sonar integration for web search (DONE — available to commerce, general, coding agents)
- [x] Electron overlay for always-on-top accessibility (DONE — liquid-glass UI, hotkey, tray, auto-spawn)
- [x] Elasticsearch + JINA semantic memory (DONE — RRF hybrid search, auto-indexing, session restore)
- [ ] Switch Socket.io audio chunks from base64 to raw binary ArrayBuffer (saves 33% bandwidth)
- [ ] Voice Activity Detection (VAD) for smarter barge-in (Deepgram VAD already partially handles this)
- [ ] Conversation summarization for sessions > 10 turns
- [ ] Dynamic voice emotion: urgent for warnings, friendly for results, empathetic for errors
- [ ] Token-level streaming: switch from invoke() to stream() for ~700ms first-audio latency
- [ ] Stagehand caching: cacheDir for repeat action speedup
- [ ] Elastic Agent Builder agent with browsing history + medical lookup tools (Kibana)
- [ ] Medical profile data for Healthcare prize track
