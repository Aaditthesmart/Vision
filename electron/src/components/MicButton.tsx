import { Mic, MicOff } from "lucide-react";

interface MicButtonProps {
  isListening: boolean;
  onClick: () => void;
  disabled?: boolean;
}

export function MicButton({ isListening, onClick, disabled }: MicButtonProps) {
  return (
    <div className="relative flex items-center justify-center">
      {/* Pulse ring when listening */}
      {isListening && (
        <div className="absolute w-24 h-24 rounded-full bg-red-500/30 animate-pulse-ring" />
      )}

      <button
        onClick={onClick}
        disabled={disabled}
        className={`relative z-10 w-20 h-20 rounded-full flex items-center justify-center transition-all duration-200 ${
          isListening
            ? "bg-red-500 hover:bg-red-600 shadow-lg shadow-red-500/25"
            : "bg-gray-700 hover:bg-gray-600 shadow-lg shadow-gray-900/50"
        } ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
      >
        {isListening ? (
          <MicOff className="w-8 h-8 text-white" />
        ) : (
          <Mic className="w-8 h-8 text-white" />
        )}
      </button>
    </div>
  );
}
