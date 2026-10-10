# Audio Services — Deepgram STT + Cartesia TTS

> The ears and voice. Deepgram Nova-3 handles speech-to-text via WebSocket streaming, Cartesia Sonic-2 handles text-to-speech with sub-100ms streaming latency.

---

## Responsibilities

1. **STT (Deepgram Nova-3)**: Convert user speech to text via WebSocket streaming
2. **TTS (Cartesia Sonic-2)**: Convert agent text responses to streaming audio
3. Stream audio chunks to the client in real time via Socket.io
4. Support interruption — cancel mid-stream when user speaks (barge-in)
5. Manage Cartesia voice selection and context-based prosody

---

## Architecture Overview

```
┌───────────┐    ┌──────────────┐    ┌───────────────┐    ┌────────────┐    ┌───────────┐
│   User's   │    │  Client Mic  │    │    Server     │    │  Deepgram  │    │  Server   │
│   Voice    │───▶│  MediaRecorder│───▶│  STT Proxy   │───▶│  Nova-3    │───▶│  Emits    │
│            │    │  (Browser)   │    │  (WebSocket)  │    │  (WS STT)  │    │ transcript│
└───────────┘    └──────────────┘    └───────────────┘    └────────────┘    └───────────┘

┌───────────┐    ┌──────────────┐    ┌───────────────┐    ┌────────────┐    ┌───────────┐
│  Agent     │    │  LangGraph   │    │    Server     │    │  Cartesia  │    │  Client   │
│  Response  │───▶│  Supervisor  │───▶│  TTS Stream   │───▶│  Sonic-2   │───▶│  Speaker  │
│  (text)    │    │  (formatted) │    │               │    │  (WS TTS)  │    │ (WebAudio)│
└───────────┘    └──────────────┘    └───────────────┘    └────────────┘    └───────────┘
                                            │                    │
                                     AbortController      PCM f32le @ 44100Hz
                                     (interruption)       (base64 chunks)
```

---

## Deepgram STT — `server/src/lib/deepgram.ts`

Server proxies client mic audio to Deepgram Nova-3 via WebSocket:

```typescript
// Connection config:
// - model: "nova-3"
// - language: "en"
// - smart_format: true
// - interim_results: true
// - utterance_end_ms: 1000
// - vad_events: true
// - encoding: depends on client MediaRecorder (typically "opus" or "linear16")
// - sample_rate: depends on client mic (typically 16000 or 48000)
```

**Key behaviors:**
- One Deepgram WebSocket per client session
- Opened on `stt:start`, closed on `stt:stop`
- Client sends base64 audio via `stt:audio-chunk` → server decodes and forwards to Deepgram
- Deepgram sends interim/final transcripts → server emits `stt:transcript` to client
- Deepgram sends UtteranceEnd → server emits `stt:utterance-end` to client
- Client commits final transcript as `user:message` after utterance end

