import WebSocket from "ws";
import { v4 as uuidv4 } from "uuid";
import type { TTSProvider, ChunkCallback, DoneCallback } from "./types.js";

interface CartesiaConfig {
  apiKey: string;
  voiceId: string;
  sampleRate?: number;
}

export class CartesiaTTS implements TTSProvider {
  private apiKey: string;
  private voiceId: string;
  private sampleRate: number;
  private ws: WebSocket | null = null;
  private onChunk: ChunkCallback | null = null;
  private onDone: DoneCallback | null = null;
  private activeContexts = new Set<string>();
  private connectPromise: Promise<void> | null = null;

  constructor(config: CartesiaConfig) {
    this.apiKey = config.apiKey;
    this.voiceId = config.voiceId;
    this.sampleRate = config.sampleRate ?? 24000;
  }

  async connect(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) return;
    if (this.connectPromise) return this.connectPromise;

    this.connectPromise = new Promise<void>((resolve, reject) => {
      const url = `wss://api.cartesia.ai/tts/websocket?api_key=${this.apiKey}&cartesia_version=2024-06-10`;
      this.ws = new WebSocket(url);

      this.ws.on("open", () => {
        console.log("[Cartesia] WebSocket connected");
        this.connectPromise = null;
        resolve();
      });

      this.ws.on("message", (data: WebSocket.Data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === "chunk" && msg.data) {
            const ctxId = msg.context_id;
            if (this.activeContexts.has(ctxId)) {
              this.onChunk?.(ctxId, msg.data);
            }
          } else if (msg.type === "done") {
            const ctxId = msg.context_id;
            this.activeContexts.delete(ctxId);
            this.onDone?.(ctxId);
          }
        } catch {
          // ignore parse errors
        }
      });

      this.ws.on("close", () => {
        console.log("[Cartesia] WebSocket closed");
        this.ws = null;
        this.connectPromise = null;
      });

      this.ws.on("error", (err) => {
        console.error("[Cartesia] WebSocket error:", err.message);
        this.connectPromise = null;
        reject(err);
      });
    });

    return this.connectPromise;
  }

  setCallbacks(onChunk: ChunkCallback, onDone: DoneCallback) {
    this.onChunk = onChunk;
    this.onDone = onDone;
  }

  /** Create a new context ID for a full turn of speech. */
  createContext(): string {
    const ctxId = uuidv4();
    this.activeContexts.add(ctxId);
    return ctxId;
  }

  /**
   * Send a text chunk to be synthesized within an existing context.
   * Set `continueTurn: true` for all chunks except the final one.
   */
  async sendChunk(
    contextId: string,
    text: string,
    continueTurn: boolean
  ): Promise<void> {
    await this.connect();

    if (!this.activeContexts.has(contextId)) return;

    const message: Record<string, unknown> = {
      context_id: contextId,
      model_id: "sonic-3",
      transcript: text,
      continue: continueTurn,
      voice: {
        mode: "id",
        id: this.voiceId,
        __experimental_controls: {
          speed: "normal",
          emotion: ["positivity", "curiosity:low"],
        },
      },
      output_format: {
        container: "raw",
        encoding: "pcm_s16le",
        sample_rate: this.sampleRate,
      },
      language: "en",
    };

    this.ws!.send(JSON.stringify(message));
  }

  /** Finalize a context — sends empty transcript with continue: false. */
  async finalizeContext(contextId: string): Promise<void> {
    await this.sendChunk(contextId, "", false);
  }

  cancelContext(contextId: string) {
    this.activeContexts.delete(contextId);
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          context_id: contextId,
          cancel: true,
        })
      );
    }
  }

  cancelAll() {
    for (const ctxId of this.activeContexts) {
      this.cancelContext(ctxId);
    }
    this.activeContexts.clear();
  }

  disconnect() {
    this.cancelAll();
    this.ws?.close();
    this.ws = null;
  }
}
