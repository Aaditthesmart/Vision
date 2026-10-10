import { ChatOpenAI } from "@langchain/openai";
import { ToolMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { createBrowserTools, createKnowledgeTools, createSearchTools } from "./tools.js";
import type {
  ConversationTurn,
  UserProfile,
  PageSnapshot,
  ExecutionContext,
  InterimSpeechCallback,
  KnowledgeBase,
} from "../types/index.js";

const MAX_TOOL_STEPS = 10;

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((b: Record<string, unknown>) => b.type === "text")
      .map((b: Record<string, unknown>) => b.text as string)
      .join("");
  }
  return String(content);
}

function buildSystemPrompt(
  profile: UserProfile | null,
  page: PageSnapshot | null,
  memoryContext?: string,
): string {
  let prompt = `You are a web navigation assistant for a blind user who interacts entirely by voice.
You control a real browser. Use your tools to navigate, read pages, and interact with content.

CAPABILITIES:
- Navigate to any website
- Read articles and summarize content
- Describe page layouts SPATIALLY (not sequentially)
- Fill out forms, click links, scroll through pages
- Search the web and present results

SPATIAL DESCRIPTION RULES:
- Describe layouts as physical spaces: "At the top is the navigation bar. The main content is centered. There's a sidebar on the right."
- For grids/lists: "From left to right: ..." or "From top to bottom: ..."
- Mention interactive elements: "There's a clickable button labeled..."
- NEVER read raw HTML or list DOM elements sequentially.

SEARCH STRATEGY:
- Use web_search for factual questions, news, "what is...", "how to...", current events, or any query that needs up-to-date information. It's much faster than navigating to Google manually.
- Use browser navigation (navigate_to_url, click_element) when the user wants to visit a SPECIFIC website, interact with a page, fill out forms, or read a particular article.

VOICE RULES:
- Speak naturally and concisely — 2-3 sentences unless asked for detail.
- Lead with the most important information.
- After describing content, ask what the user wants to do next.
- For articles: give a 2-3 sentence summary first, then offer to read more.
- No markdown, no URLs, no bullet points.`;

  if (profile) {
    prompt += `\n\nUser: ${profile.name}.`;
  }
  if (page) {
    prompt += `\nCurrently viewing: ${page.title} (${page.url})`;
  }
  if (memoryContext) {
    prompt += `\n\nRELEVANT MEMORY FROM PREVIOUS INTERACTIONS:\n${memoryContext}`;
  }

  return prompt;
}

function getGeneralInterimPhrase(toolName: string, args: Record<string, unknown>): string {
  switch (toolName) {
    case "navigate_to_url": {
      const url = String(args.url ?? "");
      if (url.includes("google")) return "Searching the web.";
      return "Opening the page.";
    }
    case "click_element": {
      const instr = String(args.instruction ?? "").toLowerCase();
      if (instr.includes("search") || instr.includes("type")) return "Searching now.";
      if (instr.includes("scroll")) return "Scrolling through the page.";
      return "Working on that.";
    }
    case "extract_data":
      return "Reading the page content.";
    case "observe_page":
      return "Scanning the page layout.";
    case "web_search":
      return "Searching the web.";
    default:
      return "Working on that.";
  }
}

/**
 * Creates a general agent node function that uses browser tools via ReAct loop.
 * If no executionContext, falls back to text-only generation.
 */
