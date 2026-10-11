export interface OllamaChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
  images?: string[]; // base64-encoded strings for multimodal reasoning
}

export interface OllamaChatResponse {
  model: string;
  message: {
    role: string;
    content: string;
  };
  done: boolean;
  total_duration?: number;
  eval_count?: number;
}

export class OllamaClient {
  private baseUrl: string;
  private defaultModel: string;

  constructor(
    baseUrl = process.env.OLLAMA_HOST || "http://127.0.0.1:11434",
    defaultModel = process.env.GEMMA_MODEL || "gemma4:latest",
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.defaultModel = defaultModel;
  }

  public getModelName(): string {
    return this.defaultModel;
  }

  public setModelName(name: string): void {
    this.defaultModel = name;
  }

  public async checkConnection(): Promise<{
    connected: boolean;
    models: string[];
    selectedModel: string;
    error?: string;
  }> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3000);
      const res = await fetch(`${this.baseUrl}/api/tags`, {
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!res.ok) {
        return {
          connected: false,
          models: [],
          selectedModel: this.defaultModel,
          error: `Ollama returned HTTP ${res.status}: ${res.statusText}`,
        };
      }

      const data = (await res.json()) as { models?: { name: string }[] };
      const models = (data.models || []).map((m) => m.name);

      // Verify if default model or a variant is present
      let selected = this.defaultModel;
      const exactMatch = models.find((m) => m === this.defaultModel || m.startsWith(this.defaultModel));
      if (exactMatch) {
        selected = exactMatch;
      } else {
        // Auto-select best available local model (gemma4, gemma2, gemma, or first available)
        const gemmaMatch = models.find((m) => m.toLowerCase().includes("gemma"));
        if (gemmaMatch) {
          selected = gemmaMatch;
        } else if (models.length > 0) {
          selected = models[0];
        }
      }
      this.defaultModel = selected;

      return {
        connected: true,
        models,
        selectedModel: selected,
      };
    } catch (err) {
      return {
        connected: false,
        models: [],
        selectedModel: this.defaultModel,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  public async chat(options: {
    messages: OllamaChatMessage[];
    model?: string;
    jsonMode?: boolean;
    temperature?: number;
    timeoutMs?: number;
  }): Promise<{ content: string; raw: OllamaChatResponse }> {
    let model = options.model || this.defaultModel;
    const timeoutMs = options.timeoutMs || parseInt(process.env.OLLAMA_TIMEOUT_MS || "45000", 10);

    // If default model wasn't verified yet, check connection to get active model
    try {
      const conn = await this.checkConnection();
      if (conn.connected && conn.selectedModel) {
        model = options.model || conn.selectedModel;
      }
    } catch {
      // Use fallback model
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          model,
          messages: options.messages,
          stream: false,
          format: options.jsonMode ? "json" : undefined,
          options: {
            temperature: options.temperature ?? 0.1,
          },
        }),
      });
      clearTimeout(timer);

      if (!res.ok) {
        const errorText = await res.text();
        // Gracefully handle "model output must contain either output text or tool calls"
        // This is an Ollama/model error meaning the model returned an empty completion.
        // Rather than crashing, we return empty content so callers use their fallback paths.
        const isEmptyOutputError =
          errorText.includes("model output must contain either output text") ||
          errorText.includes("empty") ||
          res.status === 400;
        if (isEmptyOutputError) {
          console.warn(`[OllamaClient] Model '${model}' returned empty output — using fallback. (HTTP ${res.status})`);
          return { content: "", raw: { model, message: { role: "assistant", content: "" }, done: true } };
        }
        throw new Error(`Ollama API error ${res.status}: ${errorText}`);
      }

      const data = (await res.json()) as OllamaChatResponse;
      // Guard: if model content is empty, return empty string (callers have deterministic fallbacks)
      const content = data.message?.content?.trim() || "";
      if (!content) {
        console.warn(`[OllamaClient] Model '${model}' returned empty content — using fallback.`);
      }
      return { content, raw: data };
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof Error && err.name === "AbortError") {
        console.warn(`[OllamaClient] Request timed out after ${timeoutMs}ms — using deterministic fallback.`);
        return { content: "", raw: { model, message: { role: "assistant", content: "" }, done: false } };
      }
      throw err;
    }
  }
}

export const ollamaClient = new OllamaClient();
