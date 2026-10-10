import { useEffect, useRef, useCallback, useState } from "react";
import { io, Socket } from "socket.io-client";
import type { AgentState } from "@/lib/types";

const SERVER_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:3001";

interface UseSocketReturn {
  isConnected: boolean;
  sendMessage: (text: string) => void;
  stopAudio: () => void;
  serverState: AgentState;
  serverGenerating: boolean;
  onAssistantText: (cb: (text: string, done: boolean) => void) => void;
  onAudioChunk: (cb: (data: string) => void) => void;
  onAudioDone: (cb: () => void) => void;
  onError: (cb: (message: string) => void) => void;
  onConsoleLog: (cb: (message: string) => void) => void;
  socketRef: { current: Socket | null };
}

export function useSocket(): UseSocketReturn {
  const socketRef = useRef<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [serverState, setServerState] = useState<AgentState>("idle");
  const [serverGenerating, setServerGenerating] = useState(true);

  const assistantTextCb = useRef<((text: string, done: boolean) => void) | null>(null);
  const audioChunkCb = useRef<((data: string) => void) | null>(null);
  const audioDoneCb = useRef<(() => void) | null>(null);
  const errorCb = useRef<((message: string) => void) | null>(null);
  const consoleLogCb = useRef<((message: string) => void) | null>(null);

  useEffect(() => {
    const socket = io(SERVER_URL, { transports: ["websocket", "polling"] });
    socketRef.current = socket;

    socket.on("connect", () => {
      console.log("[Socket] Connected to server:", SERVER_URL);
      setIsConnected(true);
    });
    socket.on("disconnect", () => {
      console.log("[Socket] Disconnected from server");
      setIsConnected(false);
    });

    socket.on("status", (payload: { state: AgentState; generating?: boolean }) => {
      setServerState(payload.state);
      if (payload.generating === false) {
        setServerGenerating(false);
      } else if (payload.state === "thinking" || payload.state === "speaking") {
        setServerGenerating(true);
      }
    });

    socket.on("assistant_text", (payload: { text: string; done: boolean }) => {
      assistantTextCb.current?.(payload.text, payload.done);
    });

    socket.on("audio_chunk", (payload: { data: string }) => {
      audioChunkCb.current?.(payload.data);
    });

    socket.on("audio_done", () => {
      audioDoneCb.current?.();
    });

    socket.on("error", (payload: { message: string }) => {
      errorCb.current?.(payload.message);
    });

    socket.on("console_log", (payload: { message: string }) => {
      consoleLogCb.current?.(payload.message);
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  const sendMessage = useCallback((text: string) => {
    socketRef.current?.emit("user_message", { text });
  }, []);

  const stopAudio = useCallback(() => {
    socketRef.current?.emit("stop_audio", {});
  }, []);

  const onAssistantText = useCallback(
    (cb: (text: string, done: boolean) => void) => {
      assistantTextCb.current = cb;
    },
    []
  );

  const onAudioChunk = useCallback((cb: (data: string) => void) => {
    audioChunkCb.current = cb;
  }, []);

  const onAudioDone = useCallback((cb: () => void) => {
    audioDoneCb.current = cb;
  }, []);

  const onError = useCallback((cb: (message: string) => void) => {
    errorCb.current = cb;
  }, []);

  const onConsoleLog = useCallback((cb: (message: string) => void) => {
    consoleLogCb.current = cb;
  }, []);

  return {
    isConnected,
    sendMessage,
    stopAudio,
    serverState,
    serverGenerating,
    onAssistantText,
    onAudioChunk,
    onAudioDone,
    onError,
    onConsoleLog,
    socketRef,
  };
}
