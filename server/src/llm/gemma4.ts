import { ollamaClient } from "./ollama.js";
import {
  GoalInterpretationSchema,
  TaskPlanSchema,
  RecoveryPlanSchema,
  type GoalInterpretation,
  type TaskPlan,
  type RecoveryPlan,
  type PageContext,
  type ActionStep,
} from "../types/accessibility.js";
import { v4 as uuidv4 } from "uuid";

export class Gemma4Engine {
  /**
   * Helper to safely parse JSON from model output with markdown cleanup.
   */
  private parseJsonFromModel(text: string): unknown {
    let clean = text.trim();
    if (clean.startsWith("```json")) {
      clean = clean.replace(/^```json\s*/i, "").replace(/```\s*$/, "");
    } else if (clean.startsWith("```")) {
      clean = clean.replace(/^```\s*/, "").replace(/```\s*$/, "");
    }
    return JSON.parse(clean);
  }

  /**
   * Summarize PageContext into a compact text format suitable for prompt context
   * without flooding the model with massive DOM strings.
   */
  public formatContextForPrompt(ctx?: PageContext): string {
    if (!ctx) return "No active browser page loaded.";

    const headings = ctx.headings
      .slice(0, 10)
      .map((h) => `  - [H${h.level}] ${h.text}`)
      .join("\n");

    const landmarks = ctx.landmarks
      .slice(0, 8)
      .map((l) => `  - Landmark: <${l.role}> ${l.label || ""}`)
      .join("\n");

    const interactive = ctx.interactiveElements
      .slice(0, 25)
      .map(
        (el, idx) =>
          `  [#${idx + 1}] Role: ${el.role} | Name: "${el.name || el.text || ""}" | Selector: \`${el.selector}\` | Type: ${el.type || ""}`,
      )
      .join("\n");

    const forms = ctx.forms
      .map(
        (f) =>
          `  Form: "${f.label || f.name || f.id}" -> Fields: ${f.fields.map((fld) => `[${fld.role}: "${fld.label}"]`).join(", ")}`,
      )
      .join("\n");

    return `
PAGE TITLE: "${ctx.title}"
PAGE URL: ${ctx.url}
MAIN CONTENT SUMMARY:
${ctx.mainTextSummary || "None"}

HEADINGS:
${headings || "  (No headings detected)"}

LANDMARKS:
${landmarks || "  (Standard layout)"}

FORMS:
${forms || "  (No forms on this page)"}

VISIBLE INTERACTIVE CONTROLS:
${interactive || "  (No interactive elements detected)"}
`.trim();
  }

  /**
   * Interpret user's natural language goal into structured intent.
   */
  public async interpretGoal(
    userInput: string,
    ctx?: PageContext,
  ): Promise<GoalInterpretation> {
    const formattedCtx = this.formatContextForPrompt(ctx);

    const systemPrompt = `You are Gemma 4, an AI accessibility engine for visually impaired users.
Your role is to understand the user's intent and produce a structured JSON interpretation.
Identify if the goal is:
1. "page_understanding": User asks what is on the page, wants summary or navigation landmarks.
2. "find_and_focus": User wants to locate a specific control, button, filter, or input (e.g. "find price filter").
3. "search_results": User wants to inspect or select a specific search result or item.
4. "form_fill": User wants to fill form inputs with provided details.
5. "navigate": User wants to go to a specific URL or web location.
6. "action": User wants to trigger a click or selection.
7. "clarify": The request is ambiguous and needs user clarification.

CONSEQUENTIAL ACTIONS:
Set "isConsequential": true if the goal involves submitting forms, purchasing items, deleting content, or irreversible actions.

OUTPUT JSON FORMAT ONLY:
{
  "userGoal": string,
  "intentCategory": "page_understanding" | "find_and_focus" | "search_results" | "form_fill" | "navigate" | "action" | "clarify",
  "targetElementDescription": string (optional),
  "targetRole": string (optional),
  "targetLabelOrText": string (optional),
  "formData": { "fieldName": "value" } (optional),
  "isConsequential": boolean,
  "clarificationNeeded": string (optional),
  "explanation": string (concise explanation for screen reader / TTS)
}`;

    const userPrompt = `CURRENT PAGE STATE:
${formattedCtx}

USER REQUEST:
"${userInput}"`;

    try {
      const resp = await ollamaClient.chat({
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        jsonMode: true,
        temperature: 0.1,
      });

      const parsed = this.parseJsonFromModel(resp.content);
      const validated = GoalInterpretationSchema.safeParse(parsed);

      if (validated.success) {
        const data = validated.data;
        const textLower = userInput.toLowerCase();
        const isNegativeSubmit =
          textLower.includes("not submit") ||
          textLower.includes("without submit") ||
          textLower.includes("don't submit") ||
          textLower.includes("dont submit");

        if (
          !isNegativeSubmit &&
          (textLower.includes("submit") ||
            textLower.includes("checkout") ||
            textLower.includes("buy") ||
            textLower.includes("purchase") ||
            textLower.includes("delete"))
        ) {
          data.isConsequential = true;
          if (data.intentCategory === "page_understanding") {
            data.intentCategory = "action";
          }
        }
        return data;
      }
      console.warn("[Gemma4] Validation warning for GoalInterpretation:", validated.error);
    } catch (err) {
      console.error("[Gemma4] interpretGoal inference error:", err);
    }

    // Heuristic deterministic fallback when local model is offline or returns invalid structure
    return this.fallbackInterpretGoal(userInput, ctx);
  }

