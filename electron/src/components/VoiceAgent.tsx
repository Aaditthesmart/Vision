import React, { useState, useRef, useEffect } from "react";
import { useVisionOS } from "../hooks/useVisionOS";
import { TaskPlanView } from "./TaskPlanView";
import { ApprovalModal } from "./ApprovalModal";

export const VoiceAgent: React.FC = () => {
  const {
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
  } = useVisionOS();

  const [inputVal, setInputVal] = useState("");
  const [showTraces, setShowTraces] = useState(false);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll chat to bottom
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [messages, currentPlan, interimSpeech]);

  // Auto-focus input on load
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Global shortcut for voice toggle (Alt + V)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.altKey && (e.key === "v" || e.key === "V")) {
        e.preventDefault();
        if (isListening) stopListening();
        else startListening();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isListening, startListening, stopListening]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputVal.trim()) return;
    sendGoal(inputVal);
    setInputVal("");
  };

  const handleQuickAction = (text: string) => {
    sendGoal(text);
  };

  return (
    <div className="flex flex-col h-full w-full bg-slate-950/95 text-slate-100 rounded-2xl border border-slate-700/80 shadow-2xl overflow-hidden backdrop-blur-xl">
      {/* ── ARIA Live Region for Screen Readers ─────────────────── */}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {messages.length > 0 ? messages[messages.length - 1].text : ""}
        {agentStatus === "executing" ? "VisionOS is executing your action." : ""}
        {agentStatus === "recovering" ? "VisionOS is attempting autonomous recovery." : ""}
        {isListening ? "VisionOS microphone is active. Speak your command now." : ""}
      </div>

      {/* ── Top App Bar (Draggable) ────────────────────────────── */}
      <header className="flex items-center justify-between px-4 py-2.5 bg-slate-900/90 border-b border-slate-800 select-none drag-region">
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-sky-400 animate-pulse shadow-[0_0_8px_#38bdf8]" />
          <h1 className="text-sm font-bold tracking-tight text-slate-100">VisionOS</h1>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-semibold border border-emerald-500/30">
            Voice Accessibility Engine
          </span>
        </div>

        {/* Model & Voice Status Badges */}
        <div className="flex items-center gap-2 text-xs text-slate-400 no-drag">
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-slate-800/80 border border-slate-700/60">
            <span
              className={`w-2 h-2 rounded-full ${
                socketConnected && modelStatus?.connected ? "bg-emerald-400" : "bg-amber-400 animate-pulse"
              }`}
            />
            <span className="text-[11px] font-mono text-slate-300">
              {modelStatus?.modelName || "Gemma 4 (Local)"}
            </span>
          </div>

          {/* Voice Output Toggle */}
          <button
            type="button"
            onClick={() => setSpeechEnabled(!speechEnabled)}
            aria-label={speechEnabled ? "Mute Voice Speech Feedback" : "Enable Voice Speech Feedback"}
            title={speechEnabled ? "Voice Feedback Active" : "Voice Muted"}
            className={`p-1.5 rounded-lg transition ${
              speechEnabled
                ? "bg-sky-500/20 text-sky-300 border border-sky-500/40 hover:bg-sky-500/30"
                : "bg-slate-800 text-slate-400 hover:bg-slate-700"
            }`}
          >
            {speechEnabled ? (
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
              </svg>
            ) : (
              <svg className="w-3.5 h-3.5 text-rose-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
              </svg>
            )}
          </button>

          {/* Trace Toggle */}
          <button
            type="button"
            onClick={() => setShowTraces(!showTraces)}
            aria-label="Toggle Debug Execution Traces"
            className="text-[11px] px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 focus:ring-2 focus:ring-sky-400"
          >
            {showTraces ? "Hide Traces" : "Traces"}
          </button>
        </div>
      </header>

      {/* ── Quick Voice Actions Toolbar ───────────────────────── */}
      <div className="px-4 py-2 bg-slate-900/50 border-b border-slate-800/80 flex items-center justify-between gap-2 flex-wrap text-xs">
        <div className="flex items-center gap-2 overflow-hidden text-ellipsis whitespace-nowrap max-w-[40%]">
          <span className="text-slate-400">Target:</span>
          <span className="font-semibold text-slate-200">
            {pageSummary?.title || "Desktop & Web Voice Control"}
          </span>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            type="button"
            onClick={() => handleQuickAction("open vs code")}
            className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-sky-300 font-medium transition"
          >
            Open VS Code
          </button>
          <button
            type="button"
            onClick={() => handleQuickAction("write code in vs code def hello_world(): print('Hello from VisionOS')")}
            className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-emerald-300 font-medium transition"
          >
            Write Code
          </button>
          <button
            type="button"
            onClick={() => handleQuickAction("search ashish chanchlani on youtube")}
            className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-red-300 font-medium transition"
          >
            Search YouTube
          </button>
          <button
            type="button"
            onClick={() => handleQuickAction("take screenshot")}
            className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 transition"
          >
            Screenshot
          </button>
          <button
            type="button"
            onClick={requestPageSummary}
            className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
          >
            Read Screen
          </button>
        </div>
      </div>

      {/* ── Main Chat & Task Area ───────────────────────────────── */}
      <main
        ref={chatScrollRef}
        className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar"
      >
        {messages.length === 0 && !currentPlan && (
          <div className="flex flex-col items-center justify-center h-full text-center p-6 text-slate-400 space-y-3">
            <div className={`w-14 h-14 rounded-full flex items-center justify-center transition-all ${
              isListening
                ? "bg-rose-500/20 text-rose-400 ring-4 ring-rose-500/40 animate-pulse"
                : "bg-sky-500/10 text-sky-400 shadow-[0_0_20px_rgba(56,189,248,0.2)]"
            }`}>
              <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
              </svg>
            </div>
            <h2 className="text-base font-bold text-slate-100">
              {isListening ? "Listening... Speak your goal now" : "VisionOS Voice Assistant is Ready"}
            </h2>
            <p className="text-xs max-w-md text-slate-400 leading-relaxed">
              Designed for visually impaired users. Click the mic or press <kbd className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-sky-300 font-mono">Alt+V</kbd> to speak any command: write code in VS Code, search YouTube/Google, launch applications, or navigate websites.
            </p>
          </div>
        )}

        {/* Message Log */}
        {messages.map((m) => (
          <div
            key={m.id}
            className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-xs leading-relaxed ${
                m.role === "user"
                  ? "bg-sky-600 text-white rounded-br-none shadow-md shadow-sky-900/20"
                  : m.role === "error"
                  ? "bg-rose-950/80 text-rose-200 border border-rose-700/80 rounded-bl-none font-mono"
                  : "bg-slate-800/90 text-slate-100 border border-slate-700/60 rounded-bl-none shadow"
              }`}
            >
              {m.text}
            </div>
          </div>
        ))}

        {/* Real-Time Live Speech Transcription Bubble */}
        {isListening && interimSpeech && (
          <div className="flex justify-end animate-pulse">
            <div className="max-w-[85%] rounded-2xl px-3.5 py-2 text-xs leading-relaxed bg-rose-600/40 text-rose-100 border border-rose-500/50 rounded-br-none flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-rose-400 animate-ping" />
              <span>{interimSpeech}</span>
            </div>
          </div>
        )}

        {/* Task Plan View */}
        <TaskPlanView plan={currentPlan} />
      </main>

      {/* ── Execution Trace Drawer ──────────────────────────────── */}
      {showTraces && (
        <aside
          role="region"
          aria-label="Debug Execution Traces"
          className="h-32 bg-black/80 border-t border-slate-800 p-2 overflow-y-auto text-[11px] font-mono text-slate-400"
        >
          <div className="font-bold text-slate-300 mb-1">Execution Traces:</div>
          {executionTraces.map((t, idx) => (
            <div
              key={idx}
              className={`py-0.5 ${
                t.level === "error"
                  ? "text-rose-400"
                  : t.level === "warn"
                  ? "text-amber-400"
                  : "text-slate-400"
              }`}
            >
              [{new Date(t.timestamp).toLocaleTimeString()}] {t.message}
            </div>
          ))}
        </aside>
      )}

      {/* ── Consequential Action Approval Modal ──────────────────── */}
      <ApprovalModal
        request={approvalRequest}
        onApprove={(id) => handleApproval(id, true)}
        onDecline={(id) => handleApproval(id, false)}
      />

      {/* ── Bottom Input Bar ────────────────────────────────────── */}
      <footer className="p-3 bg-slate-900/90 border-t border-slate-800">
        <form onSubmit={handleSubmit} className="flex items-center gap-2">
          {/* Emergency Cancel Button (Visible during execution) */}
          {agentStatus === "executing" || agentStatus === "waiting_approval" ? (
            <button
              type="button"
              onClick={cancelTask}
              className="px-3 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition flex items-center gap-1.5 shadow-lg shadow-rose-900/30"
              aria-label="Cancel Active Task"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
              Cancel
            </button>
          ) : null}

          {/* Voice Input Button */}
          <button
            type="button"
            onClick={() => {
              if (isListening) stopListening();
              else startListening();
            }}
            aria-label={isListening ? "Listening active. Click to stop." : "Start Voice Input (Alt+V)"}
            title={isListening ? "Listening... Click to stop" : "Speak to VisionOS (Alt+V)"}
            className={`p-2.5 rounded-xl border transition flex items-center justify-center relative ${
              isListening
                ? "bg-rose-600 text-white border-rose-400 shadow-[0_0_16px_#f43f5e] ring-2 ring-rose-400"
                : "bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700 focus:ring-2 focus:ring-sky-400"
            }`}
          >
            {isListening ? (
              <div className="flex items-center gap-1">
                <span className="w-1 h-3 bg-white rounded-full animate-bounce" />
                <span className="w-1 h-4 bg-white rounded-full animate-bounce [animation-delay:0.15s]" />
                <span className="w-1 h-2 bg-white rounded-full animate-bounce [animation-delay:0.3s]" />
              </div>
            ) : (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
              </svg>
            )}
          </button>

          {/* Natural Language Text Box */}
          <input
            ref={inputRef}
            type="text"
            value={inputVal}
            onChange={(e) => setInputVal(e.target.value)}
            placeholder={
              isListening
                ? "🎤 Listening to your voice... Speak now..."
                : "Speak or type your goal (e.g. 'write code in vs code', 'search youtube')..."
            }
            aria-label="Natural language goal input"
            className="flex-1 bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-400 focus:border-transparent transition"
          />

          {/* Send Button */}
          <button
            type="submit"
            disabled={!inputVal.trim() || !socketConnected}
            aria-label="Send goal to VisionOS"
            className="px-4 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 disabled:opacity-40 disabled:hover:bg-sky-500 text-slate-950 text-xs font-bold transition flex items-center gap-1.5 focus:ring-2 focus:ring-sky-300"
          >
            <span>Run</span>
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M14 5l7 7m0 0l-7 7m7-7H3" />
            </svg>
          </button>
        </form>
      </footer>
    </div>
  );
};
