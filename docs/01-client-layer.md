# Client Layer — Voice I/O Terminal

> The user's ears and mouth. A minimal Next.js app that captures mic audio, streams it to the server for Deepgram STT, plays Cartesia TTS audio, and displays conversation transcript.

---

## Responsibilities

1. Capture mic audio and stream to server via Socket.io for Deepgram STT — `useVoiceInput` hook
2. Display interim/final transcripts from Deepgram — real-time feedback
3. Send final user messages to server on utterance end — `useSocket` hook
4. Receive streaming TTS audio chunks and play via WebAudio API — `useAudioPlayer` hook
5. Support **barge-in** — user speaking mid-playback cancels current audio and sends interrupt
6. Show visual status (listening, thinking, speaking, acting) via `StatusIndicator`
7. Display conversation transcript with streaming assistant text via `Transcript`

---

## File Structure

```
/client
  /src
    /app
      layout.tsx              # Root layout — Inter font, dark mode, metadata
      page.tsx                # Main page — renders <VoiceAgent />
      globals.css             # Dark theme, pulse-ring animation
    /components
      VoiceAgent.tsx          # Main orchestrator — wires hooks together
      MicButton.tsx           # Mic toggle with pulse animation
      StatusIndicator.tsx     # Connection + agent state display
      Transcript.tsx          # Chat-style message list with streaming text
    /hooks
      useSocket.ts            # Socket.io connection + event routing
      useVoiceInput.ts        # Mic capture → Socket.io → server → Deepgram STT
      useAudioPlayer.ts       # PCM f32le playback with jitter buffer
    /lib
      types.ts                # AgentState, TranscriptEntry types
  .env.local                  # NEXT_PUBLIC_SERVER_URL
```

---

## Components

### `VoiceAgent.tsx` — Main Orchestrator

Composes all hooks and components. Key responsibilities:
- Manages transcript entries and streaming text state
- Wires `useVoiceInput` callbacks to `useSocket` message sending
- Implements barge-in: `handleBargeIn()` stops audio + sends `audio:interrupt`
- Derives combined agent state from server `status` events + mic state

### `MicButton.tsx` — Mic Toggle

- Displays `Mic` / `MicOff` icons (from `lucide-react`)
- Pulse ring animation when listening (`animate-pulse-ring`)
- Disabled state when disconnected

### `StatusIndicator.tsx` — Status Display

- Shows connection status (red dot = disconnected)
- Shows agent state: Listening (green), Thinking (yellow), Speaking (blue), Acting (purple)
- Displays `status.label` from server (e.g., "Searching Amazon...")

### `Transcript.tsx` — Chat Display

- Chat bubble layout: user messages right-aligned (blue), assistant left-aligned (gray)
- Auto-scrolls to bottom on new messages
- Shows interim transcript with blinking cursor while user speaks
- Empty state: "Click the mic button and start talking"

---

## Hooks

### `useSocket.ts` — Socket.io Connection

```typescript
interface UseSocketReturn {
  isConnected: boolean;
  sendMessage: (text: string) => void;      // Emits "user:message"
  sendInterrupt: () => void;                 // Emits "audio:interrupt"
  startSTT: (mimeType?: string) => void;    // Emits "stt:start"
  sendAudioChunk: (data: string) => void;   // Emits "stt:audio-chunk"
  stopSTT: () => void;                      // Emits "stt:stop"
  serverState: AgentState;                   // From "status" events
  onAgentResponse: (cb) => void;            // Register "agent:response" handler
  onAudioChunk: (cb) => void;              // Register "audio:chunk" handler
  onAudioDone: (cb) => void;               // Register "audio:done" handler
  onTranscript: (cb) => void;              // Register "stt:transcript" handler
  onUtteranceEnd: (cb) => void;            // Register "stt:utterance-end" handler
  onError: (cb) => void;                   // Register "error" handler
}
```

Connects to `NEXT_PUBLIC_SERVER_URL` via WebSocket transport only.

### `useVoiceInput.ts` — Mic Capture → Deepgram STT (via Server)

```typescript
function useVoiceInput(
  socket: UseSocketReturn,
  onFinalTranscript?: (text: string) => void,
  onInterimTranscript?: (text: string) => void,
): {
  isListening: boolean;
  interimTranscript: string;
  startListening: () => void;
  stopListening: () => void;
}
```