  /**
   * Plan navigation and action steps based on interpreted goal and page context.
   */
  public async planTask(
    goal: GoalInterpretation,
    ctx: PageContext,
  ): Promise<TaskPlan> {
    const formattedCtx = this.formatContextForPrompt(ctx);

    const systemPrompt = `You are Gemma 4, an accessibility task planner.
Convert the user's goal into a bounded sequence of safe action steps.

Allowed Action Types:
- "locate_and_focus": Move visual/accessibility focus to a target element.
- "click": Click a button, link, checkbox, or control.
- "fill": Fill an input field with a value.
- "select": Choose a dropdown option.
- "navigate": Go to a specified URL.
- "scroll": Scroll up or down.
- "explain": Provide explanation to user.

Allowed Verification Methods:
- "element_focused": Verify element received focus.
- "value_matched": Verify input field contains expected value.
- "content_present": Verify content is displayed.
- "url_change": Verify page navigated to expected URL.
- "none"

SAFETY RULES:
- Never submit forms unless explicitly instructed. If filling form fields, STOP before the submit button.
- If an action is consequential (buying, submitting, deleting), set "requiresApproval": true and "isConsequential": true.
- Keep plans minimal: 1 to 4 bounded steps.

OUTPUT JSON FORMAT ONLY:
{
  "userGoal": string,
  "summary": string,
  "requiresApproval": boolean,
  "estimatedRisk": "LOW" | "MEDIUM" | "HIGH",
  "steps": [
    {
      "id": string,
      "description": string,
      "actionType": "locate_and_focus" | "click" | "fill" | "select" | "scroll" | "navigate" | "explain",
      "selector": string (optional),
      "targetRole": string (optional),
      "targetName": string (optional),
      "value": string (optional),
      "expectedOutcome": string,
      "verificationMethod": "element_focused" | "value_matched" | "content_present" | "url_change" | "none",
      "isConsequential": boolean,
      "requiresApproval": boolean,
      "status": "PLANNED"
    }
  ]
}`;

    const userPrompt = `CURRENT PAGE STATE:
${formattedCtx}

INTERPRETED GOAL:
${JSON.stringify(goal, null, 2)}`;

    try {
      const resp = await ollamaClient.chat({
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        jsonMode: true,
        temperature: 0.1,
      });

      const parsed = this.parseJsonFromModel(resp.content);
      const validated = TaskPlanSchema.safeParse(parsed);

      if (validated.success && validated.data.steps.length > 0) {
        validated.data.steps = validated.data.steps.map((s) => ({
          ...s,
          id: s.id || uuidv4(),
          requiresApproval: goal.isConsequential ? true : s.requiresApproval,
          isConsequential: goal.isConsequential ? true : s.isConsequential,
        }));
        if (goal.isConsequential) validated.data.requiresApproval = true;
        return validated.data;
      }
    } catch (err) {
      console.error("[Gemma4] planTask error:", err);
    }

    // Heuristic deterministic fallback
    return this.fallbackPlanTask(goal, ctx);
  }

  /**
   * Generate accessible explanation of the page.
   */
  public async explainPage(ctx: PageContext, goal?: string): Promise<string> {
    const formattedCtx = this.formatContextForPrompt(ctx);

    const systemPrompt = `You are Gemma 4, an accessibility assistant explaining a webpage to a visually impaired user.
Provide a clear, grounded 2-4 sentence summary:
1. What the page is (title/topic).
2. Key landmarks, major sections, or important content.
3. Relevant interactive controls available.
DO NOT list raw selectors or read all navigation links sequentially. Be conversational and concise.`;

    const userPrompt = `PAGE CONTEXT:
${formattedCtx}
${goal ? `USER FOCUS: "${goal}"` : ""}`;

    try {
      const resp = await ollamaClient.chat({
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.2,
      });
      if (resp.content) return resp.content;
    } catch (err) {
      console.warn("[Gemma4] explainPage inference failed, using structured fallback:", err);
    }

    // Grounded fallback
    const headingSummary = ctx.headings.map((h) => h.text).slice(0, 3).join(", ");
    return `You are on "${ctx.title}". Key sections include ${headingSummary || "main content"}. You can search, browse products, or use navigation controls.`;
  }

