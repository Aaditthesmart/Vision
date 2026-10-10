import { useRef, useCallback } from "react";

const SAMPLE_RATE = 24000;

// Jitter buffer: accumulate this many samples before starting playback
// 200ms @ 24kHz = 4800 samples — absorbs network jitter
const JITTER_BUFFER_SAMPLES = SAMPLE_RATE * 0.2;

// Once playing, batch incoming chunks into ~80ms buffers to reduce AudioNode overhead
const BATCH_MIN_SAMPLES = SAMPLE_RATE * 0.08;

interface UseAudioPlayerReturn {
  playChunk: (base64Data: string) => void;
  stopPlayback: () => void;
  initAudio: () => void;
  isPlaying: () => boolean;
}

export function useAudioPlayer(): UseAudioPlayerReturn {
  const audioCtxRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef(0);
  const sourceNodesRef = useRef<AudioBufferSourceNode[]>([]);

  // Jitter buffer state
  const pendingSamplesRef = useRef<Float32Array[]>([]);
  const pendingLengthRef = useRef(0);
  const playbackStartedRef = useRef(false);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const initAudio = useCallback(() => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioContext({ sampleRate: SAMPLE_RATE });
    }
    if (audioCtxRef.current.state === "suspended") {
      audioCtxRef.current.resume();
    }
  }, []);

  const scheduleBuffer = useCallback((float32: Float32Array) => {
    const ctx = audioCtxRef.current;
    if (!ctx || float32.length === 0) return;

    const audioBuffer = ctx.createBuffer(1, float32.length, SAMPLE_RATE);
    audioBuffer.getChannelData(0).set(float32);

    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(ctx.destination);

    const now = ctx.currentTime;
    const startTime = Math.max(now + 0.01, nextStartTimeRef.current);
    source.start(startTime);
    nextStartTimeRef.current = startTime + audioBuffer.duration;

    sourceNodesRef.current.push(source);
    source.onended = () => {
      const idx = sourceNodesRef.current.indexOf(source);
      if (idx !== -1) sourceNodesRef.current.splice(idx, 1);
    };
  }, []);

  const flushPending = useCallback(() => {
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }

    const chunks = pendingSamplesRef.current;
    const totalLen = pendingLengthRef.current;
    if (totalLen === 0) return;

    const merged = new Float32Array(totalLen);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }

    pendingSamplesRef.current = [];
    pendingLengthRef.current = 0;

    scheduleBuffer(merged);
  }, [scheduleBuffer]);

  const decodeBase64PCM = useCallback((base64Data: string): Float32Array => {
    const binaryString = atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    const int16 = new Int16Array(bytes.buffer);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) {
      float32[i] = int16[i] / 32768;
    }
    return float32;
  }, []);

  const playChunk = useCallback(
    (base64Data: string) => {
      // Auto-init AudioContext on first chunk (no manual initAudio() needed)
      if (!audioCtxRef.current) {
        audioCtxRef.current = new AudioContext({ sampleRate: SAMPLE_RATE });
      }
      const ctx = audioCtxRef.current;

      if (ctx.state === "suspended") {
        ctx.resume();
      }

      const float32 = decodeBase64PCM(base64Data);

      pendingSamplesRef.current.push(float32);
      pendingLengthRef.current += float32.length;

      if (!playbackStartedRef.current) {
        // JITTER BUFFER: wait until we have enough data before starting
        if (pendingLengthRef.current >= JITTER_BUFFER_SAMPLES) {
          playbackStartedRef.current = true;
          flushPending();
        }
        // Also set a max-wait timer so we don't wait forever on short responses
        if (!flushTimerRef.current) {
          flushTimerRef.current = setTimeout(() => {
            if (!playbackStartedRef.current && pendingLengthRef.current > 0) {
              playbackStartedRef.current = true;
              flushPending();
            }
          }, 300);
        }
      } else {
        // Already playing — batch into ~80ms buffers
        if (pendingLengthRef.current >= BATCH_MIN_SAMPLES) {
          flushPending();
        } else if (!flushTimerRef.current) {
          flushTimerRef.current = setTimeout(flushPending, 50);
        }
      }
    },
    [decodeBase64PCM, flushPending]
  );

  const stopPlayback = useCallback(() => {
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    pendingSamplesRef.current = [];
    pendingLengthRef.current = 0;
    playbackStartedRef.current = false;

    for (const source of sourceNodesRef.current) {
      try {
        source.stop();
      } catch {
        // Already stopped
      }
    }
    sourceNodesRef.current = [];
    nextStartTimeRef.current = 0;
  }, []);

  const isPlaying = useCallback(() => {
    return sourceNodesRef.current.length > 0 || pendingLengthRef.current > 0;
  }, []);

  return { playChunk, stopPlayback, initAudio, isPlaying };
}
