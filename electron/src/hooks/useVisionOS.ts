import { useEffect, useState, useRef, useCallback } from "react";
import { io, Socket } from "socket.io-client";

export interface ModelStatus {
  provider: "ollama_local";
  modelName: string;
  connected: boolean;
  availableModels: string[];
  zeroPaidApi: boolean;
  error?: string;
}

export interface ActionStep {
  id: string;
  description: string;
  actionType: string;
  selector?: string;
  value?: string;
  expectedOutcome: string;
  verificationMethod: string;
  isConsequential: boolean;
  requiresApproval: boolean;
  status: "PLANNED" | "WAITING_FOR_APPROVAL" | "EXECUTING" | "VERIFYING" | "SUCCEEDED" | "FAILED" | "RECOVERY_REQUIRED" | "CANCELLED";
  error?: string;
  verificationEvidence?: string;
}

export interface TaskPlan {
  userGoal: string;
  summary: string;
  steps: ActionStep[];
  requiresApproval: boolean;
  estimatedRisk: "LOW" | "MEDIUM" | "HIGH";
}

export interface ApprovalRequest {
  stepId: string;
  description: string;
  expectedOutcome: string;
  isConsequential: boolean;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system" | "error";
  text: string;
  timestamp: number;
}

export interface ExecutionTrace {
  timestamp: number;
  level: "info" | "warn" | "error";
  message: string;
  details?: any;
}

const SERVER_URL = "http://localhost:3001";

// ── Web Audio Synthesizer for Audio Feedback (Accessibility) ───────────
function playAudioTone(type: "start" | "stop" | "success" | "error") {
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();

    if (type === "start") {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.setValueAtTime(440, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.15);
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.2);
      osc.start();
      osc.stop(ctx.currentTime + 0.2);
    } else if (type === "stop") {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.setValueAtTime(700, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(350, ctx.currentTime + 0.15);
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.2);
      osc.start();
      osc.stop(ctx.currentTime + 0.2);
    } else if (type === "success") {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.setValueAtTime(587, ctx.currentTime);
      osc.frequency.setValueAtTime(880, ctx.currentTime + 0.1);
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.25);
      osc.start();
      osc.stop(ctx.currentTime + 0.25);
    } else if (type === "error") {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(220, ctx.currentTime);
      osc.frequency.setValueAtTime(160, ctx.currentTime + 0.15);
      gain.gain.setValueAtTime(0.25, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
      osc.start();
      osc.stop(ctx.currentTime + 0.3);
    }
  } catch {
    // Non-fatal if audio context is blocked
  }
}

