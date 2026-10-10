import { Annotation, StateGraph } from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";
import { createCommerceAgent } from "./commerce.js";
import { createCodingAgent } from "./coding.js";
import { createGeneralAgent } from "./general.js";
import { createDesktopAgent } from "./desktop.js";
import { createDocumentationAgent } from "./documentation.js";
import type { RunnableConfig } from "@langchain/core/runnables";
import type {
  ConversationTurn,
  PageSnapshot,
  UserProfile,
  AgentCategory,
  ClassificationResult,
  SupervisorResult,
  ExecutionContext,
  InterimSpeechCallback,
  KnowledgeBase,
} from "../types/index.js";

// ── State ─────────────────────────────────────────────────────

const SupervisorState = Annotation.Root({
  userInput: Annotation<string>,
  conversationHistory: Annotation<ConversationTurn[]>({
    reducer: (_prev: ConversationTurn[], next: ConversationTurn[]) => next,
    default: () => [],
  }),
  classification: Annotation<ClassificationResult | null>({
    reducer: (
      _prev: ClassificationResult | null,
      next: ClassificationResult | null,
    ) => next,
    default: () => null,
  }),
  responseText: Annotation<string>({
    reducer: (_prev: string, next: string) => next,
    default: () => "",
  }),
  agentCategory: Annotation<AgentCategory>({
    reducer: (_prev: AgentCategory, next: AgentCategory) => next,
    default: () => "general" as AgentCategory,
  }),
  userProfile: Annotation<UserProfile | null>({
    reducer: (_prev: UserProfile | null, next: UserProfile | null) => next,
    default: () => null,
  }),
  pageSnapshot: Annotation<PageSnapshot | null>({
    reducer: (_prev: PageSnapshot | null, next: PageSnapshot | null) => next,
    default: () => null,
  }),
  memoryContext: Annotation<string>({
    reducer: (_prev: string, next: string) => next,
    default: () => "",
  }),
  secondaryCategory: Annotation<AgentCategory | null>({
    reducer: (_prev: AgentCategory | null, next: AgentCategory | null) => next,
    default: () => null,
  }),
  agentPhase: Annotation<number>({
    reducer: (_prev: number, next: number) => next,
    default: () => 0,
  }),
  scopedInput: Annotation<string>({
    reducer: (_prev: string, next: string) => next,
    default: () => "",
  }),
});

type SupervisorStateType = typeof SupervisorState.State;

// ── Classifier Model ─────────────────────────────────────────

const classifierModel = new ChatOpenAI({
  model: "gpt-4.1-mini",
  temperature: 0,
  maxTokens: 256,
});

// ── Helpers ──────────────────────────────────────────────────

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

// ── Classify system prompt ───────────────────────────────────

const CLASSIFY_SYSTEM = `You are an intent classifier for a voice-first accessible browser assistant.

Classify the user's message into one of these categories:
- "commerce": shopping, buying products, comparing prices, adding to cart, checkout, product search, budget/price questions, store navigation (Amazon, Best Buy, etc.)
- "coding": programming tasks done via file I/O and shell commands — reading code, writing/editing files, fixing compilation errors, running tests, running terminal commands, searching the codebase, debugging, explaining code. Use coding ONLY when the user does NOT ask to open or interact with a specific app.
- "desktop": tasks requiring visual GUI control — opening/switching apps (e.g. "open VS Code", "open Terminal", "open Spotify"), clicking UI buttons, typing in a visible app, controlling any desktop application. IMPORTANT: if the user says "open [app name]" or wants to interact with a specific application window, ALWAYS classify as desktop, even if the task also involves coding. EXCEPTION: anything involving the Notes app goes to "documentation" instead.
- "documentation": anything involving Apple Notes — opening Notes, creating notes, writing things down, documenting, saving text to Notes app, "write this down", "make a note", "take notes", "open Notes and write...". The documentation agent handles opening Apple Notes itself, so ALWAYS classify as documentation (not desktop) when Notes is involved, even if the user says "open Notes". This includes compound requests like "open Notes and write X" — classify the ENTIRE thing as documentation with NO secondaryCategory.
- "general": everything else — web navigation, search, page description, reading content, articles, forms, general questions

Return a JSON object with:
- category: "commerce", "coding", "desktop", "documentation", or "general"
- secondaryCategory: (optional) if the task has two distinct parts requiring different agents, set this to the category for the SECOND part. Only set this when there are clearly two separate actions. Example: "open VS Code and write a Java function" → category: "desktop", secondaryCategory: "coding". Example: "search for project tips and write them down in Notes" → category: "general", secondaryCategory: "documentation". Example: "search Amazon for headphones" → category: "commerce", no secondaryCategory needed.
- primaryTask: (required when secondaryCategory is set) the specific instruction for the FIRST agent only. Example: "open Visual Studio Code"
- secondaryTask: (required when secondaryCategory is set) the specific instruction for the SECOND agent only. Example: "write a simple Java function"
- subIntent: a short label for the PRIMARY task only (e.g. "product_search", "debug_error", "open_app", "navigate", "summarize"). When secondaryCategory is set, this should describe ONLY the first agent's action (e.g. "open_app", NOT "open_app_and_code").
- secondarySubIntent: (required when secondaryCategory is set) a short label for the SECOND task only (e.g. "write_code", "debug_error")
- entities: key-value pairs of extracted entities (e.g. {"product": "headphones", "budget": "100"})

Only return the JSON. No explanation.`;