Key behaviors:
- Uses `MediaRecorder` API to capture mic audio
- Streams raw audio chunks to server via `stt:audio-chunk` (base64-encoded)
- Server proxies audio to Deepgram Nova-3 WebSocket for STT
- Receives `stt:transcript` events with interim/final transcripts and confidence scores
- On `stt:utterance-end`, commits the final transcript as a user message via `user:message`
- Handles barge-in detection: if user speaks during audio playback, triggers interrupt

**Why Deepgram instead of Web Speech API:** Web Speech API is fundamentally broken in Electron (electron/electron#46143, #24278, #7749). Deepgram Nova-3 provides 150ms latency, best-in-class 6.84% WER, and $200 free credits (~433 hours).

### `useAudioPlayer.ts` — PCM Audio Playback

```typescript
function useAudioPlayer(): {
  playChunk: (base64Data: string, sampleRate: number) => void;
  stopPlayback: () => void;
  initAudio: () => void;
  isPlaying: () => boolean;
}
```

Key features:
- **PCM f32le @ 44100Hz** decoding (Float32 from Cartesia Sonic-2)
- **Jitter buffer**: 200ms initial accumulation before first playback
- **Batch flushing**: ~80ms batches reduce AudioNode overhead
- **Seamless scheduling**: `AudioBufferSourceNode` chaining via `nextStartTime`

---

## Socket.io Event Contract

### Events Emitted (Client → Server)

| Event | Payload | When |
|-------|---------|------|
| `session:start` | `{ sessionId }` | Client connects and starts session |
| `user:message` | `{ text, sessionId }` | Final transcript committed (after utterance end) |
| `audio:interrupt` | `{ sessionId }` | Barge-in: user speaks during playback |
| `stt:start` | `{ sessionId, mimeType? }` | Begin Deepgram STT session |
| `stt:audio-chunk` | `{ sessionId, data }` | Raw mic audio (base64-encoded) |
| `stt:stop` | `{ sessionId }` | End Deepgram STT session |

### Events Received (Server → Client)

| Event | Payload | When |
|-------|---------|------|
| `session:ready` | `{ sessionId, greeting }` | Server acknowledges session |
| `agent:response` | `{ text, agent, actions? }` | Agent text response |
| `status` | `{ state, label }` | Pipeline state: listening, thinking, speaking, acting |
| `audio:chunk` | `{ data, index, final, sampleRate, encoding }` | Streaming PCM f32le from Cartesia |
| `audio:done` | `{ sessionId }` | Audio stream complete |
| `stt:transcript` | `{ text, isFinal, confidence, speechFinal }` | Deepgram interim/final transcript |
| `stt:utterance-end` | `{}` | Deepgram detected end of speech |
| `stt:ready` | `{}` | Deepgram connection established |
| `stt:error` | `{ message }` | Deepgram error |
| `error` | `{ code, message, recoverable }` | Server error |

---

## Barge-In Flow

```
1. User says "Buy headphones"
2. Agent responds via streaming audio: "I found Sony WH-1000XM5..."
3. User interrupts mid-sentence: "Actually, search for earbuds"
4. useVoiceInput detects speech while audio is playing (Deepgram interim transcript arrives)
5. handleBargeIn():
   a. stopPlayback() — clears AudioBufferSourceNodes instantly
   b. sendInterrupt() — emits "audio:interrupt" to server
   c. Server aborts current LLM/TTS pipeline
6. Deepgram continues processing new speech → stt:transcript events
7. stt:utterance-end → sendMessage("search for earbuds")
8. Pipeline restarts with new message
```

---

## Dependencies

```json
{
  "next": "16.1.6",
  "react": "19.2.3",
  "react-dom": "19.2.3",
  "socket.io-client": "^4.8.3",
  "lucide-react": "^0.564.0"
}
```

---

## Interaction with Other Layers

| Layer | Direction | Mechanism | Data |
|-------|-----------|-----------|------|
| **Server Layer** | Client → Server | `socket.emit("user:message")` | Final transcript text |
| **Server Layer** | Client → Server | `socket.emit("stt:audio-chunk")` | Raw mic audio for Deepgram |
| **Server Layer** | Server → Client | `socket.on("agent:response")` | Agent text response |
| **Audio Services** | Server → Client | `socket.on("audio:chunk")` | PCM f32le audio from Cartesia |
| **Deepgram STT** | Server → Client | `socket.on("stt:transcript")` | Interim/final transcripts |
| **Server Layer** | Client → Server | `socket.emit("audio:interrupt")` | Cancel current pipeline |

The Client Layer has **zero direct contact** with the Agent Layer, Execution Layer, or Knowledge Base. Everything is mediated through the Server Layer via Socket.io.
