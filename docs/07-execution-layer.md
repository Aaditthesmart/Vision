# Execution Layer — Stagehand + Visible Chromium

> The hands. Translates agent commands into real browser actions via Stagehand's AI-assisted automation on a visible Chromium instance that judges can watch in real time.

---

## Responsibilities

1. Launch and manage a visible Chromium browser instance
2. Provide Stagehand's AI-assisted browser automation to all agents
3. Execute natural language browser commands (`act()`)
4. Extract structured data from pages (`extract()`)
5. Run autonomous multi-step browser tasks (`agent()`)
6. Discover available actions on a page (`observe()`)
7. Handle browser errors, navigation failures, and timeout recovery

---

## I/O Contract

```typescript
// ── METHODS EXPOSED TO AGENTS (via ExecutionContext) ──────────

extract(instruction: string, schema: ZodSchema): Promise<ExtractResult>
act(instruction: string):                        Promise<ActResult>
observe():                                       Promise<ObserveResult>
navigate(url: string):                           Promise<NavigateResult>

// ── RETURN TYPES ─────────────────────────────────────────────
interface ExtractResult  { success: boolean; data: Record<string, unknown> | null; error?: string; }
interface ActResult      { success: boolean; description: string; newUrl?: string; error?: string; }
interface ObserveResult  { success: boolean; actions: { description: string; selector: string; type: string; }[]; error?: string; }
interface NavigateResult { success: boolean; finalUrl: string; pageTitle: string; error?: string; }
```

**Rules:**
- MUST handle all Playwright/Stagehand errors internally — return `success: false`, never throw.
- `extract()` MUST validate against the Zod schema — invalid data → `success: false`.
- `act()` MUST wait for network idle after actions that trigger page changes.
- `observe()` MUST return only visible, interactable elements.
- Maintains a SINGLE Chromium instance across the session — never spawn multiple browsers.
- Agents call these methods only — they MUST NOT import Stagehand or Playwright directly.

---

## Stagehand Initialization

```typescript
// server/lib/stagehand.ts

import { Stagehand } from "@browserbasehq/stagehand";

interface StagehandConfig {
  headless: boolean;          // false for visible demo
  modelName: string;          // Claude model for AI-assisted selectors
  modelApiKey: string;        // Anthropic API key
  verbose: boolean;           // Logging level
  debugDom: boolean;          // DOM debug overlay
}

let stagehandInstance: Stagehand | null = null;

export async function initStagehand(): Promise<Stagehand> {
  const stagehand = new Stagehand({
    env: "LOCAL",                        // Local Chromium, not Browserbase cloud
    headless: false,                     // VISIBLE — judges see real-time navigation
    modelName: "claude-sonnet-4-5-20250929",  // AI model for selector inference
    modelClientOptions: {
      apiKey: process.env.ANTHROPIC_API_KEY,
    },
    enableCaching: true,                 // Cache selectors for repeated actions
    verbose: 1,                          // Log level (0=silent, 1=info, 2=debug)
  });

  await stagehand.init();

  // Set a reasonable default viewport
  await stagehand.page.setViewportSize({ width: 1280, height: 800 });

  stagehandInstance = stagehand;
  return stagehand;
}

export function getStagehand(): Stagehand {
  if (!stagehandInstance) throw new Error("Stagehand not initialized");
  return stagehandInstance;
}

export async function shutdownStagehand(): Promise<void> {
  if (stagehandInstance) {
    await stagehandInstance.close();
    stagehandInstance = null;
  }
}
```

---

## Core API: The Four Stagehand Methods

### `act()` — Execute Natural Language Commands

Translates a natural language instruction into DOM interactions (clicks, typing, scrolling).

```typescript
// Usage in agents:
await stagehand.act({ action: "click the Add to Cart button" });
await stagehand.act({ action: "type 'wireless headphones' in the search box and press enter" });
await stagehand.act({ action: "scroll down to the product reviews section" });
await stagehand.act({ action: "select 'Large' from the size dropdown" });
```

**How it works internally:**
1. Stagehand takes a screenshot + DOM snapshot
2. Sends both to Claude (the model specified in config)
3. Claude identifies the correct element(s) and generates Playwright actions
4. Stagehand executes the Playwright commands

**Wrapper with error handling:**

