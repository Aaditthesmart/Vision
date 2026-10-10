import type { LLMProvider } from "./types.js";
import { GeminiProvider } from "./gemini.js";
import { OpenAIProvider } from "./openai.js";

export function getLLMProvider(): LLMProvider {
  const provider = process.env.LLM_PROVIDER || "gemini";

  switch (provider) {
    case "gemini": {
      const key = process.env.GEMINI_API_KEY;
      if (!key) throw new Error("GEMINI_API_KEY not set");
      return new GeminiProvider(key);
    }
    case "openai": {
      const key = process.env.OPENAI_API_KEY;
      if (!key) throw new Error("OPENAI_API_KEY not set");
      return new OpenAIProvider(key);
    }
    default:
      throw new Error(`Unknown LLM provider: ${provider}`);
  }
}

export type { LLMProvider, Message } from "./types.js";
