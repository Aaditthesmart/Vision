import type { Socket } from "socket.io";
import type { LLMProvider, Message } from "../llm/index.js";
import type { TTSProvider } from "../tts/types.js";

const SYSTEM_PROMPT = `You are a friendly, helpful voice assistant. Keep your responses conversational, concise, and natural — as if you're chatting with a friend. Aim for 1-3 sentences unless the user asks for detail. Avoid markdown formatting, bullet points, or numbered lists since your responses will be spoken aloud. Use natural pauses and conversational language.`;

const SENTENCE_END = /[.?!]\s/;
const CLAUSE_END = /[,;:]\s/;

const FIRST_FLUSH_MIN = 40;
const NORMAL_FLUSH_MIN = 60;
const MAX_BUFFER = 150;

export class VoicePipeline {
  private llm: LLMProvider | null;
  private tts: TTSProvider;
  private socket: Socket;
  private conversationHistory: Message[] = [];
  private abortController: AbortController | null = null;
  private currentContextId: string | null = null;
  private interimContextIds: Set<string> = new Set();
  private lastInterimPhrase = "";
  private lastInterimTime = 0;
  public state: "idle" | "thinking" | "speaking" = "idle";
  /** True while the LLM is actively streaming text. False once the stream ends
   *  (even if TTS audio is still draining to the client). */
  public generating = false;

  constructor(llm: LLMProvider | null, tts: TTSProvider, socket: Socket) {
    this.llm = llm;
    this.tts = tts;
    this.socket = socket;

    this.tts.setCallbacks(
      (_contextId, audioBase64) => {
        if (_contextId === this.currentContextId || this.interimContextIds.has(_contextId)) {
          this.socket.emit("audio_chunk", { data: audioBase64 });
        }
      },
      (_contextId) => {
        if (this.interimContextIds.has(_contextId)) {
          // Interim context finished — just clean up, don't change pipeline state
          this.interimContextIds.delete(_contextId);
          return;
        }
        if (_contextId === this.currentContextId) {
          this.currentContextId = null;
          this.socket.emit("audio_done", {});
          this.state = "idle";
          this.socket.emit("status", { state: "idle" });
        }
      }
    );
  }

  /**
   * Speak a short interim phrase during agent work (fire-and-forget).
   * Creates a separate TTS context so it doesn't interfere with the main response.
   * Throttled: same phrase within 4s is skipped, any phrase within 2s is skipped.
   */
  async speakInterim(text: string): Promise<void> {
    const now = Date.now();
    const GLOBAL_COOLDOWN_MS = 2000;
    const DEDUP_COOLDOWN_MS = 4000;

    if (now - this.lastInterimTime < GLOBAL_COOLDOWN_MS) return;
    if (text === this.lastInterimPhrase && now - this.lastInterimTime < DEDUP_COOLDOWN_MS) return;

    this.lastInterimPhrase = text;
    this.lastInterimTime = now;

    try {
      console.log(`[Pipeline] Interim speech: "${text}"`);
      const contextId = this.tts.createContext();
      this.interimContextIds.add(contextId);
      this.socket.emit("interim_text", { text });
      await this.tts.sendChunk(contextId, text, true);
      await this.tts.finalizeContext(contextId);
    } catch (err) {
      console.warn("[Pipeline] Interim speech error (non-fatal):", err instanceof Error ? err.message : err);
    }
  }

  /**
   * Process a complete response from the supervisor through TTS.
   * Unlike processMessage(), this takes already-generated text (no LLM streaming).
   */
  async processSupervisorResponse(responseText: string) {
    this.abort();

    this.abortController = new AbortController();
    const { signal } = this.abortController;

    this.state = "thinking";
    this.socket.emit("status", { state: "thinking" });

    const contextId = this.tts.createContext();
    this.currentContextId = contextId;

    // Emit full text to client at once
    this.socket.emit("assistant_text", { text: responseText, done: false });

    // Split into sentences for TTS chunking
    const sentences = responseText.match(/[^.!?]+[.!?]+[\s]*/g) || [responseText];

    this.state = "speaking";
    this.generating = false;
    this.socket.emit("status", { state: "speaking", generating: false });

    let chunksSent = 0;

    try {
      for (const sentence of sentences) {
        if (signal.aborted) break;
        const trimmed = sentence.trim();
        if (!trimmed) continue;
        await this.tts.sendChunk(contextId, trimmed, true);
        chunksSent++;
      }

      if (!signal.aborted && chunksSent > 0) {
        await this.tts.finalizeContext(contextId);
      }

      if (!signal.aborted) {
        this.socket.emit("assistant_text", { text: "", done: true });
      }

      // If no audio was sent, go idle immediately
      if (chunksSent === 0 && !signal.aborted) {
        this.currentContextId = null;
        this.socket.emit("audio_done", {});
        this.state = "idle";
        this.socket.emit("status", { state: "idle" });
      }
    } catch (err: any) {
      if (err.name !== "AbortError" && !signal.aborted) {
        console.error("[Pipeline] Supervisor TTS error:", err);
        this.socket.emit("error", { message: err.message || "Pipeline error" });
        // Still finalize the text so the client displays it
        this.socket.emit("assistant_text", { text: "", done: true });
        this.currentContextId = null;
        this.socket.emit("audio_done", {});
        this.state = "idle";
        this.socket.emit("status", { state: "idle" });
      }
    }
  }

