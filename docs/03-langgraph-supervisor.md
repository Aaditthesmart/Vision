# LangGraph Supervisor — Intent Routing & Agent Coordination

> The traffic controller. Classifies each user message with Claude Haiku for sub-200ms routing, dispatches to Commerce or General specialist agents powered by Claude Sonnet, and formats responses for TTS.

---

## Responsibilities

1. Classify user intent from natural language + conversation context (Claude Haiku)
2. Route to the correct specialist agent: Commerce or General
3. Coordinate multi-turn workflows with conversation history
4. Handle agent hand-offs (e.g., user starts shopping then asks a general question)
5. Format agent responses for clean TTS output (strip markdown, URLs, list markers)
6. Inject user profile context into agent prompts

---

## I/O Contract

```typescript
// ── INPUT (from Orchestrator — server/src/index.ts) ─────────
interface SupervisorInput {
  userInput: string;                       // The final transcript
  conversationHistory: ConversationTurn[]; // Last N turns for context
  userProfile: UserProfile | null;         // From seed profile (Phase 6: Elasticsearch)
  pageSnapshot: PageSnapshot | null;       // Current browser state (null if unknown)
}

interface ConversationTurn {
  role: "user" | "assistant";
  text: string;
  agent?: string;    // Which agent handled this turn
  timestamp: number;
}

interface PageSnapshot {
  url: string;
  title: string;
  description?: string;
}

interface UserProfile {
  name: string;
  preferences: Record<string, string>;   // budget, currency, preferredStores, etc.
  accessibility: { screenReader: boolean; voiceOnly: boolean };
}

// ── OUTPUT (to Orchestrator) ────────────────────────────────
type AgentCategory = "commerce" | "general";

interface SupervisorResult {
  responseText: string;        // TTS-ready text (markdown stripped, voice-formatted)
  agentCategory: AgentCategory;
  actions?: string[];
}
```

**Rules:**
- Supervisor MUST always return a `responseText` — even on error, it must be a speakable sentence.
- Supervisor MUST populate `agentCategory` so the orchestrator can track routing.
- `conversationHistory` is append-only — the supervisor MUST NOT mutate it. The orchestrator owns history.
- If the supervisor cannot determine intent, it MUST route to `"general"` as the default.
- The `formatResponse` node strips markdown, URLs, and list markers for clean TTS output.

---

## Architecture: LangGraph StateGraph

```
                    ┌─────────────┐
                    │   START     │
                    └──────┬──────┘
                           │
                           ▼
                  ┌─────────────────┐
                  │   CLASSIFY      │  ← Claude Haiku (sub-200ms intent classification)
                  │                 │
                  └────────┬────────┘
                           │
              ┌────────────┴────────────┐
              ▼                         ▼
     ┌──────────────┐          ┌──────────────┐
     │  COMMERCE    │          │  GENERAL     │
     │  AGENT       │          │  AGENT       │
     │  (Sonnet)    │          │  (Sonnet)    │
     └──────┬───────┘          └──────┬───────┘
              │                       │
              └───────────┬───────────┘
                          ▼
                 ┌─────────────────┐
                 │ FORMAT RESPONSE │  ← Strip markdown, voice-format
                 └────────┬────────┘
                          │
                          ▼
                   ┌─────────────┐
                   │    END      │
                   └─────────────┘
```

**Flow:** `START → classify (Haiku) → [conditional: commerce|general] → formatResponse → END`

---

## State Definition

```typescript
import { Annotation } from "@langchain/langgraph";

const AgentState = Annotation.Root({
  // Input
  userMessage: Annotation<string>,
  conversationHistory: Annotation<ConversationTurn[]>,
  userProfile: Annotation<UserProfile>,
  pageSnapshot: Annotation<PageSnapshot | null>,

  // Classification
  classification: Annotation<ClassificationResult>,

  // Agent execution
  agentResponse: Annotation<string>,
  agentCategory: Annotation<AgentCategory>,
  actions: Annotation<string[]>,
});

interface ClassificationResult {
  category: AgentCategory;
  subIntent: string;        // e.g., "product_search", "navigate", "summarize"
  entities: Record<string, string>;  // e.g., { product: "headphones", budget: "100" }
}
```

---

## Classify Node (Claude Haiku)

The classifier uses Claude Haiku for sub-200ms intent classification:

```typescript
import { ChatAnthropic } from "@langchain/anthropic";

const classifierModel = new ChatAnthropic({
  modelName: "claude-haiku-4-5-20251001",  // Sub-200ms classification
  temperature: 0,
});

async function classifyNode(state: typeof AgentState.State) {
  const response = await classifierModel.invoke([
    {
      role: "system",
      content: `You are an intent classifier for a voice-controlled browser assistant.

Given the user's message and conversation history, determine:
1. Which specialist agent should handle this: commerce or general
2. The specific sub-intent
3. Key entities extracted from the message

User profile: ${JSON.stringify(state.userProfile)}

Routing rules:
- COMMERCE: Anything involving buying, shopping, cart, checkout, prices, products, budget
- GENERAL: Everything else — page reading, summarization, navigation, education, search,
  form filling, health questions, medication info, general browsing

If ambiguous, default to GENERAL.

Respond with JSON: { "category": "...", "subIntent": "...", "entities": {...} }`
    },
    ...state.conversationHistory.map(m => ({ role: m.role, content: m.text })),
    { role: "user", content: state.userMessage },
  ]);

  const classification = JSON.parse(response.content as string);

  return {
    classification,
    agentCategory: classification.category,
  };
}
```

