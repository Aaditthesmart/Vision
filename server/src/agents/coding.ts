import { ChatOpenAI } from "@langchain/openai";
import { ToolMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { createCodingTools, createSearchTools } from "./tools.js";
import type {
  ConversationTurn,
  UserProfile,
  PageSnapshot,
  InterimSpeechCallback,
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

function buildCodingSystemPrompt(memoryContext?: string): string {
  let prompt = `You are a coding assistant for a blind developer who interacts entirely by voice.
You have full access to the project's files and can run shell commands.

CAPABILITIES:
- Read, write, and edit files in the project
- Run shell commands (tests, builds, git, linters, etc.)
- Search the codebase for patterns and symbols
- List directory contents and explore project structure
- Search the web for documentation and error solutions

WORKFLOW:
- ALWAYS read a file before editing it, so you have the exact text to match
- After making edits, run relevant tests or checks to verify
- When debugging, read the error message, find the relevant file, and suggest or apply a fix

VOICE RULES:
- Describe code locations conversationally: "on line twelve" not "line 12"
- Spell out symbols when describing code: "equals sign" not "=", "open paren" not "("
- Explain errors simply: "there's a missing closing bracket" not "SyntaxError: unexpected EOF"
- Describe file paths naturally: "in the utils file" or "in the agents folder" not "src/utils.ts"
- No markdown, no code blocks, no backticks. Speak naturally.
- Keep responses under 3 sentences unless the user asks for detail.
- When reading code aloud, describe what it does rather than reading syntax literally.`;

  if (memoryContext) {
    prompt += `\n\nRELEVANT MEMORY FROM PREVIOUS INTERACTIONS:\n${memoryContext}`;
  }

  return prompt;
}

function getCodingInterimPhrase(toolName: string, args: Record<string, unknown>): string {
  switch (toolName) {
    case "read_file":
      return "Reading the file.";
    case "write_file":
      return "Writing the file.";
    case "edit_file":
      return "Making the edit.";
    case "run_command": {
      const cmd = String(args.command ?? "").toLowerCase();
      if (cmd.includes("test") || cmd.includes("jest") || cmd.includes("vitest") || cmd.includes("pytest")) return "Running the tests.";
      if (cmd.includes("build") || cmd.includes("tsc") || cmd.includes("compile")) return "Building the project.";
      if (cmd.includes("git")) return "Running git.";
      if (cmd.includes("lint") || cmd.includes("eslint")) return "Running the linter.";
      if (cmd.includes("install") || cmd.includes("npm") || cmd.includes("yarn") || cmd.includes("pnpm")) return "Installing dependencies.";
      return "Running the command.";
    }
    case "list_directory":
      return "Listing the directory.";
    case "search_code":
      return "Searching the codebase.";
    case "web_search":
      return "Searching the web.";
    default:
      return "Working on that.";
  }
}

/**
 * Creates a coding agent node function that uses file/shell tools via ReAct loop.
 */
export function createCodingAgent(workspacePath: string) {
  const agentModel = new ChatOpenAI({
    model: "gpt-4.1",
    temperature: 0.3,
    maxTokens: 1024,
  });

  return async function codingAgent(state: {
    userInput: string;
    conversationHistory: ConversationTurn[];
    userProfile: UserProfile | null;
    pageSnapshot: PageSnapshot | null;
    memoryContext?: string;
  }, interimSpeech?: InterimSpeechCallback, abortSignal?: AbortSignal, _sessionId?: string, memoryContext?: string): Promise<{ responseText: string }> {
    const systemPrompt = buildCodingSystemPrompt(memoryContext || state.memoryContext);

    const history: BaseMessage[] = state.conversationHistory
      .slice(-6)
      .map((t: ConversationTurn) => ({
        role: t.role as "user" | "assistant",
        content: t.text,
      })) as unknown as BaseMessage[];

    // Full ReAct loop with coding tools + web search
    const codingTools = createCodingTools(workspacePath);
    const searchTools = createSearchTools();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tools: DynamicStructuredTool<any>[] = [...codingTools, ...searchTools];
    const modelWithTools = agentModel.bindTools(tools);

    const messages: BaseMessage[] = [
      { role: "system", content: systemPrompt } as unknown as BaseMessage,
      ...history,
      { role: "user", content: state.userInput } as unknown as BaseMessage,
    ];

    for (let i = 0; i < MAX_TOOL_STEPS; i++) {
      if (abortSignal?.aborted) {
        console.log("[coding] aborted before iteration", i);
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
          console.log("[coding] aborted before tool call:", toolCall.name);
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
          const phrase = getCodingInterimPhrase(toolCall.name, toolCall.args as Record<string, unknown>);
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
          `[coding] tool: ${toolCall.name}(${JSON.stringify(toolCall.args).slice(0, 80)})`,
        );
      }
    }

    return {
      responseText:
        "I had trouble completing that coding task. Could you try again or be more specific?",
    };
  };
}
