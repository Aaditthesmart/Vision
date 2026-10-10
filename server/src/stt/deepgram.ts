import { createClient, LiveTranscriptionEvents } from "@deepgram/sdk";
import type { Socket } from "socket.io";

export class DeepgramSTT {
  private apiKey: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private connection: any = null;
  private isOpen = false;
  private pendingAudio: Buffer[] = [];
  private keepAliveInterval: ReturnType<typeof setInterval> | null = null;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  start(socket: Socket): void {
    this.stop();

    const deepgram = createClient(this.apiKey);

    const connection = deepgram.listen.live({
      model: "nova-3",
      language: "en-US",
      smart_format: true,
      interim_results: true,
      utterance_end_ms: 1500,
      vad_events: true,
      endpointing: 600,
    });

    connection.on(LiveTranscriptionEvents.Open, () => {
      console.log("[Deepgram] Connection opened");
      this.isOpen = true;

      // Flush any audio that arrived before connection opened
      for (const chunk of this.pendingAudio) {
        connection.send(new Uint8Array(chunk).buffer);
      }
      this.pendingAudio = [];
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    connection.on(LiveTranscriptionEvents.Transcript, (data: any) => {
      const transcript = data.channel?.alternatives?.[0]?.transcript;
      if (transcript === undefined || transcript === null) return;

      socket.emit("stt_transcript", {
        text: transcript,
        is_final: !!data.is_final,
        speech_final: !!data.speech_final,
      });
    });

    connection.on(LiveTranscriptionEvents.SpeechStarted, () => {
      socket.emit("stt_speech_started", {});
    });

    connection.on(LiveTranscriptionEvents.UtteranceEnd, () => {
      socket.emit("stt_utterance_end", {});
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    connection.on(LiveTranscriptionEvents.Error, (err: any) => {
      console.error("[Deepgram] Error:", err);
    });

    connection.on(LiveTranscriptionEvents.Close, () => {
      console.log("[Deepgram] Connection closed");
      this.isOpen = false;
    });

    this.connection = connection;

    // Keep-alive every 8 seconds to prevent timeout
    this.keepAliveInterval = setInterval(() => {
      if (this.connection && this.isOpen) {
        this.connection.keepAlive();
      }
    }, 8000);
  }

  sendAudio(data: Buffer): void {
    if (!this.connection) return;

    if (this.isOpen) {
      this.connection.send(new Uint8Array(data).buffer);
    } else {
      this.pendingAudio.push(data);
    }
  }

  stop(): void {
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = null;
    }

    if (this.connection) {
      try {
        this.connection.finish();
      } catch {
        // best-effort cleanup
      }
      this.connection = null;
      this.isOpen = false;
      this.pendingAudio = [];
    }
  }
}
