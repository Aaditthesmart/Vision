import OpenAI from "openai";
import type { LLMProvider, Message } from "./types.js";

export class OpenAIProvider implements LLMProvider {
  private client: OpenAI;
  private model = "gpt-4.1-mini";

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  async *streamResponse(
    messages: Message[],
    systemPrompt: string,
    abortSignal?: AbortSignal,
  ): AsyncIterable<string> {
    const stream = await this.client.chat.completions.create({
      model: this.model,
      max_tokens: 1024,
      stream: true,
      messages: [
        { role: "system", content: systemPrompt },
        ...messages.map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        })),
      ],
    });

    for await (const chunk of stream) {
      if (abortSignal?.aborted) break;
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) {
        yield delta;
      }
    }
  }
}
