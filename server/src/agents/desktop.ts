import Anthropic from "@anthropic-ai/sdk";
import {
  createMacOSControl,
  type ComputerControl,
} from "../lib/computerControl.js";
import type {
  ConversationTurn,
  UserProfile,
  PageSnapshot,
  InterimSpeechCallback,
} from "../types/index.js";

const MAX_ITERATIONS = 15;

function extractText(content: Anthropic.Beta.BetaContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

const DESKTOP_SYSTEM_PROMPT = `You are a desktop control assistant for a blind user who interacts entirely by voice.
You can see the screen and control the computer using mouse clicks, keyboard input, and scrolling.

CAPABILITIES:
- Open and switch between applications (Finder, Safari, VS Code, Terminal, Spotify, etc.)
- Click buttons, menus, and UI elements
- Type text into any application
- Use keyboard shortcuts (Cmd+C, Cmd+V, Cmd+Tab, etc.)
- Scroll through content
- Navigate file systems and manage files

RULES:
- ALWAYS take a screenshot first to see what's on screen before acting.
- SCOPE: Only perform exactly what the user asks — nothing more. If asked to "open Visual Studio Code", open it and stop. Do NOT create files, type code, click around inside the app, or take ANY actions beyond the specific request. Once the task is complete, immediately respond with a summary.
- CRITICAL: To open or switch to ANY application, you MUST use Spotlight EVERY TIME: press Cmd+Space, type the app name, press Enter. Do this even if the app appears to already be on screen. VS Code and Cursor are visually identical — you CANNOT tell them apart by looking. The ONLY reliable way is Spotlight.
- Describe what you see and what you're doing in plain spoken English.
- Be concise — 1-2 sentences per action unless the user asks for detail.
- No markdown, no bullet points. Speak naturally as if guiding a blind user.
- When you finish the task, summarize what you did clearly.
- If something fails or you can't find what you're looking for, say so honestly.`;

const CODING_DESKTOP_PROMPT = `You are a coding assistant that controls the desktop for a blind developer.
You can see the screen and control VS Code, Terminal, and other development tools.

CAPABILITIES:
- Open and navigate VS Code files and folders
- Read code on screen and describe it
- Type and edit code
- Run terminal commands
- Debug errors by reading output
- Use keyboard shortcuts for efficient navigation

RULES:
- ALWAYS take a screenshot first to see what's on screen.
- SCOPE: Only perform exactly what the user asks — nothing more. If asked to open an app, just open it and stop. Do NOT take extra actions beyond the request.
- CRITICAL: To open or switch to ANY application, you MUST use Spotlight EVERY TIME: press Cmd+Space, type the app name, press Enter. Do this even if the app appears to already be on screen. VS Code and Cursor are visually identical — you CANNOT tell them apart by looking. The ONLY reliable way is Spotlight.
- Describe code locations conversationally: "on line twelve" not "line 12".
- Explain errors simply and suggest fixes.
- Be concise — 1-2 sentences per action.
- No markdown, no code blocks. Speak naturally.
- When reading code, summarize what it does rather than reading it verbatim.`;

function getInterimPhrase(action: string): string | null {
  switch (action) {
    case "screenshot":
      return "Taking a screenshot.";
    case "left_click":
    case "right_click":
    case "double_click":
    case "middle_click":
      return "Clicking on that.";
    case "type":
      return "Typing now.";
    case "key":
      return "Pressing that shortcut.";
    case "scroll":
      return "Scrolling.";
    case "mouse_move":
      return null; // Silent
    default:
      return "Working on that.";
  }
}

function isCodingIntent(subIntent: string): boolean {
  const codingPatterns = [
    "code",
    "coding",
    "debug",
    "terminal",
    "vscode",
    "vs_code",
    "ide",
    "compile",
    "build",
    "run_code",
    "fix_bug",
    "programming",
  ];
  const lower = subIntent.toLowerCase();
  return codingPatterns.some((p) => lower.includes(p));
}

/**
 * Creates a desktop agent that uses Anthropic's computer-use beta API
 * to control the macOS desktop via screenshot + mouse/keyboard actions.
 */
export function createDesktopAgent() {
  const anthropic = new Anthropic();
  const computerControl: ComputerControl = createMacOSControl();

  return async function desktopAgent(
    state: {
      userInput: string;
      conversationHistory: ConversationTurn[];
      classification: { subIntent: string } | null;
      userProfile: UserProfile | null;
      pageSnapshot: PageSnapshot | null;
    },
    interimSpeech?: InterimSpeechCallback,
    abortSignal?: AbortSignal,
  ): Promise<{ responseText: string }> {
    const subIntent = state.classification?.subIntent ?? "";
    const systemPrompt = isCodingIntent(subIntent)
      ? CODING_DESKTOP_PROMPT
      : DESKTOP_SYSTEM_PROMPT;

    const displaySize = computerControl.getDisplaySize();
    const scaleW = 1280 / displaySize.width;
    const scaleH = 800 / displaySize.height;
    const scale = Math.min(scaleW, scaleH, 1);
    const apiWidth = Math.round(displaySize.width * scale);
    const apiHeight = Math.round(displaySize.height * scale);

    // Build conversation history for context
    const historyMessages: Anthropic.Beta.BetaMessageParam[] =
      state.conversationHistory.slice(-6).map((t: ConversationTurn) => ({
        role: t.role as "user" | "assistant",
        content: t.text,
      }));

    const messages: Anthropic.Beta.BetaMessageParam[] = [
      ...historyMessages,
      { role: "user", content: state.userInput },
    ];

    const tools: Anthropic.Beta.BetaToolUnion[] = [
      {
        type: "computer_20250124",
        name: "computer",
        display_width_px: apiWidth,
        display_height_px: apiHeight,
      },
    ];

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      if (abortSignal?.aborted) {
        console.log("[desktop] aborted before iteration", i);
        return { responseText: "" };
      }

      let response: Anthropic.Beta.BetaMessage;
      try {
        response = await anthropic.beta.messages.create({
          model: "claude-sonnet-4-5-20250929",
          max_tokens: 1024,
          system: systemPrompt,
          tools,
          messages,
          betas: ["computer-use-2025-01-24"],
        });
      } catch (err) {
        console.error("[desktop] API error:", err);
        return {
          responseText:
            "I had trouble connecting to the desktop control service. Please try again.",
        };
      }

      // Add assistant response to message history
      messages.push({ role: "assistant", content: response.content });

      // Check if there are any tool_use blocks
      const toolUseBlocks = response.content.filter(
        (b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use",
      );

      // No tool calls — agent is done
      if (toolUseBlocks.length === 0) {
        const text = extractText(response.content);
        return { responseText: text || "Done." };
      }

      // Process each tool use
      const toolResults: Anthropic.Beta.BetaToolResultBlockParam[] = [];

      for (const toolUse of toolUseBlocks) {
        if (abortSignal?.aborted) {
          console.log("[desktop] aborted before tool execution");
          return { responseText: "" };
        }

        const input = toolUse.input as Record<string, unknown>;
        const action = input.action as string;

        console.log(
          `[desktop] tool: ${toolUse.name} action=${action} ` +
            JSON.stringify(input).slice(0, 100),
        );

        // Emit interim speech
        if (interimSpeech) {
          const phrase = getInterimPhrase(action);
          if (phrase) interimSpeech(phrase);
        }

        try {
          const result = await executeComputerAction(
            computerControl,
            input,
          );
          toolResults.push({
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: result,
          });
        } catch (err) {
          const errMsg =
            err instanceof Error ? err.message : String(err);
          console.error(`[desktop] action error (${action}):`, errMsg);
          toolResults.push({
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: [
              {
                type: "text",
                text: `Error: ${errMsg}. This may be a permissions issue — macOS Accessibility or Screen Recording permission may not be granted.`,
              },
            ],
            is_error: true,
          });
        }
      }

      // Send tool results back
      messages.push({ role: "user", content: toolResults });
    }

    return {
      responseText:
        "I took many steps but couldn't finish the task. Could you try again with a simpler request?",
    };
  };
}

// ── Action Executor ──────────────────────────────────────────

async function executeComputerAction(
  control: ComputerControl,
  input: Record<string, unknown>,
): Promise<Anthropic.Beta.BetaToolResultBlockParam["content"]> {
  const action = input.action as string;
  const coordinate = input.coordinate as [number, number] | undefined;

  switch (action) {
    case "screenshot": {
      const base64 = await control.screenshot();
      return [
        {
          type: "image",
          source: {
            type: "base64",
            media_type: "image/png",
            data: base64,
          },
        },
      ];
    }

    case "left_click": {
      if (!coordinate) throw new Error("left_click requires coordinate");
      await control.leftClick(coordinate[0], coordinate[1]);
      return [{ type: "text", text: "Clicked." }];
    }

    case "right_click": {
      if (!coordinate) throw new Error("right_click requires coordinate");
      await control.rightClick(coordinate[0], coordinate[1]);
      return [{ type: "text", text: "Right-clicked." }];
    }

    case "double_click": {
      if (!coordinate)
        throw new Error("double_click requires coordinate");
      await control.doubleClick(coordinate[0], coordinate[1]);
      return [{ type: "text", text: "Double-clicked." }];
    }

    case "middle_click": {
      // Fallback to left click for middle click
      if (!coordinate)
        throw new Error("middle_click requires coordinate");
      await control.leftClick(coordinate[0], coordinate[1]);
      return [{ type: "text", text: "Clicked." }];
    }

    case "mouse_move": {
      if (!coordinate) throw new Error("mouse_move requires coordinate");
      await control.mouseMove(coordinate[0], coordinate[1]);
      return [{ type: "text", text: "Moved cursor." }];
    }

    case "type": {
      const text = input.text as string;
      if (!text) throw new Error("type requires text");
      await control.type(text);
      return [{ type: "text", text: "Typed." }];
    }

    case "key": {
      const key = input.text as string;
      if (!key) throw new Error("key requires text");
      await control.key(key);
      return [{ type: "text", text: `Pressed ${key}.` }];
    }

    case "scroll": {
      const scrollCoord = coordinate ?? [640, 400];
      const direction = (input.direction as string) ?? "down";
      const amount = (input.amount as number) ?? 3;
      await control.scroll(
        scrollCoord[0],
        scrollCoord[1],
        direction,
        amount,
      );
      return [{ type: "text", text: `Scrolled ${direction}.` }];
    }

    case "left_click_drag": {
      // Click at start, move to end coordinate
      if (!coordinate)
        throw new Error("left_click_drag requires coordinate");
      const endCoord = input.end_coordinate as
        | [number, number]
        | undefined;
      if (!endCoord)
        throw new Error("left_click_drag requires end_coordinate");
      await control.leftClick(coordinate[0], coordinate[1]);
      await control.mouseMove(endCoord[0], endCoord[1]);
      return [{ type: "text", text: "Dragged." }];
    }

    case "wait": {
      const duration = (input.duration as number) ?? 1;
      await new Promise((resolve) =>
        setTimeout(resolve, duration * 1000),
      );
      return [{ type: "text", text: "Waited." }];
    }

    default:
      return [
        { type: "text", text: `Unknown action: ${action}` },
      ];
  }
}