export function createGeneralAgent(
  executionContext: ExecutionContext | null,
  kb: KnowledgeBase | null = null,
) {
  const agentModel = new ChatOpenAI({
    model: "gpt-4.1",
    temperature: 0.3,
    maxTokens: 1024,
  });

  return async function generalAgent(state: {
    userInput: string;
    conversationHistory: ConversationTurn[];
    userProfile: UserProfile | null;
    pageSnapshot: PageSnapshot | null;
    memoryContext?: string;
  }, interimSpeech?: InterimSpeechCallback, abortSignal?: AbortSignal, sessionId?: string, memoryContext?: string): Promise<{ responseText: string }> {
    const systemPrompt = buildSystemPrompt(state.userProfile, state.pageSnapshot, memoryContext || state.memoryContext);

    const history: BaseMessage[] = state.conversationHistory
      .slice(-6)
      .map((t: ConversationTurn) => ({
        role: t.role as "user" | "assistant",
        content: t.text,
      })) as unknown as BaseMessage[];

    // No browser available — fallback to text-only
    if (!executionContext) {
      const response = await agentModel.invoke([
        { role: "system", content: systemPrompt },
        ...history,
        { role: "user", content: state.userInput },
      ]);
      return { responseText: extractText(response.content) };
    }

    // Full ReAct loop with browser tools + knowledge tools + web search
    const browserTools = createBrowserTools(executionContext);
    const knowledgeTools = createKnowledgeTools(kb, sessionId);
    const searchTools = createSearchTools();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tools: DynamicStructuredTool<any>[] = [...searchTools, ...browserTools, ...knowledgeTools];
    const modelWithTools = agentModel.bindTools(tools);

    const messages: BaseMessage[] = [
      { role: "system", content: systemPrompt } as unknown as BaseMessage,
      ...history,
      { role: "user", content: state.userInput } as unknown as BaseMessage,
    ];

    for (let i = 0; i < MAX_TOOL_STEPS; i++) {
      if (abortSignal?.aborted) {
        console.log("[general] aborted before iteration", i);
        return { responseText: "" };
      }

      const response = await modelWithTools.invoke(messages);
      messages.push(response);

      // No tool calls — agent is done reasoning
      if (!response.tool_calls?.length) {
        return { responseText: extractText(response.content) };
      }

      // Execute each tool call
      for (const toolCall of response.tool_calls) {
        if (abortSignal?.aborted) {
          console.log("[general] aborted before tool call:", toolCall.name);
          return { responseText: "" };
        }

        const toolFn = tools.find((t) => t.name === toolCall.name);
        if (!toolFn) {
          messages.push(
            new ToolMessage({
              content: JSON.stringify({ error: `Unknown tool: ${toolCall.name}` }),
              tool_call_id: toolCall.id ?? "",
            }),
          );
          continue;
        }

        // Emit interim speech before tool execution (fire-and-forget)
        if (interimSpeech) {
          const phrase = getGeneralInterimPhrase(toolCall.name, toolCall.args as Record<string, unknown>);
          interimSpeech(phrase);
        }

        try {
          const result = await toolFn.invoke(toolCall.args);
          const resultStr = typeof result === "string" ? result : JSON.stringify(result);
          messages.push(
            new ToolMessage({
              content: resultStr,
              tool_call_id: toolCall.id ?? "",
            }),
          );

          // Auto-index to knowledge base (fire-and-forget)
          if (kb && sessionId) {
            const ts = new Date().toISOString();
            if (toolCall.name === "navigate_to_url") {
              try {
                const parsed = JSON.parse(resultStr);
                if (parsed.success) {
                  kb.indexPageVisit({
                    url: parsed.finalUrl || (toolCall.args as Record<string, unknown>).url as string,
                    title: parsed.pageTitle || "",
                    content: parsed.pageTitle || "",
                    sessionId,
                    userQuery: state.userInput,
                    agentCategory: "general",
                    timestamp: ts,
                  }).catch(() => {});
                }
              } catch { /* parse failed */ }
            } else if (toolCall.name === "extract_data") {
              try {
                const parsed = JSON.parse(resultStr);
                if (parsed.success && parsed.data) {
                  kb.indexPageVisit({
                    url: "",
                    title: "",
                    content: JSON.stringify(parsed.data).slice(0, 5000),
                    sessionId,
                    userQuery: state.userInput,
                    agentCategory: "general",
                    timestamp: ts,
                  }).catch(() => {});
                }
              } catch { /* parse failed */ }
            }
          }
        } catch (err) {
          messages.push(
            new ToolMessage({
              content: JSON.stringify({
                error: err instanceof Error ? err.message : String(err),
              }),
              tool_call_id: toolCall.id ?? "",
            }),
          );
        }

        console.log(
          `[general] tool: ${toolCall.name}(${JSON.stringify(toolCall.args).slice(0, 80)})`,
        );
      }
    }

    return {
      responseText:
        "I had trouble with that. Could you try again or ask something different?",
    };
  };
}