```typescript
export async function safeAct(
  stagehand: Stagehand,
  action: string,
  options?: { retries?: number; timeout?: number },
): Promise<{ success: boolean; error?: string }> {
  const maxRetries = options?.retries ?? 2;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      await stagehand.act({
        action,
        ...(options?.timeout && { timeoutMs: options.timeout }),
      });
      return { success: true };
    } catch (err) {
      if (attempt === maxRetries) {
        return { success: false, error: `Failed after ${maxRetries + 1} attempts: ${err.message}` };
      }

      // On failure, try observing available actions first
      const available = await stagehand.observe({
        instruction: `What actions are available that relate to: "${action}"?`,
      });

      // Retry with more context
      if (available.length > 0) {
        const betterAction = `${action}. Available elements: ${available.map(a => a.description).join(", ")}`;
        try {
          await stagehand.act({ action: betterAction });
          return { success: true };
        } catch {
          continue;
        }
      }
    }
  }

  return { success: false, error: "Action could not be performed" };
}
```

---

### `extract()` — Pull Structured Data with Zod Schemas

Extracts structured information from the current page into a typed object.

```typescript
import { z } from "zod";

// Usage in agents:
const products = await stagehand.extract({
  instruction: "Extract the top 5 product results with name, price, rating",
  schema: z.object({
    products: z.array(z.object({
      name: z.string(),
      price: z.number(),
      rating: z.number().optional(),
    })),
  }),
});
// products.products → typed array of products
```

**How it works internally:**
1. Stagehand captures the DOM (or a relevant section)
2. Sends DOM + instruction + Zod schema to Claude
3. Claude extracts the data matching the schema
4. Stagehand validates against Zod and returns typed data

**Key schemas used across agents:**

```typescript
// Reusable extraction schemas — server/types/schemas.ts

export const ProductListSchema = z.object({
  products: z.array(z.object({
    name: z.string(),
    price: z.number(),
    currency: z.string().default("USD"),
    rating: z.number().optional(),
    reviewCount: z.number().optional(),
    availability: z.string().optional(),
    url: z.string().optional(),
  })),
});

export const PageContentSchema = z.object({
  title: z.string(),
  type: z.enum(["article", "product", "search_results", "form", "dashboard", "list", "other"]),
  mainContent: z.string(),
  keyPoints: z.array(z.string()),
});

export const FormFieldsSchema = z.object({
  fields: z.array(z.object({
    label: z.string(),
    type: z.string(),
    required: z.boolean(),
    currentValue: z.string().optional(),
    options: z.array(z.string()).optional(),
  })),
});

export const DrugFactsSchema = z.object({
  name: z.string(),
  activeIngredients: z.array(z.string()),
  warnings: z.array(z.string()),
  uses: z.array(z.string()).optional(),
});

export const OrderSummarySchema = z.object({
  subtotal: z.number(),
  shipping: z.number(),
  tax: z.number(),
  total: z.number(),
  items: z.array(z.object({
    name: z.string(),
    quantity: z.number(),
    price: z.number(),
  })).optional(),
});
```

---

### `observe()` — Discover Available Actions

Analyzes the current page and returns a list of possible actions the user/agent can take.

```typescript
// Usage:
const actions = await stagehand.observe({
  instruction: "What can I do on this page?",
});

// Returns: Array of { description: string, selector: string }
// e.g., [
//   { description: "Search box", selector: "#search-input" },
//   { description: "Sign In button", selector: ".nav-signin" },
//   { description: "Cart link", selector: "#nav-cart" },
// ]
```

**Use cases:**
- Error recovery: when `act()` fails, `observe()` discovers what's actually available
- Page orientation: when the agent doesn't know what page it's on
- Action menus: presenting the user with voice options based on page content

---

### `agent()` — Autonomous Multi-Step Tasks

Runs an autonomous loop where Stagehand plans and executes multiple steps to complete a goal.

```typescript
// Usage for complex flows:
await stagehand.agent({
  instruction: "Complete the checkout process: fill in shipping address, select standard shipping, and proceed to payment review",
  maxSteps: 10,
});
```

**When to use `agent()` vs manual `act()` sequences:**
- Use `agent()` for well-defined multi-step tasks where the exact steps may vary by site
- Use manual `act()` sequences when you need fine-grained control and reporting at each step
- Prefer manual sequences during demos (better `onAction` reporting for the user)

---

## Page Management

```typescript
// The execution layer manages a single page (tab) for simplicity.
// All agents share this page.

export async function navigateTo(
  stagehand: Stagehand,
  url: string,
  options?: { waitFor?: string; timeout?: number },
): Promise<void> {
  await stagehand.page.goto(url, {
    waitUntil: "domcontentloaded",
    timeout: options?.timeout || 15000,
  });

  // Wait for a specific element if needed
  if (options?.waitFor) {
    await stagehand.page.waitForSelector(options.waitFor, { timeout: 5000 }).catch(() => {});
  }
}

export async function getCurrentUrl(stagehand: Stagehand): Promise<string> {
  return stagehand.page.url();
}

export async function getPageTitle(stagehand: Stagehand): Promise<string> {
  return stagehand.page.title();
}

export async function takeScreenshot(stagehand: Stagehand): Promise<Buffer> {
  return await stagehand.page.screenshot();
}
```

