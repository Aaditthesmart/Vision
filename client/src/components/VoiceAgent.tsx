"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useSocket } from "@/hooks/useSocket";
import { useDeepgramSTT } from "@/hooks/useDeepgramSTT";
import { useAudioPlayer } from "@/hooks/useAudioPlayer";
import { MicButton } from "./MicButton";
import { StatusIndicator } from "./StatusIndicator";
import { Transcript } from "./Transcript";
import { VolumeX, Volume2 } from "lucide-react";
import type { AgentState, TranscriptEntry } from "@/lib/types";

export function VoiceAgent() {
  const [entries, setEntries] = useState<TranscriptEntry[]>([]);
  const [streamingText, setStreamingText] = useState("");
  const [agentState, setAgentState] = useState<AgentState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [hasMounted, setHasMounted] = useState(false);

  useEffect(() => setHasMounted(true), []);

  const streamingTextRef = useRef("");
  const serverStateRef = useRef<AgentState>("idle");
  const serverGeneratingRef = useRef(true);

  const {
    isConnected,
    sendMessage,
    stopAudio,
    serverState,
    serverGenerating,
    onAssistantText,
    onAudioChunk,
    onAudioDone,
    onError,
    socketRef,
  } = useSocket();

  const { playChunk, stopPlayback, initAudio, isPlaying } = useAudioPlayer();

  // Stable refs for functions used in barge-in callback
  const stopAudioRef = useRef(stopAudio);
  const stopPlaybackRef = useRef(stopPlayback);
  const sendMessageRef = useRef(sendMessage);
  const isPlayingRef = useRef(isPlaying);
  useEffect(() => {
    stopAudioRef.current = stopAudio;
    stopPlaybackRef.current = stopPlayback;
    sendMessageRef.current = sendMessage;
    isPlayingRef.current = isPlaying;
  }, [stopAudio, stopPlayback, sendMessage, isPlaying]);

  // Instant barge-in: any speech detected → kill audio immediately
  const handleBargeIn = useCallback(() => {
    // Only act if audio is actually playing
    if (!isPlayingRef.current()) return;

    // Stop local audio playback instantly
    stopPlaybackRef.current();

    // Tell server to abort pipeline (stops LLM + TTS)
    stopAudioRef.current();

    // Finalize any in-progress streaming assistant text
    const pendingText = streamingTextRef.current;
    if (pendingText) {
      setEntries((prev) => [...prev, {
        id: crypto.randomUUID(),
        role: "assistant",
        text: pendingText,
        timestamp: Date.now(),
      }]);
      setStreamingText("");
      streamingTextRef.current = "";
    }
  }, []);

  // On final transcript — send the complete user message
  const handleFinalTranscript = useCallback((text: string) => {
    if (!text.trim()) return;

    const entry: TranscriptEntry = {
      id: crypto.randomUUID(),
      role: "user",
      text: text.trim(),
      timestamp: Date.now(),
    };
    setEntries((prev) => [...prev, entry]);

    sendMessageRef.current(text.trim());
  }, []);

  const {
    isListening,
    interimTranscript,
    startListening,
    stopListening,
    isSupported,
    isMuted,
    toggleMute,
  } = useDeepgramSTT(handleFinalTranscript, handleBargeIn, socketRef);

  // Wire up socket event handlers
  useEffect(() => {
    onAssistantText((text, done) => {
      if (done) {
        const finalText = streamingTextRef.current;
        if (finalText) {
          const entry: TranscriptEntry = {
            id: crypto.randomUUID(),
            role: "assistant",
            text: finalText,
            timestamp: Date.now(),
          };
          setEntries((prev) => [...prev, entry]);
          setStreamingText("");
          streamingTextRef.current = "";
        }
      } else {
        streamingTextRef.current += text;
        setStreamingText(streamingTextRef.current);
      }
    });

    onAudioChunk((data) => {
      playChunk(data);
    });

    onAudioDone(() => {
      // Buffers will drain naturally
    });

    onError((message) => {
      setError(message);
      setTimeout(() => setError(null), 5000);
    });
  }, [onAssistantText, onAudioChunk, onAudioDone, onError, playChunk]);

  // Derive combined state
  useEffect(() => {
    let next: AgentState;
    if (serverState === "thinking" || serverState === "speaking") {
      next = serverState;
    } else if (isListening) {
      next = "listening";
    } else {
      next = "idle";
    }
    setAgentState(next);
  }, [isListening, serverState]);

  const handleMicClick = useCallback(() => {
    if (isListening) {
      stopListening();
    } else {
      // Init audio playback context only when starting — not before getUserMedia
      initAudio();
      startListening();
    }
  }, [isListening, startListening, stopListening, initAudio]);

  return (
    <div className="flex flex-col h-screen bg-gray-950">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800/50">
        <h1 className="text-lg font-semibold text-gray-100">Voice Agent</h1>
        <StatusIndicator state={agentState} isConnected={isConnected} />
      </div>

      {/* Transcript */}
      <Transcript entries={entries} streamingText={streamingText} />

      {/* Interim transcript */}
      {interimTranscript && (
        <div className="px-6 py-2 text-sm text-gray-400 italic text-center">
          {interimTranscript}
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div className="mx-6 mb-2 px-4 py-2 bg-red-900/30 border border-red-700/30 rounded-lg text-red-300 text-sm text-center">
          {error}
        </div>
      )}

      {/* Mic button area */}
      <div className="flex flex-col items-center gap-4 py-8 border-t border-gray-800/50">
        <div className="flex items-center gap-4">
          <MicButton
            isListening={isListening}
            onClick={handleMicClick}
            disabled={!isConnected || !isSupported}
          />
          {isListening && (
            <button
              onClick={toggleMute}
              className={`p-3 rounded-full transition-colors ${
                isMuted
                  ? "bg-yellow-500/20 text-yellow-400 hover:bg-yellow-500/30"
                  : "bg-gray-700/50 text-gray-400 hover:bg-gray-700/70"
              }`}
              title={isMuted ? "Unmute — resume transcription" : "Mute — suppress transcription"}
            >
              {isMuted ? <VolumeX size={20} /> : <Volume2 size={20} />}
            </button>
          )}
        </div>
        {hasMounted && !isSupported && (
          <p className="text-xs text-gray-500">
            Microphone access is required for voice input.
          </p>
        )}
      </div>
    </div>
  );
}
