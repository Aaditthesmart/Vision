import { execSync } from "child_process";
import { readFileSync, unlinkSync } from "fs";

// ── Interface ────────────────────────────────────────────────

export interface ComputerControl {
  screenshot(): Promise<string>;
  mouseMove(x: number, y: number): Promise<void>;
  leftClick(x: number, y: number): Promise<void>;
  rightClick(x: number, y: number): Promise<void>;
  doubleClick(x: number, y: number): Promise<void>;
  type(text: string): Promise<void>;
  key(keys: string): Promise<void>;
  scroll(
    x: number,
    y: number,
    direction: string,
    amount: number,
  ): Promise<void>;
  cursorPosition(): Promise<{ x: number; y: number }>;
  clipboardType(text: string): Promise<void>;
  getDisplaySize(): { width: number; height: number };
}

// ── macOS Implementation ─────────────────────────────────────

const SCREENSHOT_PATH = "/tmp/cua-screenshot.png";
const API_MAX_WIDTH = 1280;
const API_MAX_HEIGHT = 800;

function jxa(script: string): string {
  return execSync(`osascript -l JavaScript -e '${script.replace(/'/g, "'\\''")}'`, {
    encoding: "utf-8",
    timeout: 5000,
  }).trim();
}

function applescript(script: string): string {
  return execSync(`osascript -e '${script.replace(/'/g, "'\\''")}'`, {
    encoding: "utf-8",
    timeout: 5000,
  }).trim();
}