**Why Deepgram (not Web Speech API):** Web Speech API is fundamentally broken in Electron (electron/electron#46143, #24278, #7749). Deepgram Nova-3 provides 150ms latency, best-in-class 6.84% WER, and $200 free credits (~433 hours).

### Socket Events (STT)

| Direction | Event | Payload | When |
|-----------|-------|---------|------|
| Client → Server | `stt:start` | `{ sessionId, mimeType? }` | User starts listening |
| Client → Server | `stt:audio-chunk` | `{ sessionId, data }` | Raw mic audio (base64) |
| Client → Server | `stt:stop` | `{ sessionId }` | User stops listening |
| Server → Client | `stt:ready` | `{}` | Deepgram connection established |
| Server → Client | `stt:transcript` | `{ text, isFinal, confidence, speechFinal }` | Transcript from Deepgram |
| Server → Client | `stt:utterance-end` | `{}` | End of speech detected |
| Server → Client | `stt:error` | `{ message }` | Deepgram error |

---

## Cartesia TTS — `server/src/lib/cartesia.ts`

Converts agent text responses to streaming audio via Cartesia Sonic-2:

```typescript
class CartesiaTTS {
  // WebSocket connection to Cartesia TTS API
  // Manages contexts for prosody continuity across sentence chunks

  connect(): Promise<void>                                // Eagerly connect WebSocket
  createContext(): string                                  // UUID-based context ID per turn
  sendChunk(contextId, text, continueTurn): Promise<void>  // Send text for synthesis
  finalizeContext(contextId): Promise<void>                // Empty text + continue: false
  cancelContext(contextId): void                           // Cancel in-flight context
  disconnect(): void                                       // Close WebSocket
}
```

**Key design decisions:**
- **Context management**: One context ID per conversation turn maintains natural prosody across sentence chunks
- **Output format**: PCM f32le @ 44100Hz — efficient for WebAudio playback
- **Model**: `sonic-2` (40ms TTFA, sub-100ms streaming)
- **Callbacks**: `onChunk` delivers base64 audio, `onDone` signals context completion

### TTS Pipeline Flow

After the supervisor returns `responseText`:

```
responseText → sentence splitting → send chunks to Cartesia (continue: true)
  → Cartesia streams PCM audio → emit audio:chunk to client
  → finalize context (continue: false) → emit audio:done
```

### Sentence Splitting Strategy

The server splits response text into optimal chunks for TTS:

1. **Sentence boundaries** (`[.?!]\s`): Natural break points, always flush
2. **Clause boundaries** (`[,;:]\s`): Used for faster first-audio (min 40 chars)
3. **Hard flush**: If buffer exceeds 150 chars, break at last space

This achieves **low time-to-first-audio** while maintaining natural speech prosody.

### Socket Events (TTS)

| Direction | Event | Payload | When |
|-----------|-------|---------|------|
| Server → Client | `status` | `{ state: "speaking", label }` | Before first audio chunk |
| Server → Client | `audio:chunk` | `{ data, index, final, sampleRate, encoding }` | PCM f32le from Cartesia |
| Server → Client | `audio:done` | `{ sessionId }` | TTS context completed |
| Client → Server | `audio:interrupt` | `{ sessionId }` | User speaks during playback |

---

## Client-Side Audio Playback — `client/src/hooks/useAudioPlayer.ts`

Custom WebAudio API player with jitter buffering:

```typescript
function useAudioPlayer(): {
  playChunk: (base64Data: string, sampleRate: number) => void;
  stopPlayback: () => void;
  initAudio: () => void;
  isPlaying: () => boolean;
}
```

### Audio Decoding
- Input: Base64-encoded PCM f32le
- Process: Base64 → Uint8Array → Float32Array
- Output: Scheduled via `AudioBufferSourceNode` at 44100Hz

### Jitter Buffer
- **Initial buffer**: 200ms (~8820 samples) before starting playback
- **Max-wait timer**: 300ms fallback for short responses
- **Batch size**: ~80ms for ongoing playback
- **Flush timer**: 50ms batch timeout for partial buffers

---

## Barge-In / Interruption Flow

```
Timeline:
  0ms    User sends user:message → server dispatches to supervisor
  ~300ms Supervisor returns responseText
  ~350ms First sentence → Cartesia TTS → audio:chunk to client
  ~550ms Client starts playing audio

  2000ms User starts speaking (Deepgram detects speech)
  2010ms stt:transcript (interim) arrives at client
  2015ms handleBargeIn():
           - stopPlayback() → audio stops instantly
           - audio:interrupt → server
  2020ms Server receives audio:interrupt:
           - AbortController cancels supervisor/TTS
           - Cartesia context cancelled
           - status: "listening"
  2100ms Deepgram processes new speech...
  2500ms stt:utterance-end → client commits new user:message
```

---

## Environment Variables

```env
DEEPGRAM_API_KEY=...           # Deepgram Nova-3 STT ($200 free credits)
CARTESIA_API_KEY=...           # Cartesia Sonic-2 TTS
CARTESIA_VOICE_ID=...          # Voice ID (optional, defaults to built-in)
```

---

## Dependencies

### Server
```json
{
  "@deepgram/sdk": "^3.x",        // Deepgram STT WebSocket
  "ws": "^8.19.0",                // Raw WebSocket for Cartesia TTS
  "uuid": "^13.0.0"               // Context ID generation
}
```

### Client
```json
{
  "socket.io-client": "^4.8"      // Socket.io for real-time communication
}
```

---

## Performance Targets

| Metric | Target | Notes |
|--------|--------|-------|
| Deepgram STT latency | ~150ms | Interim results for fast feedback |
| Cartesia TTFA | ~40ms | Time to first audio byte |
| End-to-end voice latency | < 1s | From utterance end to first audio playback |
| Interruption response | < 50ms | From barge-in detection to audio stop |
