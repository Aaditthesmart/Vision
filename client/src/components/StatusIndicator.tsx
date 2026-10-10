"use client";

import type { AgentState } from "@/lib/types";

const STATUS_CONFIG: Record<AgentState, { label: string; color: string }> = {
  idle: { label: "Ready", color: "text-gray-400" },
  listening: { label: "Listening...", color: "text-green-400" },
  thinking: { label: "Thinking...", color: "text-yellow-400" },
  speaking: { label: "Speaking...", color: "text-blue-400" },
};

interface StatusIndicatorProps {
  state: AgentState;
  isConnected: boolean;
}

export function StatusIndicator({ state, isConnected }: StatusIndicatorProps) {
  if (!isConnected) {
    return (
      <div className="flex items-center gap-2 text-sm text-red-400">
        <div className="w-2 h-2 rounded-full bg-red-400" />
        Disconnected
      </div>
    );
  }

  const { label, color } = STATUS_CONFIG[state];

  return (
    <div className={`flex items-center gap-2 text-sm ${color}`}>
      <div
        className={`w-2 h-2 rounded-full ${
          state === "idle" ? "bg-gray-400" : "bg-current animate-pulse"
        }`}
      />
      {label}
    </div>
  );
}