export function createMacOSControl(): ComputerControl {
  // Cache display size
  let cachedSize: { width: number; height: number } | null = null;

  function getDisplaySize(): { width: number; height: number } {
    if (cachedSize) return cachedSize;
    const w = parseInt(
      jxa("ObjC.import('CoreGraphics'); $.CGDisplayPixelsWide($.CGMainDisplayID())"),
      10,
    );
    const h = parseInt(
      jxa("ObjC.import('CoreGraphics'); $.CGDisplayPixelsHigh($.CGMainDisplayID())"),
      10,
    );
    cachedSize = { width: w, height: h };
    return cachedSize;
  }

  // Compute API dimensions that maintain aspect ratio within max bounds
  function getApiDimensions(): { width: number; height: number } {
    const screen = getDisplaySize();
    const scaleW = API_MAX_WIDTH / screen.width;
    const scaleH = API_MAX_HEIGHT / screen.height;
    const scale = Math.min(scaleW, scaleH, 1);
    return {
      width: Math.round(screen.width * scale),
      height: Math.round(screen.height * scale),
    };
  }

  // Convert API coordinates to screen coordinates
  function toScreen(
    apiX: number,
    apiY: number,
  ): { x: number; y: number } {
    const screen = getDisplaySize();
    const api = getApiDimensions();
    return {
      x: Math.round(apiX * (screen.width / api.width)),
      y: Math.round(apiY * (screen.height / api.height)),
    };
  }

  function mouseEvent(
    type: string,
    x: number,
    y: number,
    button: string = "kCGMouseButtonLeft",
  ): void {
    jxa(
      `ObjC.import('CoreGraphics'); ` +
        `var e = $.CGEventCreateMouseEvent(null, $.${type}, $.CGPointMake(${x},${y}), $.${button}); ` +
        `$.CGEventPost($.kCGHIDEventTap, e);`,
    );
  }

  return {
    async screenshot(): Promise<string> {
      const api = getApiDimensions();
      execSync(`screencapture -x ${SCREENSHOT_PATH}`, { timeout: 5000 });
      execSync(
        `sips -z ${api.height} ${api.width} ${SCREENSHOT_PATH} --out ${SCREENSHOT_PATH}`,
        { timeout: 5000, stdio: "ignore" },
      );
      const buf = readFileSync(SCREENSHOT_PATH);
      try {
        unlinkSync(SCREENSHOT_PATH);
      } catch {
        /* ignore */
      }
      return buf.toString("base64");
    },

    async mouseMove(x: number, y: number): Promise<void> {
      const s = toScreen(x, y);
      mouseEvent("kCGEventMouseMoved", s.x, s.y);
    },

    async leftClick(x: number, y: number): Promise<void> {
      const s = toScreen(x, y);
      mouseEvent("kCGEventLeftMouseDown", s.x, s.y);
      mouseEvent("kCGEventLeftMouseUp", s.x, s.y);
    },

    async rightClick(x: number, y: number): Promise<void> {
      const s = toScreen(x, y);
      mouseEvent("kCGEventRightMouseDown", s.x, s.y, "kCGMouseButtonRight");
      mouseEvent("kCGEventRightMouseUp", s.x, s.y, "kCGMouseButtonRight");
    },

    async doubleClick(x: number, y: number): Promise<void> {
      const s = toScreen(x, y);
      // Set click count to 2 for double-click
      jxa(
        `ObjC.import('CoreGraphics'); ` +
          `var p = $.CGPointMake(${s.x},${s.y}); ` +
          `var d = $.CGEventCreateMouseEvent(null, $.kCGEventLeftMouseDown, p, $.kCGMouseButtonLeft); ` +
          `$.CGEventSetIntegerValueField(d, $.kCGMouseEventClickState, 2); ` +
          `$.CGEventPost($.kCGHIDEventTap, d); ` +
          `var u = $.CGEventCreateMouseEvent(null, $.kCGEventLeftMouseUp, p, $.kCGMouseButtonLeft); ` +
          `$.CGEventSetIntegerValueField(u, $.kCGMouseEventClickState, 2); ` +
          `$.CGEventPost($.kCGHIDEventTap, u);`,
      );
    },

    async type(text: string): Promise<void> {
      // Use System Events keystroke for full Unicode support
      const escaped = text.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      applescript(
        `tell application "System Events" to keystroke "${escaped}"`,
      );
    },

    async key(keys: string): Promise<void> {
      // keys format: "Return", "command+c", "shift+alt+f"
      // Parse modifier+key combos
      const parts = keys.split("+").map((s) => s.trim().toLowerCase());
      const keyName = parts.pop()!;

      const modifiers: string[] = [];
      for (const mod of parts) {
        if (mod === "command" || mod === "cmd" || mod === "super")
          modifiers.push("command down");
        else if (mod === "control" || mod === "ctrl")
          modifiers.push("control down");
        else if (mod === "alt" || mod === "option")
          modifiers.push("option down");
        else if (mod === "shift") modifiers.push("shift down");
      }

      const KEY_CODES: Record<string, number> = {
        return: 36,
        enter: 36,
        tab: 48,
        space: 49,
        delete: 51,
        backspace: 51,
        escape: 53,
        esc: 53,
        up: 126,
        down: 125,
        left: 123,
        right: 124,
        f1: 122,
        f2: 120,
        f3: 99,
        f4: 118,
        f5: 96,
        f6: 97,
        f7: 98,
        f8: 100,
        f9: 101,
        f10: 109,
        f11: 103,
        f12: 111,
        home: 115,
        end: 119,
        pageup: 116,
        page_up: 116,
        pagedown: 121,
        page_down: 121,
      };

      const using =
        modifiers.length > 0 ? ` using {${modifiers.join(", ")}}` : "";

      if (KEY_CODES[keyName] !== undefined) {
        applescript(
          `tell application "System Events" to key code ${KEY_CODES[keyName]}${using}`,
        );
      } else if (keyName.length === 1) {
        applescript(
          `tell application "System Events" to keystroke "${keyName}"${using}`,
        );
      } else {
        // Try as literal keystroke
        applescript(
          `tell application "System Events" to keystroke "${keyName}"${using}`,
        );
      }
    },

    async scroll(
      x: number,
      y: number,
      direction: string,
      amount: number,
    ): Promise<void> {
      // Move mouse to position first, then scroll
      const s = toScreen(x, y);
      mouseEvent("kCGEventMouseMoved", s.x, s.y);

      const dy =
        direction === "up"
          ? amount
          : direction === "down"
            ? -amount
            : 0;
      const dx =
        direction === "left"
          ? amount
          : direction === "right"
            ? -amount
            : 0;

      jxa(
        `ObjC.import('CoreGraphics'); ` +
          `var e = $.CGEventCreateScrollWheelEvent(null, $.kCGScrollEventUnitLine, 2, ${dy}, ${dx}); ` +
          `$.CGEventPost($.kCGHIDEventTap, e);`,
      );
    },

    async cursorPosition(): Promise<{ x: number; y: number }> {
      const raw = jxa(
        `ObjC.import('CoreGraphics'); ` +
          `var e = $.CGEventCreate(null); ` +
          `var p = $.CGEventGetLocation(e); ` +
          `JSON.stringify({x: p.x, y: p.y})`,
      );
      return JSON.parse(raw);
    },

    async clipboardType(text: string): Promise<void> {
      execSync('pbcopy', { input: text, timeout: 5000 });
      await new Promise(resolve => setTimeout(resolve, 50));
      applescript('tell application "System Events" to keystroke "v" using {command down}');
    },

    getDisplaySize,
  };
}