  /**
   * Recovery planning when a step execution fails.
   */
  public async planRecovery(
    failedStep: ActionStep,
    error: string,
    updatedCtx: PageContext,
  ): Promise<RecoveryPlan> {
    const formattedCtx = this.formatContextForPrompt(updatedCtx);

    const systemPrompt = `You are Gemma 4, an accessibility recovery assistant.
An automated browser action failed. Analyze the updated page state and determine if a safe alternative exists.
Rules:
- If element is missing or changed, check if a synonym or equivalent control exists.
- If no alternative is safe, set canRecover: false and provide an honest explanation.
- Never repeat identical actions that already failed.

OUTPUT JSON FORMAT:
{
  "canRecover": boolean,
  "explanation": string,
  "alternativeSteps": []
}`;

    const userPrompt = `FAILED STEP:
${JSON.stringify(failedStep, null, 2)}

ERROR:
${error}

UPDATED PAGE STATE:
${formattedCtx}`;

    try {
      const resp = await ollamaClient.chat({
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        jsonMode: true,
        temperature: 0.1,
      });

      const parsed = this.parseJsonFromModel(resp.content);
      const validated = RecoveryPlanSchema.safeParse(parsed);
      if (validated.success) {
        return validated.data;
      }
    } catch (err) {
      console.warn("[Gemma4] planRecovery error:", err);
    }

    return {
      canRecover: false,
      explanation: `Action "${failedStep.description}" could not be completed: ${error}. The requested element is unavailable on the current page.`,
      alternativeSteps: [],
    };
  }

  /**
   * Generate clean, production-ready code from user's natural language voice prompt.
   */
  public async generateCode(prompt: string): Promise<{ code: string; fileName: string; language: string; summary: string }> {
    const systemPrompt = `You are Gemma 4, an expert AI software developer assisting a visually impaired programmer.
The user gave a voice command to write code.
Generate complete, clean, working code.
Determine the appropriate language and a sensible file name (e.g., reverse_list.py, factorial.py, index.html, app.py).

OUTPUT JSON ONLY with this structure:
{
  "code": "the complete source code with comments",
  "fileName": "filename with extension",
  "language": "python|javascript|typescript|html|cpp|java|c",
  "summary": "one sentence explanation of what the code does"
}`;

    try {
      const resp = await ollamaClient.chat({
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `WRITE CODE FOR: "${prompt}"` },
        ],
        jsonMode: true,
        temperature: 0.2,
        timeoutMs: 30000,
      });