// ── Node 3: Format for voice ────────────────────────────────

function formatResponse(
  state: SupervisorStateType,
): Partial<SupervisorStateType> {
  let text = state.responseText;

  // Strip markdown
  text = text.replace(/\*\*(.*?)\*\*/g, "$1");
  text = text.replace(/\*(.*?)\*/g, "$1");
  text = text.replace(/`(.*?)`/g, "$1");

  // Remove URLs
  text = text.replace(/https?:\/\/\S+/g, "");

  // Remove list markers
  text = text.replace(/^[-*•]\s+/gm, "");
  text = text.replace(/^\d+\.\s+/gm, "");

  // Ensure sentences end with punctuation
  text = text.replace(/([^.!?])\s*$/gm, "$1.");

  // Clean up extra whitespace
  text = text.replace(/\n+/g, " ").replace(/\s{2,}/g, " ").trim();

  return { responseText: text };
}

// ── Router (3-way) ──────────────────────────────────────────

function routeByCategory(
  state: SupervisorStateType,
): "commerceAgent" | "codingAgent" | "generalAgent" | "desktopAgent" | "documentationAgent" {
  switch (state.agentCategory) {
    case "commerce":
      return "commerceAgent";
    case "coding":
      return "codingAgent";
    case "desktop":
      return "desktopAgent";
    case "documentation":
      return "documentationAgent";
    default:
      return "generalAgent";
  }
}

// ── Recheck Node (compound task chaining) ───────────────────

function recheckNode(
  state: SupervisorStateType,
): Partial<SupervisorStateType> {
  if (
    state.agentPhase === 0 &&
    state.secondaryCategory &&
    state.secondaryCategory !== state.agentCategory
  ) {
    const secondaryTask = state.classification?.secondaryTask || state.userInput;
    console.log(`[supervisor] chaining → ${state.secondaryCategory} (task: "${secondaryTask}")`);
    return {
      agentCategory: state.secondaryCategory,
      agentPhase: 1,
      scopedInput: secondaryTask,
    };
  }
  return { agentPhase: 2 };
}

function recheckRouter(
  state: SupervisorStateType,
): "commerceAgent" | "codingAgent" | "generalAgent" | "desktopAgent" | "documentationAgent" | "formatResponse" {
  if (state.agentPhase === 1) {
    return routeByCategory(state);
  }
  return "formatResponse";
}

// ── Graph Factory ───────────────────────────────────────────

/**
 * Create a compiled LangGraph supervisor with 3-way routing.
 * Pass executionContext to give agents browser control.
 * Pass null to run in text-only mode (no Stagehand).
 */