---

## Browser Event Handling

```typescript
// Listen for navigation events to keep agents informed
export function setupPageListeners(
  stagehand: Stagehand,
  onNavigate: (url: string) => void,
  onDialog: (message: string) => void,
) {
  // Track page navigations
  stagehand.page.on("framenavigated", (frame) => {
    if (frame === stagehand.page.mainFrame()) {
      onNavigate(frame.url());
    }
  });

  // Auto-dismiss JavaScript alert/confirm dialogs
  stagehand.page.on("dialog", async (dialog) => {
    onDialog(dialog.message());
    await dialog.accept(); // Auto-accept for demo smoothness
  });

  // Handle unexpected popups / new tabs
  stagehand.page.context().on("page", async (newPage) => {
    // Close unexpected popups, keep main page focused
    await newPage.close();
  });
}
```

---

## Error Recovery Strategies

```
Scenario: Element not found (act() fails)
  1. observe() → discover available actions
  2. Retry with refined action description
  3. If still fails, report to agent for alternative approach

Scenario: Page navigation timeout
  1. Check if page partially loaded
  2. Retry navigation
  3. If persistent, report network issue to user

Scenario: Unexpected page (redirect, login wall)
  1. Extract page content to understand where we are
  2. If login page → inform user "This site requires login"
  3. If CAPTCHA → inform user "I've hit a CAPTCHA, please solve it"
  4. If error page → go back and try alternative

Scenario: Stale element reference
  1. Wait briefly for page to stabilize
  2. Retry the action (elements may have re-rendered)
  3. observe() to re-discover the element
```

---

## Visible Chromium for Demo

The browser runs visibly so judges can watch. Configuration for an impressive demo:

```typescript
// Chromium launch options for visible demo
const launchOptions = {
  headless: false,
  args: [
    "--window-size=1280,800",
    "--window-position=0,0",        // Position for second monitor / projector
    "--disable-infobars",           // Clean chrome UI
    "--no-first-run",
    "--disable-default-apps",
  ],
};

// Optional: Slow down actions slightly so judges can follow
// (only in demo mode, not during development)
const DEMO_MODE = process.env.DEMO_MODE === "true";
const ACTION_DELAY = DEMO_MODE ? 500 : 0; // ms between actions
```

---

## Browserbase Fallback

If local Chromium has issues, switch to Browserbase cloud:

```typescript
export async function initStagehandBrowserbase(): Promise<Stagehand> {
  const stagehand = new Stagehand({
    env: "BROWSERBASE",              // Cloud browser
    apiKey: process.env.BROWSERBASE_API_KEY,
    projectId: process.env.BROWSERBASE_PROJECT_ID,
    modelName: "claude-sonnet-4-5-20250929",
    modelClientOptions: {
      apiKey: process.env.ANTHROPIC_API_KEY,
    },
  });

  await stagehand.init();
  return stagehand;
}
```

---

## Interaction with Other Layers

| Layer | Interaction | Details |
|-------|-------------|---------|
| **Server Layer** | Stagehand instance created at startup | Injected into agents via dependency injection |
| **Commerce Agent** | `act()`, `extract()`, `agent()` | Product search, cart, checkout |
| **General Agent** | All four methods | Navigation, reading, forms, health product analysis |
| **LangGraph Supervisor** | Passed through state | Stagehand instance flows through graph state |
| **Client Layer** | No direct interaction | Browser actions reported via `onAction` callback through server |

---

## Performance Considerations

| Operation | Typical Latency | Notes |
|-----------|----------------|-------|
| `act()` (simple click) | 1-3s | Includes screenshot + Claude inference |
| `act()` (form fill) | 2-5s | Multiple fields = multiple inference calls |
| `extract()` | 1-4s | Depends on DOM size and schema complexity |
| `observe()` | 1-2s | Lightweight page scan |
| `agent()` (per step) | 2-5s | Each step is an act/extract cycle |
| `page.goto()` | 0.5-3s | Network dependent |

Total turn latency for a typical action: 3-8 seconds (browser actions are the bottleneck).

---

## Dependencies

```json
{
  "@browserbasehq/stagehand": "^1.0",
  "zod": "^3.22"
}
```

Stagehand internally uses Playwright, which bundles its own Chromium. No separate browser install needed.
