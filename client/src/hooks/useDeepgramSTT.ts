"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import type { Socket } from "socket.io-client";

interface UseDeepgramSTTReturn {
  isListening: boolean;
  interimTranscript: string;
  startListening: () => void;
  stopListening: () => void;
  isSupported: boolean;
  isMuted: boolean;
  toggleMute: () => void;
}

/**
 * Deepgram Nova-2 STT via server relay.
 *
 * Flow: Mic → MediaRecorder (WebM/Opus) → socket.io → server → Deepgram WS
 *       Deepgram → server → socket.io → this hook (transcript + VAD events)
 */
export function useDeepgramSTT(
  onFinalTranscript?: (text: string) => void,
  onBargeIn?: () => void,
  socketRef?: { current: Socket | null }
): UseDeepgramSTTReturn {
  const [isListening, setIsListening] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState("");
  const [isMuted, setIsMuted] = useState(false);
  const isMutedRef = useRef(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const onFinalRef = useRef(onFinalTranscript);
  const onBargeInRef = useRef(onBargeIn);
  const finalSegmentsRef = useRef<string[]>([]);
  const listenersAttachedRef = useRef(false);

  const isSupported =
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia;

  useEffect(() => {
    onFinalRef.current = onFinalTranscript;
    onBargeInRef.current = onBargeIn;
  }, [onFinalTranscript, onBargeIn]);

  const toggleMute = useCallback(() => {
    isMutedRef.current = !isMutedRef.current;
    setIsMuted(isMutedRef.current);
    if (isMutedRef.current) {
      finalSegmentsRef.current = [];
      setInterimTranscript("");
    }
  }, []);

  const handleTranscript = useCallback(
    (payload: { text: string; is_final: boolean; speech_final: boolean }) => {
      if (isMutedRef.current) return;

      const { text, is_final, speech_final } = payload;

      if (speech_final) {
        // End of utterance — combine buffered final segments + this one
        if (text) finalSegmentsRef.current.push(text);
        const fullText = finalSegmentsRef.current.join(" ").trim();
        finalSegmentsRef.current = [];
        setInterimTranscript("");
        if (fullText) {
          onFinalRef.current?.(fullText);
        }
      } else if (is_final) {
        // Finalized segment but utterance continues — buffer it
        if (text) finalSegmentsRef.current.push(text);
        setInterimTranscript("");
      } else {
        // Interim result — show for visual feedback + trigger barge-in
        if (text) {
          onBargeInRef.current?.();
          const buffered = finalSegmentsRef.current.join(" ");
          const display = buffered ? `${buffered} ${text}` : text;
          setInterimTranscript(display);
        }
      }
    },
    [],
  );

  const handleSpeechStarted = useCallback(() => {
    // no-op: rely on interim transcripts for barge-in to avoid
    // false triggers from background noise
  }, []);

  // Safety-net: flush any buffered segments on utterance end
  const handleUtteranceEnd = useCallback(() => {
    if (finalSegmentsRef.current.length > 0) {
      const fullText = finalSegmentsRef.current.join(" ").trim();
      finalSegmentsRef.current = [];
      setInterimTranscript("");
      if (fullText) {
        onFinalRef.current?.(fullText);
      }
    }
  }, []);

  const startListening = useCallback(async () => {
    if (!isSupported) return;

    const socket = socketRef?.current;
    if (!socket) {
      console.error("[DeepgramSTT] No socket connection");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Register socket listeners (idempotent — only attach once)
      if (!listenersAttachedRef.current) {
        socket.on("stt_transcript", handleTranscript);
        socket.on("stt_speech_started", handleSpeechStarted);
        socket.on("stt_utterance_end", handleUtteranceEnd);
        listenersAttachedRef.current = true;
      }

      // Tell server to open Deepgram connection
      socket.emit("stt_start", {});

      // Pick a supported MIME type
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";

      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0 && socketRef?.current) {
          event.data.arrayBuffer().then((buffer) => {
            socketRef.current?.emit("stt_audio", buffer);
          });
        }
      };

      // Send audio chunks every 250ms
      recorder.start(250);
      setIsListening(true);
      finalSegmentsRef.current = [];
      console.log("[DeepgramSTT] Started listening");
    } catch (err) {
      console.error("[DeepgramSTT] Failed to start:", err);
    }
  }, [isSupported, socketRef, handleTranscript, handleSpeechStarted, handleUtteranceEnd]);

  const stopListening = useCallback(() => {
    // Stop MediaRecorder
    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state !== "inactive"
    ) {
      mediaRecorderRef.current.stop();
    }
    mediaRecorderRef.current = null;

    // Release mic tracks
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }

    // Tell server to close Deepgram connection
    socketRef?.current?.emit("stt_stop", {});

    // Remove socket listeners
    const socket = socketRef?.current;
    if (socket && listenersAttachedRef.current) {
      socket.off("stt_transcript", handleTranscript);
      socket.off("stt_speech_started", handleSpeechStarted);
      socket.off("stt_utterance_end", handleUtteranceEnd);
      listenersAttachedRef.current = false;
    }

    setIsListening(false);
    setInterimTranscript("");
    finalSegmentsRef.current = [];
    console.log("[DeepgramSTT] Stopped listening");
  }, [socketRef, handleTranscript, handleSpeechStarted, handleUtteranceEnd]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (
        mediaRecorderRef.current &&
        mediaRecorderRef.current.state !== "inactive"
      ) {
        mediaRecorderRef.current.stop();
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
      const socket = socketRef?.current;
      if (socket && listenersAttachedRef.current) {
        socket.off("stt_transcript", handleTranscript);
        socket.off("stt_speech_started", handleSpeechStarted);
        socket.off("stt_utterance_end", handleUtteranceEnd);
      }
    };
  }, [socketRef, handleTranscript, handleSpeechStarted, handleUtteranceEnd]);

  return {
    isListening,
    interimTranscript,
    startListening,
    stopListening,
    isSupported,
    isMuted,
    toggleMute,
  };
}
