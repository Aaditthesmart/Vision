import Anthropic from "@anthropic-ai/sdk";
import type { LLMProvider, Message } from "./types.js";

export class AnthropicProvider implements LLMProvider {
  private client: Anthropic;
  private model = "claude-3-haiku-20240307";

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async *streamResponse(
    messages: Message[],
    systemPrompt: string,
    abortSignal?: AbortSignal
  ): AsyncIterable<string> {
    const stream = this.client.messages.stream({
      model: this.model,
      max_tokens: 1024,
      system: systemPrompt,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    });

    for await (const event of stream) {
      if (abortSignal?.aborted) break;
      if (
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta"
      ) {
        yield event.delta.text;
      }
    }
  }
}