  async processMessage(text: string, systemPrompt?: string): Promise<string> {
    if (!this.llm) {
      throw new Error("LLM provider not available — use processSupervisorResponse instead");
    }

    this.abort();

    this.abortController = new AbortController();
    const { signal } = this.abortController;

    this.conversationHistory.push({ role: "user", content: text });
    this.state = "thinking";
    this.socket.emit("status", { state: "thinking" });

    // One context ID for the entire turn — maintains prosody
    const contextId = this.tts.createContext();
    this.currentContextId = contextId;

    let fullResponse = "";
    let buffer = "";
    let firstAudioSent = false;
    let chunksSent = 0;

    const flush = async (toSend: string) => {
      if (!toSend || signal.aborted) return;
      if (!firstAudioSent) {
        firstAudioSent = true;
        this.state = "speaking";
        this.socket.emit("status", { state: "speaking" });
      }
      // Send with continue: true — we'll finalize later
      await this.tts.sendChunk(contextId, toSend, true);
      chunksSent++;
    };

    try {
      const stream = this.llm.streamResponse(
        this.conversationHistory,
        systemPrompt || SYSTEM_PROMPT,
        signal
      );

      this.generating = true;

      for await (const chunk of stream) {
        if (signal.aborted) break;

        fullResponse += chunk;
        buffer += chunk;

        this.socket.emit("assistant_text", { text: chunk, done: false });

        // Sentence boundaries
        let match: RegExpExecArray | null;
        while ((match = SENTENCE_END.exec(buffer)) !== null) {
          const end = match.index + match[0].length;
          const sentence = buffer.slice(0, end).trim();
          buffer = buffer.slice(end);
          if (sentence) await flush(sentence);
        }

        // Clause boundaries for faster first audio
        const minLen = chunksSent === 0 ? FIRST_FLUSH_MIN : NORMAL_FLUSH_MIN;
        if (buffer.length >= minLen) {
          const clauseMatch = CLAUSE_END.exec(buffer);
          if (clauseMatch && clauseMatch.index >= minLen * 0.5) {
            const end = clauseMatch.index + clauseMatch[0].length;
            const clause = buffer.slice(0, end).trim();
            buffer = buffer.slice(end);
            if (clause) await flush(clause);
          }
        }

        // Hard flush for long buffers
        if (buffer.length > MAX_BUFFER) {
          const lastSpace = buffer.lastIndexOf(" ");
          const breakPoint =
            lastSpace > MAX_BUFFER / 2 ? lastSpace + 1 : buffer.length;
          const toFlush = buffer.slice(0, breakPoint).trim();
          buffer = buffer.slice(breakPoint);
          if (toFlush) await flush(toFlush);
        }
      }

      this.generating = false;

      // Tell client LLM is done — barge-in no longer appropriate
      if (firstAudioSent && !signal.aborted) {
        this.socket.emit("status", { state: "speaking", generating: false });
      }

      // Flush remaining text
      if (buffer.trim() && !signal.aborted) {
        await flush(buffer.trim());
      }

      // Finalize the Cartesia context (continue: false)
      if (!signal.aborted && chunksSent > 0) {
        await this.tts.finalizeContext(contextId);
      }

      if (!signal.aborted) {
        this.socket.emit("assistant_text", { text: "", done: true });
      }

      if (fullResponse) {
        this.conversationHistory.push({
          role: "assistant",
          content: fullResponse,
        });
      }

      // If no audio was ever sent, go idle immediately
      if (!firstAudioSent && !signal.aborted) {
        this.currentContextId = null;
        this.socket.emit("audio_done", {});
        this.state = "idle";
        this.socket.emit("status", { state: "idle" });
      }
    } catch (err: any) {
      if (err.name !== "AbortError" && !signal.aborted) {
        console.error("[Pipeline] Error:", err);
        this.socket.emit("error", {
          message: err.message || "Pipeline error",
        });
        this.currentContextId = null;
        this.state = "idle";
        this.socket.emit("status", { state: "idle" });
      }
    }

    return fullResponse;
  }

  abort() {
    this.abortController?.abort();
    this.abortController = null;
    this.state = "idle";
    this.generating = false;
    if (this.currentContextId) {
      this.tts.cancelContext(this.currentContextId);
      this.currentContextId = null;
    }
    for (const id of this.interimContextIds) {
      this.tts.cancelContext(id);
    }
    this.interimContextIds.clear();
  }

  async connect() {
    await this.tts.connect();
  }

  disconnect() {
    this.abort();
    this.tts.disconnect();
  }
}
