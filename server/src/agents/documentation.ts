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

const MAX_ITERATIONS = 10;

function extractText(content: Anthropic.Beta.BetaContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

const DOCUMENTATION_SYSTEM_PROMPT = `You are a documentation assistant that creates notes in Apple Notes for a blind user who interacts by voice.
You control the macOS desktop via screenshot + mouse/keyboard actions.

YOUR EXACT WORKFLOW — follow these steps in order, issuing MULTIPLE tool calls per response:

STEP 1 (first response): Take a screenshot to see what's on screen.

STEP 2 (second response, after seeing screenshot):
  If Notes is ALREADY in the foreground → issue these tool calls together in ONE response:
    - key Cmd+N
    - type the full note content
    - screenshot (to confirm)
  If Notes is NOT in the foreground → issue these tool calls together in ONE response:
    - key Cmd+Space
    - type "Notes"
    - key Return
    - wait 1.5 seconds

STEP 3 (only if you opened Spotlight in step 2): Take a screenshot to verify Notes opened, then in the SAME response also:
    - key Cmd+N
    - type the full note content

STEP 4: Take a final screenshot to confirm the note was created, then respond with a summary.

CRITICAL SPEED RULES:
- Issue MULTIPLE tool calls in a SINGLE response whenever possible. Batch actions together.
- The Spotlight sequence (Cmd+Space → type "Notes" → Return) MUST be in ONE response with NO screenshots between them.
- Cmd+N and typing MUST be in ONE response with NO screenshots between them.
- MAXIMUM 4 responses total. Most tasks should complete in 3 responses.
- NEVER take a screenshot between consecutive keyboard actions.
- Type ALL content in one single type action — never split into multiple type calls.

COMMUNICATION:
- Be concise — 1-2 sentences when done.
- No markdown, no bullet points. Speak naturally.
- When finished, say what you wrote and confirm it's saved.`;

/**
 * Creates a documentation agent that uses Anthropic's computer-use beta API
 * to open Apple Notes and create notes via Spotlight + keyboard shortcuts.
 */
export function createDocumentationAgent() {
  const anthropic = new Anthropic();
  const computerControl: ComputerControl = createMacOSControl();

  return async function documentationAgent(
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
    const displaySize = computerControl.getDisplaySize();
    const scaleW = 1280 / displaySize.width;
    const scaleH = 800 / displaySize.height;
    const scale = Math.min(scaleW, scaleH, 1);
    const apiWidth = Math.round(displaySize.width * scale);
    const apiHeight = Math.round(displaySize.height * scale);

    // Build conversation history for context (fewer than desktop — 4 turns)
    const historyMessages: Anthropic.Beta.BetaMessageParam[] =
      state.conversationHistory.slice(-4).map((t: ConversationTurn) => ({
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

    // Emit early interim speech before first API call
    if (interimSpeech) {
      interimSpeech("Opening Notes to write that down.");
    }

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      if (abortSignal?.aborted) {
        console.log("[documentation] aborted before iteration", i);
        return { responseText: "" };
      }

      let response: Anthropic.Beta.BetaMessage;
      try {
        response = await anthropic.beta.messages.create({
          model: "claude-sonnet-4-5-20250929",
          max_tokens: 1024,
          system: DOCUMENTATION_SYSTEM_PROMPT,
          tools,
          messages,
          betas: ["computer-use-2025-01-24"],
        });
      } catch (err) {
        console.error("[documentation] API error:", err);
        return {
          responseText:
            "I had trouble connecting to the documentation service. Please try again.",
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
          console.log("[documentation] aborted before tool execution");
          return { responseText: "" };
        }

        const input = toolUse.input as Record<string, unknown>;
        const action = input.action as string;

        console.log(
          `[documentation] tool: ${toolUse.name} action=${action} ` +
            JSON.stringify(input).slice(0, 100),
        );

        // Emit interim speech for typing actions only
        if (interimSpeech && action === "type") {
          interimSpeech("Writing your note.");
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
          console.error(`[documentation] action error (${action}):`, errMsg);
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
        "I took many steps but couldn't finish creating the note. Could you try again with a simpler request?",
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
      // Clipboard optimization for long text
      if (text.length > 100) {
        await control.clipboardType(text);
      } else {
        await control.type(text);
      }
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
