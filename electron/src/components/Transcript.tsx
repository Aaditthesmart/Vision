import { useEffect, useRef } from "react";
import type { TranscriptEntry } from "@/lib/types";

interface TranscriptProps {
  entries: TranscriptEntry[];
  streamingText: string;
}

export function Transcript({ entries, streamingText }: TranscriptProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [entries, streamingText]);

  if (entries.length === 0 && !streamingText) {
    return (
      <div className="flex-1 flex items-center justify-center text-white text-base font-medium px-8 text-center">
        🎤 Click the mic button below to start talking
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-6 space-y-4 custom-scrollbar">
      {entries.map((entry) => (
        <div
          key={entry.id}
          className={`flex ${
            entry.role === "user" ? "justify-end" : "justify-start"
          }`}
        >
          <div
            className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
              entry.role === "user"
                ? "bg-blue-600/20 text-blue-100 border border-blue-500/20"
                : "bg-gray-800/60 text-gray-100 border border-gray-700/30"
            }`}
          >
            {entry.text}
          </div>
        </div>
      ))}

      {/* Streaming assistant text */}
      {streamingText && (
        <div className="flex justify-start">
          <div className="max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed bg-gray-800/60 text-gray-100 border border-gray-700/30">
            {streamingText}
            <span className="inline-block w-1 h-4 ml-1 bg-gray-400 animate-pulse align-text-bottom" />
          </div>
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
}
