import type { ComputerControl } from "./computerControl.js";

export type ComputerActionResult =
  | { type: "text"; text: string }
  | { type: "screenshot"; imageBase64: string };

/**
 * Execute a computer action from the OpenAI Responses API computer_call output.
 * The `action` object follows the OpenAI CUA action schema.
 */
export async function executeComputerAction(
  control: ComputerControl,
  action: { type: string; [key: string]: unknown },
): Promise<ComputerActionResult> {
  switch (action.type) {
    case "screenshot": {
      const base64 = await control.screenshot();
      return { type: "screenshot", imageBase64: base64 };
    }

    case "click": {
      const x = action.x as number;
      const y = action.y as number;
      const button = (action.button as string) ?? "left";
      if (button === "right") {
        await control.rightClick(x, y);
      } else {
        await control.leftClick(x, y);
      }
      return { type: "text", text: "Clicked." };
    }

    case "double_click": {
      const x = action.x as number;
      const y = action.y as number;
      await control.doubleClick(x, y);
      return { type: "text", text: "Double-clicked." };
    }

    case "type": {
      const text = action.text as string;
      if (!text) throw new Error("type requires text");
      if (text.length > 100) {
        await control.clipboardType(text);
      } else {
        await control.type(text);
      }
      return { type: "text", text: "Typed." };
    }

    case "keypress": {
      const keys = action.keys as string[];
      if (!keys || keys.length === 0) throw new Error("keypress requires keys");
      await control.key(keys.join("+"));
      return { type: "text", text: `Pressed ${keys.join("+")}.` };
    }

    case "scroll": {
      const x = (action.x as number) ?? 640;
      const y = (action.y as number) ?? 400;
      const scrollX = (action.scroll_x as number) ?? 0;
      const scrollY = (action.scroll_y as number) ?? 0;
      // scroll_y negative = scroll down, positive = scroll up
      const direction = scrollY < 0 ? "down" : scrollY > 0 ? "up" : scrollX < 0 ? "right" : "left";
      const amount = Math.max(Math.abs(scrollX), Math.abs(scrollY), 1);
      await control.scroll(x, y, direction, amount);
      return { type: "text", text: `Scrolled ${direction}.` };
    }

    case "move": {
      const x = action.x as number;
      const y = action.y as number;
      await control.mouseMove(x, y);
      return { type: "text", text: "Moved cursor." };
    }

    case "drag": {
      const startX = (action.start_x ?? action.x) as number;
      const startY = (action.start_y ?? action.y) as number;
      const path = action.path as Array<[number, number]> | undefined;
      await control.leftClick(startX, startY);
      if (path && path.length > 0) {
        const [endX, endY] = path[path.length - 1];
        await control.mouseMove(endX, endY);
      }
      return { type: "text", text: "Dragged." };
    }

    case "wait": {
      const ms = (action.ms as number) ?? 1000;
      await new Promise((resolve) => setTimeout(resolve, ms));
      return { type: "text", text: "Waited." };
    }

    default:
      return { type: "text", text: `Unknown action: ${action.type}` };
  }
}