export function createSupervisor(
  executionContext: ExecutionContext | null,
  kb: KnowledgeBase | null = null,
  workspacePath: string = process.env.WORKSPACE_PATH || process.cwd(),
) {
  // Node 1: Classify intent + fetch memory context in parallel (0ms added latency)
  async function classify(
    state: SupervisorStateType,
    config?: RunnableConfig,
  ): Promise<Partial<SupervisorStateType>> {
    const historyContext = state.conversationHistory
      .slice(-6)
      .map((t: ConversationTurn) => `${t.role}: ${t.text}`)
      .join("\n");

    const prompt = historyContext
      ? `Conversation so far:\n${historyContext}\n\nNew user message: "${state.userInput}"`
      : `User message: "${state.userInput}"`;

    const sessionId = (config?.configurable?.sessionId as string) ?? undefined;

    // Run classification and memory fetch in parallel
    const [response, memoryContext] = await Promise.all([
      classifierModel.invoke([
        { role: "system", content: CLASSIFY_SYSTEM },
        { role: "user", content: prompt },
      ]),
      kb?.fetchMemoryContext(state.userInput, sessionId).catch(() => "") ?? Promise.resolve(""),
    ]);

    let classification: ClassificationResult;
    try {
      let text = extractText(response.content).trim();
      text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
      console.log(`[supervisor] raw classification: ${text}`);
      classification = JSON.parse(text);
      if (!["commerce", "coding", "general", "desktop", "documentation"].includes(classification.category)) {
        classification.category = "general";
      }
    } catch (err) {
      console.warn("[supervisor] classify parse error:", err);
      classification = {
        category: "general",
        subIntent: "unknown",
        entities: {},
      };
    }

    // Validate secondaryCategory
    if (
      classification.secondaryCategory &&
      !["commerce", "coding", "general", "desktop", "documentation"].includes(classification.secondaryCategory)
    ) {
      classification.secondaryCategory = null;
    }

    console.log(
      `[supervisor] classify → ${classification.category} / ${classification.subIntent}` +
        (classification.secondaryCategory ? ` (secondary: ${classification.secondaryCategory})` : ""),
    );
    if (memoryContext) {
      console.log(`[supervisor] memory context: ${memoryContext.slice(0, 100)}...`);
    }

    return {
      classification,
      agentCategory: classification.category,
      secondaryCategory: classification.secondaryCategory || null,
      agentPhase: 0,
      scopedInput: classification.primaryTask || state.userInput,
      memoryContext: memoryContext || "",
    };
  }

  // Create agent node functions with access to browser tools + knowledge base
  const commerceAgentFn = createCommerceAgent(executionContext, kb);
  const codingAgentFn = createCodingAgent(workspacePath);
  const generalAgentFn = createGeneralAgent(executionContext, kb);
  const desktopAgentFn = createDesktopAgent();
  const documentationAgentFn = createDocumentationAgent();

  // Build a scoped state for agents in compound tasks.
  // Overrides userInput AND classification.subIntent so agents only see their portion.
  function buildScopedState(state: SupervisorStateType): SupervisorStateType {
    const scopedInput = state.scopedInput || state.userInput;
    // For compound tasks, swap the subIntent to match the current phase's task
    const isCompound = !!state.secondaryCategory;
    const isSecondPhase = state.agentPhase === 1;
    let scopedSubIntent = state.classification?.subIntent ?? "unknown";
    if (isCompound && isSecondPhase && state.classification?.secondarySubIntent) {
      scopedSubIntent = state.classification.secondarySubIntent;
    }
    return {
      ...state,
      userInput: scopedInput,
      classification: state.classification
        ? { ...state.classification, subIntent: scopedSubIntent }
        : state.classification,
    };
  }

  // Wrap agent functions to match LangGraph node signature.
  // Each wrapper uses buildScopedState so agents only see their part of a compound task.
  async function commerceNode(
    state: SupervisorStateType,
    config?: RunnableConfig,
  ): Promise<Partial<SupervisorStateType>> {
    const interimSpeech = (config?.configurable?.interimSpeech as InterimSpeechCallback) ?? undefined;
    const abortSignal = (config?.configurable?.abortSignal as AbortSignal) ?? undefined;
    const sessionId = (config?.configurable?.sessionId as string) ?? undefined;
    const scopedState = buildScopedState(state);
    const result = await commerceAgentFn(scopedState, interimSpeech, abortSignal, sessionId, state.memoryContext);
    return { responseText: result.responseText };
  }

  async function codingNode(
    state: SupervisorStateType,
    config?: RunnableConfig,
  ): Promise<Partial<SupervisorStateType>> {
    const interimSpeech = (config?.configurable?.interimSpeech as InterimSpeechCallback) ?? undefined;
    const abortSignal = (config?.configurable?.abortSignal as AbortSignal) ?? undefined;
    const sessionId = (config?.configurable?.sessionId as string) ?? undefined;
    const scopedState = buildScopedState(state);
    const result = await codingAgentFn(scopedState, interimSpeech, abortSignal, sessionId, state.memoryContext);
    return { responseText: result.responseText };
  }

  async function generalNode(
    state: SupervisorStateType,
    config?: RunnableConfig,
  ): Promise<Partial<SupervisorStateType>> {
    const interimSpeech = (config?.configurable?.interimSpeech as InterimSpeechCallback) ?? undefined;
    const abortSignal = (config?.configurable?.abortSignal as AbortSignal) ?? undefined;
    const sessionId = (config?.configurable?.sessionId as string) ?? undefined;
    const scopedState = buildScopedState(state);
    const result = await generalAgentFn(scopedState, interimSpeech, abortSignal, sessionId, state.memoryContext);
    return { responseText: result.responseText };
  }

  async function desktopNode(
    state: SupervisorStateType,
    config?: RunnableConfig,
  ): Promise<Partial<SupervisorStateType>> {
    const interimSpeech = (config?.configurable?.interimSpeech as InterimSpeechCallback) ?? undefined;
    const abortSignal = (config?.configurable?.abortSignal as AbortSignal) ?? undefined;
    const scopedState = buildScopedState(state);
    const result = await desktopAgentFn(scopedState, interimSpeech, abortSignal);
    return { responseText: result.responseText };
  }

  async function documentationNode(
    state: SupervisorStateType,
    config?: RunnableConfig,
  ): Promise<Partial<SupervisorStateType>> {
    const interimSpeech = (config?.configurable?.interimSpeech as InterimSpeechCallback) ?? undefined;
    const abortSignal = (config?.configurable?.abortSignal as AbortSignal) ?? undefined;
    const scopedState = buildScopedState(state);
    const result = await documentationAgentFn(scopedState, interimSpeech, abortSignal);
    return { responseText: result.responseText };
  }

  const graph = new StateGraph(SupervisorState)
    .addNode("classify", classify)
    .addNode("commerceAgent", commerceNode)
    .addNode("codingAgent", codingNode)
    .addNode("generalAgent", generalNode)
    .addNode("desktopAgent", desktopNode)
    .addNode("documentationAgent", documentationNode)
    .addNode("recheck", recheckNode)
    .addNode("formatResponse", formatResponse)
    .addEdge("__start__", "classify")
    .addConditionalEdges("classify", routeByCategory)
    .addEdge("commerceAgent", "recheck")
    .addEdge("codingAgent", "recheck")
    .addEdge("generalAgent", "recheck")
    .addEdge("desktopAgent", "recheck")
    .addEdge("documentationAgent", "recheck")
    .addConditionalEdges("recheck", recheckRouter)
    .addEdge("formatResponse", "__end__");

  const compiled = graph.compile();

  console.log(
    `[supervisor] Graph compiled — browser tools: ${executionContext ? "ENABLED" : "DISABLED (text-only)"}, workspace: ${workspacePath}`,
  );

  return compiled;
}

// ── Public API ──────────────────────────────────────────────

/**
 * Run the supervisor graph and return the result.
 * Uses a pre-compiled graph instance.
 */
export async function runSupervisor(
  compiledGraph: ReturnType<typeof createSupervisor>,
  input: {
    userInput: string;
    conversationHistory: ConversationTurn[];
    userProfile: UserProfile | null;
    pageSnapshot: PageSnapshot | null;
  },
  interimSpeech?: InterimSpeechCallback,
  signal?: AbortSignal,
  sessionId?: string,
): Promise<SupervisorResult> {
  const configurable: Record<string, unknown> = {};
  if (interimSpeech) configurable.interimSpeech = interimSpeech;
  if (signal) configurable.abortSignal = signal;
  if (sessionId) configurable.sessionId = sessionId;

  const result = await compiledGraph.invoke(
    {
      userInput: input.userInput,
      conversationHistory: input.conversationHistory,
      userProfile: input.userProfile,
      pageSnapshot: input.pageSnapshot,
    },
    Object.keys(configurable).length > 0 ? { configurable, signal } : undefined,
  );

  return {
    responseText: result.responseText,
    agentCategory: result.agentCategory,
    actions: [],
  };
}