**Key design decisions:**
- Uses **Haiku** for classification (sub-200ms, cheap) — agents use **Sonnet** for reasoning
- Conversation history provides context for ambiguous messages (e.g., "add it" after browsing)
- Entity extraction so agents don't need to re-parse the user's message
- Default to `"general"` for anything ambiguous

---

## Agent Nodes (Claude Sonnet)

Each agent node uses Claude Sonnet for multi-step reasoning:

```typescript
const agentModel = new ChatAnthropic({
  modelName: "claude-sonnet-4-5-20250929",  // Strong reasoning for multi-step tasks
  temperature: 0.2,
});

async function commerceAgentNode(state: typeof AgentState.State) {
  // Commerce agent with system prompt for shopping, cart, checkout, budget
  // See 04-commerce-agent.md for full implementation
  const response = await agentModel.invoke([...]);
  return { agentResponse: response.content, actions: [...] };
}

async function generalAgentNode(state: typeof AgentState.State) {
  // General agent handles navigation, summarization, search, education,
  // health/medication questions, form filling
  // See 06-general-agent.md for full implementation
  const response = await agentModel.invoke([...]);
  return { agentResponse: response.content, actions: [...] };
}
```

---

## Response Formatter Node

```typescript
async function formatResponseNode(state: typeof AgentState.State) {
  let text = state.agentResponse;

  // Strip markdown formatting
  text = text.replace(/\*\*(.*?)\*\*/g, "$1");  // Bold
  text = text.replace(/\*(.*?)\*/g, "$1");        // Italic
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");  // Links
  text = text.replace(/^[-*]\s/gm, "");           // List markers
  text = text.replace(/^#{1,6}\s/gm, "");         // Headings
  text = text.replace(/`([^`]+)`/g, "$1");         // Code

  // Append suggested actions as spoken menu
  if (state.actions?.length) {
    const actionsText = state.actions
      .map((a, i) => `${i + 1}, ${a}`)
      .join(". ");
    text += ` You can say: ${actionsText}. Or tell me something else.`;
  }

  return { agentResponse: text };
}
```

---

## Graph Construction

```typescript
import { StateGraph } from "@langchain/langgraph";

function buildSupervisorGraph() {
  const graph = new StateGraph(AgentState)
    .addNode("classify", classifyNode)
    .addNode("commerce", commerceAgentNode)
    .addNode("general", generalAgentNode)
    .addNode("formatResponse", formatResponseNode);

  // Entry point
  graph.addEdge("__start__", "classify");

  // Conditional routing based on classification
  graph.addConditionalEdges("classify", (state) => {
    return state.classification.category;
  }, {
    commerce: "commerce",
    general: "general",
  });

  // Both agents route to response formatter
  graph.addEdge("commerce", "formatResponse");
  graph.addEdge("general", "formatResponse");

  graph.addEdge("formatResponse", "__end__");

  return graph.compile();
}
```

---

## Public Interface

```typescript
// Called by the server orchestrator (server/src/index.ts)

export async function runSupervisor(input: SupervisorInput): Promise<SupervisorResult> {
  const graph = buildSupervisorGraph();

  const result = await graph.invoke({
    userMessage: input.userInput,
    conversationHistory: input.conversationHistory,
    userProfile: input.userProfile,
    pageSnapshot: input.pageSnapshot,
    agentResponse: "",
    agentCategory: "general",
    actions: [],
    classification: null,
  });

  return {
    responseText: result.agentResponse,
    agentCategory: result.agentCategory,
    actions: result.actions,
  };
}
```

---

## Multi-Turn Workflow Handling

The supervisor uses conversation history to maintain context across turns:

```
Turn 1: "Search for headphones under $200"
  → Classify: commerce / product_search / { product: "headphones", budget: "$200" }
  → Commerce Agent: searches, extracts products, returns comparison

Turn 2: "Tell me more about the Sony ones"
  → Classify: commerce / product_detail / { product: "Sony WH-1000XM5" }
  → Commerce Agent: extracts detailed info

Turn 3: "Now read this article"
  → Classify: general / summarize / {}
  → General Agent: extracts and summarizes page content

Turn 4: "Add the headphones to cart"
  → Classify: commerce / add_to_cart / { product: "Sony WH-1000XM5" }
  → Commerce Agent: resolves reference from conversation history, adds to cart
```

---

## Interaction with Other Layers

| Layer | Interaction | Details |
|-------|-------------|---------|
| **Server Layer** | Called by socket handler | `runSupervisor()` is the single entry point |
| **Commerce Agent** | Routed to by classifier | Conditional edge based on Haiku classification |
| **General Agent** | Routed to by classifier | Conditional edge based on Haiku classification |
| **Execution Layer** | Passed through to agents | Stagehand instance flows through state |
| **Knowledge Base** | User profile injected | Profile loaded at server startup, passed in |
| **Claude Haiku** | Used by classify node | Sub-200ms intent classification |
| **Claude Sonnet** | Used by agent nodes | Multi-step reasoning and planning |

The supervisor **never** directly calls Stagehand or Cartesia. It delegates execution to specialist agents and audio to the server layer.

---

## Performance Considerations

- Haiku classification: ~100-200ms (optimized for routing)
- Sonnet agent reasoning: ~500ms-2s depending on complexity
- Browser actions via Stagehand: 1-5s per action
- Total turn latency target: < 3s from voice input to first audio chunk
