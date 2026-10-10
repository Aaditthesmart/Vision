import { Stagehand } from "@browserbasehq/stagehand";
import type { ZodTypeAny } from "zod";
import os from "os";
import path from "path";
import { existsSync, mkdirSync } from "fs";
import type {
  ExtractResult,
  ActResult,
  ObserveResult,
  NavigateResult,
  ExecutionContext,
} from "../types/index.js";

let instance: Stagehand | null = null;

/** Locate Google Chrome on macOS. Returns the path or null if not found. */
function findChrome(): string | null {
  const chromePath =
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  if (existsSync(chromePath)) return chromePath;
  return null;
}

/**
 * Initialize Stagehand with a visible browser instance.
 * Prefers Google Chrome with an isolated profile; falls back to bundled Chromium.
 * Call once at server startup.
 */
export async function initStagehand(): Promise<void> {
  if (instance) return;

  if (!process.env.OPENAI_API_KEY) {
    console.warn(
      "OPENAI_API_KEY not set — Stagehand browser automation will be unavailable",
    );
    return;
  }

  const chromePath = findChrome();
  const userDataDir = path.join(os.tmpdir(), "rcy-chrome-profile");

  // Ensure the profile directory exists before Chrome tries to write to it
  mkdirSync(userDataDir, { recursive: true });

  if (chromePath) {
    console.log("[Stagehand] Using Google Chrome:", chromePath);
  } else {
    console.log("[Stagehand] Google Chrome not found — falling back to bundled Chromium");
  }

  instance = new Stagehand({
    env: "LOCAL",
    model: {
      modelName: "openai/gpt-4.1",
      apiKey: process.env.OPENAI_API_KEY,
    },
    localBrowserLaunchOptions: {
      headless: false,
      ...(chromePath ? { executablePath: chromePath } : {}),
      userDataDir,
    },
    verbose: 0,
  });

  await instance.init();
  console.log(
    `Stagehand initialized — visible ${chromePath ? "Chrome" : "Chromium"} running`,
  );
}

/** Return the singleton Stagehand instance, or null if not initialized. */
export function getStagehand(): Stagehand | null {
  return instance;
}

/** Gracefully close the browser and release resources. */
export async function closeStagehand(): Promise<void> {
  if (!instance) return;
  try {
    await instance.close();
  } catch {
    // best-effort cleanup
  }
  instance = null;
}

/**
 * Create an ExecutionContext that wraps Stagehand.
 * Every method catches errors and returns a typed result — never throws.
 */
export function createExecutionContext(): ExecutionContext | null {
  if (!instance) return null;

  const stagehand = instance;

  return {
    async extract(
      instruction: string,
      schema?: ZodTypeAny,
    ): Promise<ExtractResult> {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = schema
          ? await stagehand.extract(instruction, schema as any)
          : await stagehand.extract(instruction);
        return {
          success: true,
          data: (typeof result === "object" ? result : { extraction: result }) as Record<string, unknown>,
        };
      } catch (err) {
        return {
          success: false,
          data: null,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },

    async act(instruction: string): Promise<ActResult> {
      const MAX_RETRIES = 3;

      async function attemptAct(): Promise<ActResult> {
        try {
          const result = await stagehand.act(instruction);
          const page = stagehand.context.pages()[0];
          return {
            success: result.success,
            description: result.actionDescription || result.message,
            newUrl: page?.url() ?? undefined,
          };
        } catch (err) {
          return {
            success: false,
            description: "",
            error: err instanceof Error ? err.message : String(err),
          };
        }
      }

      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        const result = await attemptAct();
        if (result.success) return result;

        if (attempt < MAX_RETRIES) {
          console.log(`[stagehand] act() attempt ${attempt} failed, scrolling down and retrying...`);
          try {
            const page = stagehand.context.pages()[0];
            if (page) {
              await page.evaluate(() => window.scrollBy(0, 400));
              await new Promise((r) => setTimeout(r, 500));
            }
          } catch {
            // scroll failed — still retry
          }
        } else {
          console.log(`[stagehand] act() failed after ${MAX_RETRIES} attempts: ${result.error}`);
          return result;
        }
      }

      // Unreachable, but satisfies TS
      return { success: false, description: "", error: "Max retries exceeded" };
    },

    async observe(instruction?: string): Promise<ObserveResult> {
      try {
        const actions = instruction
          ? await stagehand.observe(instruction)
          : await stagehand.observe();
        return {
          success: true,
          actions: actions.map((a) => ({
            description: a.description,
            selector: a.selector,
            method: a.method,
          })),
        };
      } catch (err) {
        return {
          success: false,
          actions: [],
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },

    async navigate(url: string): Promise<NavigateResult> {
      try {
        const page = stagehand.context.pages()[0];
        if (!page) {
          return {
            success: false,
            finalUrl: "",
            pageTitle: "",
            error: "No browser page available",
          };
        }
        console.log(`[Stagehand] Navigating to: ${url}`);
        await page.goto(url, { waitUntil: "domcontentloaded", timeoutMs: 15000 });
        const finalUrl = page.url();
        const title = await page.title();
        console.log(`[stagehand] navigation complete: ${title} (${finalUrl})`);
        return { success: true, finalUrl, pageTitle: title };
      } catch (err) {
        console.warn(`[Stagehand] Navigation error for ${url}:`, err instanceof Error ? err.message : err);
        return {
          success: false,
          finalUrl: "",
          pageTitle: "",
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };
}
