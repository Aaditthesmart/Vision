export type AgentState = "idle" | "listening" | "thinking" | "speaking";

export interface TranscriptEntry {
  id: string;
  role: "user" | "assistant" | "console";
  text: string;
  timestamp: number;
}