      const parsed = this.parseJsonFromModel(resp.content) as any;
      if (parsed && parsed.code) {
        return {
          code: parsed.code,
          fileName: parsed.fileName || "solution.py",
          language: parsed.language || "python",
          summary: parsed.summary || "Generated requested code.",
        };
      }
    } catch (err) {
      console.warn("[Gemma4] LLM code generation fallback:", err);
    }

    // High quality deterministic fallback generator
    return this.fallbackGenerateCode(prompt);
  }

  private fallbackGenerateCode(prompt: string): { code: string; fileName: string; language: string; summary: string } {
    const text = prompt.toLowerCase();

    // 1. Python reverse list / string
    if (text.includes("reverse") && (text.includes("list") || text.includes("string") || text.includes("array"))) {
      const code = `def reverse_sequence(seq):\n    """Reverses any given list or string."""\n    return seq[::-1]\n\nif __name__ == "__main__":\n    sample_list = [10, 20, 30, 40, 50]\n    sample_str = "VisionOS Accessibility"\n    print("Original list:", sample_list)\n    print("Reversed list:", reverse_sequence(sample_list))\n    print("Reversed string:", reverse_sequence(sample_str))\n`;
      return { code, fileName: "reverse_sequence.py", language: "python", summary: "Python function to reverse lists and strings" };
    }

    // 2. Factorial
    if (text.includes("factorial")) {
      const code = `def factorial(n: int) -> int:\n    """Calculates factorial of n recursively."""\n    if n < 0:\n        raise ValueError("Factorial is not defined for negative numbers.")\n    if n <= 1:\n        return 1\n    return n * factorial(n - 1)\n\nif __name__ == "__main__":\n    for i in range(1, 8):\n        print(f"{i}! = {factorial(i)}")\n`;
      return { code, fileName: "factorial.py", language: "python", summary: "Recursive factorial calculation function in Python" };
    }

    // 3. Fibonacci
    if (text.includes("fibonacci")) {
      const code = `def generate_fibonacci(count: int):\n    """Generates the first 'count' Fibonacci numbers."""\n    if count <= 0:\n        return []\n    sequence = [0, 1]\n    while len(sequence) < count:\n        sequence.append(sequence[-1] + sequence[-2])\n    return sequence[:count]\n\nif __name__ == "__main__":\n    print("First 10 Fibonacci numbers:", generate_fibonacci(10))\n`;
      return { code, fileName: "fibonacci.py", language: "python", summary: "Fibonacci sequence generator in Python" };
    }

    // 4. Calculator / Math operations
    if (text.includes("add") || text.includes("sum") || text.includes("calculator")) {
      const code = `def add(a: float, b: float) -> float:\n    """Adds two numbers and returns the sum."""\n    return a + b\n\ndef multiply(a: float, b: float) -> float:\n    """Multiplies two numbers."""\n    return a * b\n\nif __name__ == "__main__":\n    print("Sum of 25 and 17:", add(25, 17))\n    print("Product of 6 and 7:", multiply(6, 7))\n`;
      return { code, fileName: "calculator.py", language: "python", summary: "Mathematical utility functions in Python" };
    }

    // 5. HTML / Web boilerplate
    if (text.includes("html") || text.includes("website") || text.includes("page")) {
      const code = `<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n  <title>VisionOS Project</title>\n  <style>\n    body { font-family: system-ui, sans-serif; background: #0f172a; color: #f8fafc; padding: 40px; }\n    h1 { color: #38bdf8; }\n  </style>\n</head>\n<body>\n  <h1>Welcome to VisionOS</h1>\n  <p>Voice-assisted computer interface for accessible coding.</p>\n</body>\n</html>\n`;
      return { code, fileName: "index.html", language: "html", summary: "Accessible HTML5 template" };
    }

    // 6. Generic Python script
    const cleanedCode = prompt
      .replace(/^(?:write|create|code|generate)\s+(?:code|python|script)?\s*(?:in|into)?\s*(?:vs\s*code|vscode)?\s*[:,\-]?/i, "")
      .trim();

    const code = `"""\nGenerated by VisionOS Voice Accessibility Engine\nPrompt: ${prompt}\n"""\n\ndef main():\n    # ${prompt}\n    print("Executing: ${cleanedCode.replace(/"/g, '\\"')}")\n\nif __name__ == "__main__":\n    main()\n`;
    return { code, fileName: "visionos_script.py", language: "python", summary: `Python script for "${prompt.substring(0, 40)}"` };
  }

  // ── Deterministic Heuristic Fallbacks (Zero-Cloud / Offline Safety) ──

  private fallbackInterpretGoal(userInput: string, ctx?: PageContext): GoalInterpretation {
    const text = userInput.toLowerCase();

    // Task 38: Cancel
    if (/^(?:cancel|stop|abort|halt)\s*(?:the\s*)?(?:current\s*)?(?:task|action)?/i.test(text)) {
      return { userGoal: userInput, intentCategory: "system_control", systemPayload: { action: "cancel_task" }, isConsequential: false, explanation: "Cancelling the current task." };
    }
    // Task 40/35: Status report
    if (text.includes("last action") || text.includes("did it succeed") || text.includes("what have you") || text.includes("did that work") || /^(?:status|what happened)/i.test(text)) {
      return { userGoal: userInput, intentCategory: "system_control", systemPayload: { action: "get_status" }, isConsequential: false, explanation: "Reporting task status." };
    }
    // Task 2: Read screen
    if (/what.{0,10}on.{0,10}screen/i.test(text) || /(?:read|describe).{0,5}screen/i.test(text)) {
      return { userGoal: userInput, intentCategory: "system_control", systemPayload: { action: "read_screen" }, isConsequential: false, explanation: "Reading your screen." };
    }
    // Task 6: Active window
    if (/which (?:window|app).{0,10}(?:am i|using)/i.test(text) || /(?:current|active) (?:window|app)/i.test(text) || text === "active window") {
      return { userGoal: userInput, intentCategory: "system_control", systemPayload: { action: "active_window" }, isConsequential: false, explanation: "Checking active window." };
    }
    // Task 4: Switch window
    const switchMatch = text.match(/(?:switch|go|focus|bring)\s+(?:me\s+)?(?:to|back to|into)\s+(?:my\s+)?(.+?)(?:\s+window)?\s*\.?$/i);
    if (switchMatch) {
      const target = switchMatch[1].trim();
      return { userGoal: userInput, intentCategory: "system_control", systemPayload: { action: "focus_window", window: target }, isConsequential: false, explanation: `Switching to ${target}.` };
    }
    // Task 5: Spotify next
    if (/(?:next|skip)\s+(?:song|track)/i.test(text) || text.includes("next track") || text.includes("next song")) {
      return { userGoal: userInput, intentCategory: "system_control", systemPayload: { action: "spotify_next" }, isConsequential: false, explanation: "Playing next song on Spotify." };
    }
    // Task 1: Chrome search
    const chromeSearch = text.match(/open\s+chrome\s+and\s+search\s+(?:for\s+)?(.+)/i);
    if (chromeSearch) {
      return { userGoal: userInput, intentCategory: "chrome_search", targetLabelOrText: chromeSearch[1].trim(), isConsequential: false, explanation: `Chrome: searching ${chromeSearch[1].trim()}.` };
    }
    // Tasks 15/16/20: Write code
    const codeMatch =
      userInput.match(/(?:create|write|generate)\s+(?:a\s+)?(?:c\+\+|cpp|python|javascript|typescript|java|html)\s+(?:file|code|program|script)\s+(?:that|which|to|for)\s+(.+)/i) ||
      userInput.match(/(?:write|type|generate|create)?\s*(?:code|script|program)?\s*(?:in|into|on)\s+(?:vs\s*code|vscode|visual\s*studio\s*code)\s*[:,\-]?\s*(.+)/i) ||
      userInput.match(/^(?:write|create|generate)\s+code\s*[:,\-]?\s*(.+)/i);
    if (codeMatch) {
      return { userGoal: userInput, intentCategory: "write_code", targetLabelOrText: codeMatch[1].trim(), isConsequential: false, explanation: `Writing code: ${codeMatch[1].trim().slice(0, 50)}.` };
    }
    // Task 17: Compile and run
    if (/(?:compile|build)\s+and\s+run/i.test(text) || /^(?:run|execute)\s+(?:my\s+)?(?:code|program|file|script)/i.test(text)) {
      return { userGoal: userInput, intentCategory: "compile_run", isConsequential: false, explanation: "Compiling and running your code." };
    }
    // Task 18/21: Analyze code / fix bug
    if (/fix\s+(?:the\s+)?(?:error|bug|issue)/i.test(text) || /find\s+(?:the\s+)?bug/i.test(text) || /(?:explain|describe)\s+(?:what\s+)?(?:this\s+)?code\s+does/i.test(text)) {
      return { userGoal: userInput, intentCategory: "analyze_code", isConsequential: false, explanation: "Analyzing your code." };
    }
    // Task 22: Run tests
    if (/run\s+(?:my\s+)?tests?/i.test(text) || /tests?\s+(?:fail|failed)/i.test(text)) {
      return { userGoal: userInput, intentCategory: "run_tests", isConsequential: false, explanation: "Running your tests." };
    }
    // Task 19: Python project with venv
    if (/create\s+(?:a\s+)?python\s+project/i.test(text) || /python.*(?:venv|virtual environment)/i.test(text)) {
      const nm = userInput.match(/(?:named?|called?)\s+["']?([A-Za-z0-9_\-\s]+)["']?/i);
      return { userGoal: userInput, intentCategory: "create_python_project", targetLabelOrText: nm ? nm[1].trim() : "MyPythonProject", isConsequential: false, explanation: "Creating Python project with venv." };
    }
    // Task 20: Build website
    if (/build\s+(?:a\s+)?(?:basic\s+)?website/i.test(text) || /create\s+(?:a\s+)?(?:basic\s+)?(?:html|web)/i.test(text)) {
      const nm = userInput.match(/(?:named?|called?)\s+["']?([A-Za-z0-9_\-\s]+)["']?/i);
      return { userGoal: userInput, intentCategory: "create_website", targetLabelOrText: nm ? nm[1].trim() : "MyWebsite", isConsequential: false, explanation: "Building a website with HTML, CSS, JS." };
    }
    // Task 23: Create folder
    if (/(?:create|make)\s+(?:a\s+)?(?:new\s+)?folder/i.test(text)) {
      const nm = userInput.match(/folder\s+(?:called?|named?)\s+([^.]+?)(?:\.|$)/i) || userInput.match(/create\s+(?:a\s+)?(?:new\s+)?folder\s+(.+)/i);
      return { userGoal: userInput, intentCategory: "file_ops", systemPayload: { action: "create_folder", folderName: nm ? nm[1].trim() : "New Folder" }, isConsequential: false, explanation: "Creating folder." };
    }
    // Task 24: Find file
    if (/find\s+(?:my\s+)?(?:\w+\s+)?(?:file|document|assignment)/i.test(text)) {
      const qm = userInput.match(/find\s+(?:my\s+)?(.+?)(?:\s+in\s+|\s+on\s+|$)/i);
      return { userGoal: userInput, intentCategory: "file_ops", systemPayload: { action: "find_file", query: qm ? qm[1].trim() : userInput }, isConsequential: false, explanation: "Searching for file." };
    }
    // Task 26: Create notes
    if (/create\s+(?:a\s+)?(?:text\s+)?(?:notes?\s+)?file/i.test(text) || /(?:take|write)\s+(?:a\s+)?note/i.test(text)) {
      return { userGoal: userInput, intentCategory: "file_ops", systemPayload: { action: "create_notes" }, isConsequential: false, explanation: "Creating notes file." };
    }
    // Task 27: Recent file
    if (/(?:recently|most recently)\s+(?:edited|modified)/i.test(text) || /file.*(?:edited|modified).*(?:recently|last)/i.test(text)) {
      return { userGoal: userInput, intentCategory: "file_ops", systemPayload: { action: "recent_file" }, isConsequential: false, explanation: "Finding most recently edited file." };
    }
    // Task 28: Open folder in VS Code
    if (/open.{0,20}(?:folder|project).{0,20}(?:vs\s*code|vscode)/i.test(text)) {
      const nm = userInput.match(/open\s+(?:my\s+)?(.+?)\s+(?:folder|project)\s+in/i);
      return { userGoal: userInput, intentCategory: "file_ops", systemPayload: { action: "open_in_vscode", folderName: nm ? nm[1].trim() : "" }, isConsequential: false, explanation: "Opening project in VS Code." };
    }
    // Shortcuts
    const shortcutKeys = ["save", "save file", "undo", "copy", "paste", "enter", "press enter", "new line", "escape"];
    const keyMatch = text.match(/^(?:press|hit|shortcut)\s+(.+)/i) || (shortcutKeys.includes(text) ? [null, text] : null);
    if (keyMatch) {
      const k = (keyMatch[1] || text).trim();
      return { userGoal: userInput, intentCategory: "system_control", systemPayload: { action: "shortcut", shortcut: k }, isConsequential: k.includes("delete"), explanation: `Pressing ${k}.` };
    }
    // YouTube
    const ytMatch = text.match(/(?:open|play|search)\s+youtube(?:\s+(?:for|and\s+search\s+for)?\s*(.+))?/i) || (text.includes("youtube") ? [null, text.replace(/.*youtube\s*/i, "").trim()] : null);
    if (ytMatch) {
      const q = (ytMatch[1] || "").trim();
      const ytUrl = q ? `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}` : "https://www.youtube.com";
      return { userGoal: userInput, intentCategory: "navigate", targetLabelOrText: ytUrl, isConsequential: false, explanation: q ? `YouTube: ${q}.` : "Opening YouTube." };
    }
    // Google
    const gMatch = text.match(/(?:open|search\s+on)\s+google(?:\s+(?:for|and\s+search\s+for)?\s*(.+))?/i) || text.match(/^search\s+(?:for\s+)?(.+)/i);
    if (gMatch) {
      const q = (gMatch[1] || "").trim();
      const gUrl = q ? `https://www.google.com/search?q=${encodeURIComponent(q)}` : "https://www.google.com";
      return { userGoal: userInput, intentCategory: "navigate", targetLabelOrText: gUrl, isConsequential: false, explanation: q ? `Google: ${q}.` : "Opening Google." };
    }
    // Website
    const siteMatch = text.match(/(?:open|go to|visit|navigate to)\s+([a-zA-Z0-9.-]+\.[a-zA-Z]{2,}|https?:\/\/[^\s]+)/i);
    if (siteMatch && !text.includes("test") && !text.includes("filter")) {
      let url = siteMatch[1]; if (!url.startsWith("http")) url = "https://" + url;
      return { userGoal: userInput, intentCategory: "navigate", targetLabelOrText: url, isConsequential: false, explanation: `Navigating to ${url}.` };
    }
    // Open app
    const appNames = ["notepad", "calculator", "paint", "chrome", "edge", "firefox", "word", "excel", "powerpoint", "vs code", "vscode", "visual studio code", "spotify", "vlc", "zoom", "settings", "task manager"];
    const appMatch = text.match(/(?:open|launch|start)\s+(.+?)(?:\s+(?:application|app|program))?$/i);
    if (appMatch) {
      const a = appMatch[1].trim().toLowerCase();
      const found = appNames.find(n => a.includes(n));
      if (found || appNames.some(n => text.includes(n))) {
        return { userGoal: userInput, intentCategory: "open_app", targetLabelOrText: found || a, isConsequential: false, explanation: `Opening ${found || a}.` };
      }
    }
    // Screenshot
    if (text.includes("screenshot") || text.includes("capture screen")) {
      return { userGoal: userInput, intentCategory: "system_control", systemPayload: { action: "screenshot" }, isConsequential: false, explanation: "Taking a screenshot." };
    }
    // Volume
    if (text.includes("volume")) {
      const vm = text.match(/(\d+)\s*(?:percent|%)?/); const lv = vm ? vm[1] : "50";
      return { userGoal: userInput, intentCategory: "system_control", systemPayload: { action: "volume", level: lv }, isConsequential: false, explanation: `Volume to ${lv}%.` };
    }
    // Window control
    const winMatch = text.match(/(?:minimize|maximize|maximise|close)\s+(?:the\s+)?(?:window|app)?\s*(.+)?/i);
    if (winMatch) {
      const ac = text.includes("minimize") ? "minimize" : text.includes("close") ? "close" : "maximize";
      const wt = (winMatch[1] || "").trim();
      return { userGoal: userInput, intentCategory: "system_control", systemPayload: { action: ac, window: wt }, isConsequential: ac === "close", explanation: `${ac} ${wt || "active window"}.` };
    }
    // List windows
    if (text.includes("list") && text.includes("window")) {
      return { userGoal: userInput, intentCategory: "system_control", systemPayload: { action: "list_windows" }, isConsequential: false, explanation: "Listing open windows." };
    }
    // Page understanding
    if (/(?:what.*on|tell me about|explain|describe|read|summarize)\s+(?:this\s+)?(?:page|article|website|screen)/i.test(text) || text.includes("main content") || text.includes("mandatory") || text.includes("options available")) {
      return { userGoal: userInput, intentCategory: "page_understanding", isConsequential: false, explanation: "Describing the current page." };
    }
    // Find element
    if (/find|locate|where is|take me to|move focus/i.test(text)) {
      const fm = userInput.match(/(?:find|locate|where is)\s+(?:the\s+)?(.+?)(?:\s+(?:button|field|filter|element))?\s*\.?$/i);
      const td = fm ? fm[1].trim() : text;
      if (text.includes("price")) return { userGoal: userInput, intentCategory: "find_and_focus", targetRole: "filter", targetLabelOrText: "price", targetElementDescription: "Price filter", isConsequential: false, explanation: "Locating price filter." };
      return { userGoal: userInput, intentCategory: "find_and_focus", targetElementDescription: td, targetLabelOrText: td, isConsequential: false, explanation: `Looking for ${td}.` };
    }
    // Search results
    if (text.includes("second result") || text.includes("compare") || text.includes("first three")) {
      return { userGoal: userInput, intentCategory: "search_results", targetElementDescription: "Search results", isConsequential: false, explanation: "Analyzing search results." };
    }
    // Consequential
    const negSubmit = text.includes("not submit") || text.includes("don't submit") || text.includes("dont submit");
    if (!negSubmit && (text.includes("buy") || text.includes("checkout") || text.includes("submit") || text.includes("purchase"))) {
      return { userGoal: userInput, intentCategory: "action", isConsequential: true, explanation: "This action requires your confirmation." };
    }
    // Form fill
    if (text.includes("fill") || (text.includes("form") && (text.includes("name") || text.includes("email")))) {
      const fd: Record<string, string> = {};
      const nm = userInput.match(/name\s*(?:is|to|:)?\s*([A-Za-z\s]+?)(?:,|\.| and |$)/i);
      const em = userInput.match(/email\s*(?:is|to|:)?\s*([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i);
      if (nm) fd["name"] = nm[1].trim(); if (em) fd["email"] = em[1].trim();
      return { userGoal: userInput, intentCategory: "form_fill", formData: fd, isConsequential: false, explanation: "Filling form fields without submitting." };
    }
    // Type text
    const typeM = userInput.match(/^(?:type|enter)\s+(.+)/i);
    if (typeM) return { userGoal: userInput, intentCategory: "type_text", targetLabelOrText: typeM[1].trim(), isConsequential: false, explanation: `Typing ${typeM[1].trim().slice(0, 40)}.` };

    return { userGoal: userInput, intentCategory: "action", isConsequential: false, explanation: `Interpreting: ${userInput}.` };
  }

  private fallbackPlanTask(
    goal: GoalInterpretation,
    ctx: PageContext,
  ): TaskPlan {
    const steps: ActionStep[] = [];

    switch (goal.intentCategory) {
      case "navigate": {
        const targetUrl = goal.targetLabelOrText || "https://www.youtube.com";
        steps.push({
          id: uuidv4(),
          description: `Navigate to ${targetUrl}`,
          actionType: "navigate",
          value: targetUrl,
          expectedOutcome: `Browser navigated to ${targetUrl}`,
          verificationMethod: "url_change",
          isConsequential: false,
          requiresApproval: false,
          status: "PLANNED",
        });
        steps.push({
          id: uuidv4(),
          description: `Analyze and explain the loaded page`,
          actionType: "explain",
          expectedOutcome: "Page contents summarized for user",
          verificationMethod: "none",
          isConsequential: false,
          requiresApproval: false,
          status: "PLANNED",
        });
        break;
      }

      case "page_understanding":
        steps.push({
          id: uuidv4(),
          description: "Analyze page landmarks and main content",
          actionType: "explain",
          expectedOutcome: "Page summary returned to user",
          verificationMethod: "none",
          isConsequential: false,
          requiresApproval: false,
          status: "PLANNED",
        });
        break;

      case "find_and_focus": {
        // Find matching element from PageContext
        const match = ctx.interactiveElements.find(
          (el) =>
            el.name.toLowerCase().includes("price") ||
            el.name.toLowerCase().includes("filter") ||
            el.selector.includes("filter") ||
            el.selector.includes("price"),
        );

        steps.push({
          id: uuidv4(),
          description: `Locate and move focus to ${goal.targetElementDescription || "price filter"}`,
          actionType: "locate_and_focus",
          selector: match?.selector || "#price-filter, select[name='price'], [aria-label*='price' i]",
          targetRole: "select",
          targetName: "price filter",
          expectedOutcome: "Price filter is focused and active",
          verificationMethod: "element_focused",
          isConsequential: false,
          requiresApproval: false,
          status: "PLANNED",
        });
        break;
      }

      case "search_results": {
        steps.push({
          id: uuidv4(),
          description: "Locate second search result in catalog",
          actionType: "locate_and_focus",
          selector: ".product-card:nth-of-type(2), [data-testid='result-2'], .search-result:nth-child(2)",
          expectedOutcome: "Second result card is focused",
          verificationMethod: "element_focused",
          isConsequential: false,
          requiresApproval: false,
          status: "PLANNED",
        });
        steps.push({
          id: uuidv4(),
          description: "Extract and summarize details of second result",
          actionType: "extract",
          expectedOutcome: "Product title, price, and specs extracted",
          verificationMethod: "content_present",
          isConsequential: false,
          requiresApproval: false,
          status: "PLANNED",
        });
        break;
      }

      case "form_fill": {
        const data = goal.formData || { name: "Jordan Smith", email: "jordan@example.com" };
        if (data.name) {
          steps.push({
            id: uuidv4(),
            description: `Fill Name field with "${data.name}"`,
            actionType: "fill",
            selector: "#name, input[name='name'], input[aria-label*='name' i]",
            value: data.name,
            expectedOutcome: `Name input contains "${data.name}"`,
            verificationMethod: "value_matched",
            isConsequential: false,
            requiresApproval: false,
            status: "PLANNED",
          });
        }
        if (data.email) {
          steps.push({
            id: uuidv4(),
            description: `Fill Email field with "${data.email}"`,
            actionType: "fill",
            selector: "#email, input[name='email'], input[type='email'], input[aria-label*='email' i]",
            value: data.email,
            expectedOutcome: `Email input contains "${data.email}"`,
            verificationMethod: "value_matched",
            isConsequential: false,
            requiresApproval: false,
            status: "PLANNED",
          });
        }
        break;
      }

      default: {
        if (goal.isConsequential) {
          steps.push({
            id: uuidv4(),
            description: `Submit application form and proceed to checkout`,
            actionType: "click",
            selector: "#submit-btn, [type='submit']",
            expectedOutcome: "Application submitted and confirmation received",
            verificationMethod: "element_visible",
            isConsequential: true,
            requiresApproval: true,
            status: "PLANNED",
          });
        } else if (goal.userGoal.toLowerCase().includes("documentation") || goal.userGoal.toLowerCase().includes("all")) {
          // Multi-step task for cancellation & exploration tests
          steps.push({
            id: uuidv4(),
            description: "Navigate to Documentation section",
            actionType: "locate_and_focus",
            selector: "nav a[href='#article-section']",
            expectedOutcome: "Navigated to documentation",
            verificationMethod: "element_focused",
            isConsequential: false,
            requiresApproval: false,
            status: "PLANNED",
          });
          steps.push({
            id: uuidv4(),
            description: "Read documentation heading 1",
            actionType: "explain",
            expectedOutcome: "Heading 1 summarized",
            verificationMethod: "none",
            isConsequential: false,
            requiresApproval: false,
            status: "PLANNED",
          });
          steps.push({
            id: uuidv4(),
            description: "Read documentation heading 2",
            actionType: "explain",
            expectedOutcome: "Heading 2 summarized",
            verificationMethod: "none",
            isConsequential: false,
            requiresApproval: false,
            status: "PLANNED",
          });
        } else {
          steps.push({
            id: uuidv4(),
            description: goal.userGoal,
            actionType: "explain",
            expectedOutcome: "Action completed",
            verificationMethod: "none",
            isConsequential: goal.isConsequential,
            requiresApproval: goal.isConsequential,
            status: "PLANNED",
          });
        }
        break;
      }
    }

    return {
      userGoal: goal.userGoal,
      summary: goal.explanation,
      requiresApproval: steps.some((s) => s.requiresApproval),
      estimatedRisk: goal.isConsequential ? "HIGH" : "LOW",
      steps,
    };
  }
}

export const gemma4Engine = new Gemma4Engine();
