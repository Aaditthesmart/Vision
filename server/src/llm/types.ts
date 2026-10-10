export interface Message {
  role: "user" | "assistant";
  content: string;
}

export interface LLMProvider {
  streamResponse(
    messages: Message[],
    systemPrompt: string,
    abortSignal?: AbortSignal
  ): AsyncIterable<string>;
}