export function useVisionOS() {
  const [socketConnected, setSocketConnected] = useState(false);
  const [modelStatus, setModelStatus] = useState<ModelStatus | null>(null);
  const [agentStatus, setAgentStatus] = useState<string>("idle");
  const [currentPlan, setCurrentPlan] = useState<TaskPlan | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [approvalRequest, setApprovalRequest] = useState<ApprovalRequest | null>(null);
  const [executionTraces, setExecutionTraces] = useState<ExecutionTrace[]>([]);
  const [pageSummary, setPageSummary] = useState<{ title: string; url: string; summary: string } | null>(null);
  const [speechEnabled, setSpeechEnabled] = useState(true);
  const [isListening, setIsListening] = useState(false);
  const [interimSpeech, setInterimSpeech] = useState<string>("");

  const socketRef = useRef<Socket | null>(null);
  const recognitionRef = useRef<any>(null);

  // Initialize Speech Synthesis
  const speakText = useCallback((text: string) => {
    if (!speechEnabled || !("speechSynthesis" in window)) return;
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.05;
      utterance.pitch = 1.0;
      window.speechSynthesis.speak(utterance);
    } catch {
      // Non-fatal if speech synthesis is disabled
    }
  }, [speechEnabled]);

  // Connect Socket.IO
  useEffect(() => {
    const socket = io(SERVER_URL, {
      transports: ["websocket", "polling"],
      reconnectionAttempts: 15,
    });
    socketRef.current = socket;

    socket.on("connect", () => {
      setSocketConnected(true);
      console.log("[useVisionOS] Connected to VisionOS backend");
      socket.emit("request_model_status");
    });

    socket.on("disconnect", () => {
      setSocketConnected(false);
      setIsListening(false);
    });

    socket.on("model_status", (status: ModelStatus) => {
      setModelStatus(status);
    });

    socket.on("agent_status", (status: string) => {
      setAgentStatus(status);
    });

    socket.on("task_plan", (plan: TaskPlan) => {
      setCurrentPlan(plan);
    });

    socket.on("step_update", (updatedStep: ActionStep) => {
      setCurrentPlan((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          steps: prev.steps.map((s) => (s.id === updatedStep.id ? updatedStep : s)),
        };
      });
    });

    socket.on("approval_required", (req: ApprovalRequest) => {
      setApprovalRequest(req);
      playAudioTone("error");
    });

    socket.on("assistant_message", (msg: { text: string; role: "assistant" | "system" | "error"; speechText?: string }) => {
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: msg.role,
          text: msg.text,
          timestamp: Date.now(),
        },
      ]);
      if (msg.speechText) {
        speakText(msg.speechText);
      }
    });

    socket.on("page_summary", (data: { title: string; url: string; summary: string }) => {
      setPageSummary(data);
    });

    socket.on("execution_trace", (trace: ExecutionTrace) => {
      setExecutionTraces((prev) => [...prev.slice(-100), trace]);
    });

    socket.on("task_completed", (data: { success: boolean; message: string }) => {
      setApprovalRequest(null);
      if (data.success) {
        playAudioTone("success");
        speakText("Task completed successfully.");
      } else {
        playAudioTone("error");
      }
    });

    // ── Native Voice Recognition Socket Events ──
    socket.on("voice_status", (data: { listening: boolean }) => {
      setIsListening(data.listening);
      if (data.listening) {
        playAudioTone("start");
      } else {
        playAudioTone("stop");
        setInterimSpeech("");
      }
    });

    socket.on("voice_interim", (data: { text: string }) => {
      setInterimSpeech(data.text);
    });

    socket.on("voice_transcript", (data: { transcript: string; confidence: number }) => {
      setInterimSpeech("");
      setIsListening(false);
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "user",
          text: data.transcript,
          timestamp: Date.now(),
        },
      ]);
      playAudioTone("success");
    });

    socket.on("voice_error", (data: { error: string }) => {
      setIsListening(false);
      playAudioTone("error");
      console.warn("[useVisionOS] Voice error:", data.error);
    });

    return () => {
      socket.disconnect();
    };
  }, [speakText]);

  // Send natural language goal — declared BEFORE startListening so it can be in its dep array
  const sendGoal = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed || !socketRef.current) return;

    setMessages((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        role: "user",
        text: trimmed,
        timestamp: Date.now(),
      },
    ]);

    socketRef.current.emit("user_message", { text: trimmed });
  }, []);

  // Start Voice Listening (Tries Native Windows speech first, fallback to Web Speech)
  const startListening = useCallback(() => {
    playAudioTone("start");
    setIsListening(true);

    if (socketRef.current) {
      socketRef.current.emit("start_voice");
    }

    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (SpeechRecognition) {
      try {
        const recognition = new SpeechRecognition();
        recognition.continuous = true;  // keep session open until user stops
        recognition.interimResults = true;
        recognition.lang = "en-US";
        recognition.maxAlternatives = 1;

        recognition.onstart = () => {
          setIsListening(true);
        };

        recognition.onresult = (event: any) => {
          // Walk all new results
          for (let i = event.resultIndex; i < event.results.length; i++) {
            const transcript = event.results[i][0].transcript;
            if (transcript) {
              if (event.results[i].isFinal) {
                sendGoal(transcript);
                setInterimSpeech("");
              } else {
                setInterimSpeech(transcript);
              }
            }
          }
        };

        // Suppress premature close — continuous mode handles cleanup
        recognition.onerror = (e: any) => {
          console.warn("[SpeechRecognition] error:", e.error);
          // Only stop listening state on fatal errors
          if (e.error === "not-allowed" || e.error === "service-not-allowed") {
            setIsListening(false);
          }
        };
        recognition.onend = () => {
          // If still supposed to be listening, restart immediately
          if (recognitionRef.current) {
            try { recognitionRef.current.start(); } catch { /* already started */ }
          }
        };

        recognitionRef.current = recognition;
        recognition.start();
      } catch (err) {
        console.warn("[SpeechRecognition] Could not start:", err);
        // Backend native Windows listener handles this fallback
      }
    }
  }, [sendGoal]);

  const stopListening = useCallback(() => {
    playAudioTone("stop");
    setIsListening(false);
    setInterimSpeech("");

    if (socketRef.current) {
      socketRef.current.emit("stop_voice");
    }

    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // ignore
      }
      recognitionRef.current = null;
    }
  }, []);

  // Approve / Decline Consequential Action
  const handleApproval = useCallback((stepId: string, approved: boolean) => {
    if (!socketRef.current) return;
    socketRef.current.emit("approve_action", { stepId, approved });
    setApprovalRequest(null);
  }, []);

  // Cancel running task
  const cancelTask = useCallback(() => {
    if (!socketRef.current) return;
    socketRef.current.emit("cancel_task");
    setApprovalRequest(null);
    speakText("Task cancelled.");
  }, [speakText]);

  // Request page explanation
  const requestPageSummary = useCallback(() => {
    if (!socketRef.current) return;
    socketRef.current.emit("request_page_summary");
  }, []);

  // Navigate to URL
  const navigateUrl = useCallback((url: string) => {
    if (!socketRef.current) return;
    socketRef.current.emit("navigate_url", { url });
  }, []);

  return {
    socketConnected,
    modelStatus,
    agentStatus,
    currentPlan,
    messages,
    approvalRequest,
    executionTraces,
    pageSummary,
    speechEnabled,
    setSpeechEnabled,
    isListening,
    interimSpeech,
    startListening,
    stopListening,
    sendGoal,
    handleApproval,
    cancelTask,
    requestPageSummary,
    navigateUrl,
  };
}
