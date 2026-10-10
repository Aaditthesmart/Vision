import { GoogleGenAI } from "@google/genai";
import type { LLMProvider, Message } from "./types.js";

export class GeminiProvider implements LLMProvider {
  private client: GoogleGenAI;
  private model = "gemini-2.5-flash";

  constructor(apiKey: string) {
    this.client = new GoogleGenAI({ apiKey });
  }

  async *streamResponse(
    messages: Message[],
    systemPrompt: string,
    abortSignal?: AbortSignal
  ): AsyncIterable<string> {
    const contents = messages.map((m) => ({
      role: m.role === "assistant" ? ("model" as const) : ("user" as const),
      parts: [{ text: m.content }],
    }));

    const response = await this.client.models.generateContentStream({
      model: this.model,
      contents,
      config: {
        systemInstruction: systemPrompt,
        temperature: 0.7,
        maxOutputTokens: 1024,
      },
    });

    for await (const chunk of response) {
      if (abortSignal?.aborted) break;
      const text = chunk.text;
      if (text) {
        yield text;
      }
    }
  }
}
