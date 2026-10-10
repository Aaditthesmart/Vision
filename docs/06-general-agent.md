# General Agent — Navigation, Summarization, Education & Healthcare

> The Swiss army knife. Handles everything that isn't shopping: page reading, content summarization, LMS navigation, search, form filling, condition-aware browsing, and medication awareness — covering the Education, Perplexity, Decagon, and Healthcare prize tracks.

---

## Responsibilities

1. Page content summarization and key point extraction
2. LMS navigation (Canvas, Coursera) for the Education track
3. Search result processing and ranking
4. Form filling and general navigation
5. Article reading with progressive disclosure
6. Content filtering (skip ads, cookie banners, irrelevant sections)
7. **Healthcare/medical**: condition-aware browsing, medication safety awareness using user profile data
8. Spatial page description (layout-aware, not sequential DOM reading)

---

## I/O Contract

```typescript
// ── INPUT (from LangGraph state, set by Supervisor) ──────────
interface GeneralAgentInput {
  intent: { category: "general"; subIntent: string; entities: Record<string, string>; };
  stagehand: StagehandInstance;          // Browser control (via ExecutionContext only)
  userProfile: UserProfile;              // Preferences, medical conditions, medications
  conversationHistory: ConversationTurn[];
  onAction: (action: { description: string; agent: "general" }) => void;
  abortSignal: AbortSignal;
}

// ── OUTPUT (partial LangGraph state update) ──────────────────
interface GeneralAgentOutput {
  agentResponse: string;         // Plain English speech text (no markdown, no visual refs)
  suggestedActions: string[];    // Voice menu: ["Read more", "Search again", ...]
  browserActions: BrowserAction[]; // Log of actions taken
}
```

**Rules:**
- MUST NOT interact with Socket.io or produce audio — returns text only.
- MUST respect user profile preferences for summary verbosity.
- MUST avoid visual references ("as you can see") — user is blind.
- MUST strip ads/nav/footers when extracting page content.
- MUST include safety disclaimers for medical/health responses ("consult your doctor").
- On error, return a speakable `agentResponse` — never throw.

---

## Sub-Intents

| Sub-Intent | Description | Example Utterance |
|------------|-------------|-------------------|
| `summarize` | Summarize current page or article | "Read this article", "What's on this page?" |
| `navigate` | Go to a specific page or site | "Go to Canvas", "Open my email" |
| `search` | Perform a web search | "Search for restaurants near me" |
| `lms_assignments` | Check LMS assignments | "What's due this week?" |
| `lms_read` | Read LMS content | "Read the CS 229 announcement" |
| `form_fill` | Fill out a form | "Fill this form with my info" |
| `read_more` | Continue reading / expand content | "Read the next section" |
| `scroll` | Scroll through content | "Scroll down", "Go to the top" |
| `health_query` | Answer condition-related questions | "Is this safe with my medications?" |
| `medication_info` | Get info about a medication | "Tell me about my Metformin dosage" |

---

## Agent Node Implementation

```typescript
async function generalAgentNode(state: typeof AgentState.State) {
  const { intent, stagehand, userProfile, onAction, abortSignal } = state;

  switch (intent.subIntent) {
    case "summarize":
      return await handleSummarize(stagehand, userProfile, onAction);

    case "navigate":
      return await handleNavigate(intent.entities, stagehand, onAction);

    case "search":
      return await handleSearch(intent.entities, stagehand, userProfile, onAction);

    case "lms_assignments":
      return await handleLMSAssignments(stagehand, onAction);

    case "lms_read":
      return await handleLMSRead(intent.entities, stagehand, onAction);

    case "form_fill":
      return await handleFormFill(stagehand, userProfile, onAction);

    case "read_more":
      return await handleReadMore(stagehand, state.conversationHistory, onAction);

    case "health_query":
      return await handleHealthQuery(intent.entities, userProfile, stagehand, onAction);

    case "medication_info":
      return await handleMedicationInfo(intent.entities, userProfile);

    default:
      return await handleGenericBrowsing(state);
  }
}
```

---

## Handler: Page Summarization

```typescript
async function handleSummarize(
  stagehand: StagehandInstance,
  userProfile: UserProfile,
  onAction: ActionCallback,
) {
  onAction({ description: "Reading page content", agent: "general" });

  // Step 1: Extract the main content (skip nav, ads, footers)
  const pageContent = await stagehand.extract({
    instruction: `Extract the main content of this page. Focus on:
      - Article text (if it's an article)
      - Main product/service description (if it's a product page)
      - Key information and data points
      Skip: navigation menus, ads, cookie banners, footers, sidebars`,
    schema: z.object({
      title: z.string(),
      type: z.enum(["article", "product", "search_results", "form", "dashboard", "other"]),
      mainContent: z.string(),
      keyPoints: z.array(z.string()),
      metadata: z.object({
        author: z.string().optional(),
        date: z.string().optional(),
        readingTime: z.string().optional(),
      }).optional(),
    }),
  });

  // Step 2: Generate TTS-optimized summary via Claude Sonnet
  const model = new ChatAnthropic({ modelName: "claude-sonnet-4-5-20250929" });

  const summary = await model.invoke([
    {
      role: "system",
      content: `Summarize web page content for a blind user who is listening via text-to-speech.
Use natural speech patterns. Avoid visual references ("as you can see", "the image shows").
Start with the page type and title, then key points in 3-5 sentences.
Keep it concise — this will be spoken aloud.`
    },
    {
      role: "user",
      content: `Page title: ${pageContent.title}\nType: ${pageContent.type}\n\nContent:\n${pageContent.mainContent}`,
    },
  ]);

  return {
    agentResponse: summary.content as string,
    suggestedActions: [
      "Read the full text",
      "Tell me more about a specific section",
      "Go to the next page",
      "Search for something else",
    ],
  };
}
```

---

## Handler: LMS Assignments (Education Track)

```typescript
const AssignmentSchema = z.object({
  assignments: z.array(z.object({
    course: z.string(),
    title: z.string(),
    dueDate: z.string(),
    status: z.enum(["submitted", "not_submitted", "late", "graded"]),
    points: z.string().optional(),
    description: z.string().optional(),
  })),
  announcements: z.array(z.object({
    course: z.string(),
    title: z.string(),
    date: z.string(),
    preview: z.string(),
  })).optional(),
});

async function handleLMSAssignments(
  stagehand: StagehandInstance,
  onAction: ActionCallback,
) {
  onAction({ description: "Opening Canvas dashboard", agent: "general" });
  await stagehand.page.goto("https://canvas.stanford.edu");

  onAction({ description: "Checking upcoming assignments", agent: "general" });
  await stagehand.act({ action: "go to the upcoming assignments or to-do list" });

  onAction({ description: "Reading assignment details", agent: "general" });
  const data = await stagehand.extract({
    instruction: "Extract all upcoming assignments with course name, title, due date, and submission status. Also get any recent announcements.",
    schema: AssignmentSchema,
  });

  // Sort by urgency (due soonest first)
  const sorted = [...data.assignments]
    .filter(a => a.status !== "submitted" && a.status !== "graded")
    .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());

  let response = "";
  if (sorted.length === 0) {
    response = "You're all caught up! No pending assignments.";
  } else {
    const urgent = sorted.filter(a => {
      const hoursUntilDue = (new Date(a.dueDate).getTime() - Date.now()) / (1000 * 60 * 60);
      return hoursUntilDue < 48;
    });

    if (urgent.length > 0) {
      response += `Urgent: ${urgent.length} assignment${urgent.length > 1 ? "s" : ""} due within 48 hours. `;
      urgent.forEach((a, i) => {
        response += `${i + 1}. ${a.course}: ${a.title}, due ${a.dueDate}. `;
      });
    }

    const upcoming = sorted.filter(a => !urgent?.includes(a));
    if (upcoming.length > 0) {
      response += `You also have ${upcoming.length} more coming up. `;
    }
  }

  if (data.announcements?.length) {
    response += `There are ${data.announcements.length} new announcements. `;
    response += `Most recent: ${data.announcements[0].course} - ${data.announcements[0].title}. `;
  }

  response += "Which would you like to work on, or should I read an announcement?";

  return {
    agentResponse: response,
    suggestedActions: [
      ...sorted.slice(0, 2).map(a => `Work on ${a.course} ${a.title}`),
      data.announcements?.length ? "Read announcements" : null,
    ].filter(Boolean),
  };
}
```

---

## Handler: Web Search

```typescript
async function handleSearch(
  entities: Record<string, string>,
  stagehand: StagehandInstance,
  userProfile: UserProfile,
  onAction: ActionCallback,
) {
  const { query } = entities;

  onAction({ description: `Searching for "${query}"`, agent: "general" });
  await stagehand.page.goto("https://www.google.com");
  await stagehand.act({ action: `search for "${query}"` });

  onAction({ description: "Reading search results", agent: "general" });
  const results = await stagehand.extract({
    instruction: "Extract the top 5 search results with title, URL, and description snippet",
    schema: z.object({
      results: z.array(z.object({
        title: z.string(),
        url: z.string(),
        snippet: z.string(),
      })),
      featuredSnippet: z.string().optional(),
    }),
  });

  let response = "";
  if (results.featuredSnippet) {
    response += `Quick answer: ${results.featuredSnippet}. `;
  }

  // Summarize results via Claude Sonnet
  const model = new ChatAnthropic({ modelName: "claude-sonnet-4-5-20250929" });
  const aiSummary = await model.invoke([
    {
      role: "system",
      content: `Summarize these search results for a blind user via TTS.
Be concise: 2-4 sentences total. Highlight the most useful result.`
    },
    {
      role: "user",
      content: `Search query: "${query}"\n\nResults:\n${results.results.map((r, i) => `${i + 1}. ${r.title}: ${r.snippet}`).join("\n")}`,
    },
  ]);

  response += aiSummary.content as string;

  return {
    agentResponse: response,
    suggestedActions: results.results.slice(0, 3).map(r => `Open ${r.title}`),
  };
}
```

---

## Handler: Healthcare / Condition-Aware Browsing

The General Agent handles medical and health queries using the user's profile data. There is no separate Medical Agent — healthcare is a capability of the General Agent.

```typescript
async function handleHealthQuery(
  entities: Record<string, string>,
  userProfile: UserProfile,
  stagehand: StagehandInstance,
  onAction: ActionCallback,
) {
  // Extract product ingredients from the current page if relevant
  onAction({ description: "Analyzing product for safety", agent: "general" });

  const productInfo = await stagehand.extract({
    instruction: "Extract the product name, active ingredients, warnings, and drug facts from this page",
    schema: z.object({
      name: z.string(),
      activeIngredients: z.array(z.string()),
      warnings: z.array(z.string()).optional(),
    }),
  });

  // Use Claude Sonnet with medical context from user profile
  const model = new ChatAnthropic({ modelName: "claude-sonnet-4-5-20250929" });

  const response = await model.invoke([
    {
      role: "system",
      content: `You are a health information assistant (NOT a doctor).
The user has these conditions: ${JSON.stringify(userProfile.preferences)}.
${userProfile.preferences.medications ? `They take: ${userProfile.preferences.medications}` : ""}

Check if the product's active ingredients have known interactions with the user's medications.
Be concise (2-3 sentences) for text-to-speech. ALWAYS recommend consulting their doctor.
NEVER diagnose or prescribe.`
    },
    {
      role: "user",
      content: `Product: ${productInfo.name}\nActive ingredients: ${productInfo.activeIngredients.join(", ")}\n\nUser question: ${entities.query || "Is this safe with my medications?"}`,
    },
  ]);

  return {
    agentResponse: response.content as string,
    suggestedActions: ["Find safe alternative", "Tell me more", "Go back to shopping"],
  };
}
```

**Healthcare Demo Scenario (Healthcare $4k prize):**
```
User: "Search for cold medicine"
  → General Agent browses pharmacy site with user profile context
  → "I found several cold medicines. Note: your profile shows you take
     Lisinopril, so products with pseudoephedrine like Sudafed may raise
     your blood pressure. Coricidin HBP is a common alternative at $9.99.
     Always check with your doctor. Want more details?"
```

The General Agent provides condition-aware browsing by injecting the user's medical profile into its system prompt, enabling it to flag potential issues without needing a dedicated medical agent.

---

## Handler: Form Filling

```typescript
async function handleFormFill(
  stagehand: StagehandInstance,
  userProfile: UserProfile,
  onAction: ActionCallback,
) {
  onAction({ description: "Analyzing form fields", agent: "general" });

  const formFields = await stagehand.extract({
    instruction: "Extract all form fields: label, type, whether required, current value, options for select/radio",
    schema: z.object({
      formTitle: z.string().optional(),
      fields: z.array(z.object({
        label: z.string(),
        type: z.string(),
        required: z.boolean(),
        currentValue: z.string().optional(),
        options: z.array(z.string()).optional(),
      })),
    }),
  });

  const autoFillable = formFields.fields.filter(f => canAutoFill(f, userProfile));
  const needsInput = formFields.fields.filter(f => !canAutoFill(f, userProfile) && f.required);

  let response = `This form has ${formFields.fields.length} fields. `;
  response += `I can auto-fill ${autoFillable.length} from your profile. `;

  if (needsInput.length > 0) {
    response += `I still need: ${needsInput.map(f => f.label).join(", ")}. `;
    response += `What would you like for ${needsInput[0].label}?`;
  } else {
    response += "I have everything needed. Should I fill it in?";
  }

  return {
    agentResponse: response,
    suggestedActions: [
      "Fill it in",
      needsInput.length > 0 ? `Tell me the ${needsInput[0].label}` : null,
      "Skip this form",
    ].filter(Boolean),
  };
}
```

---

## Interaction with Other Layers

| Layer | Interaction | Details |
|-------|-------------|---------|
| **LangGraph Supervisor** | Receives routed general intents | Called as graph node via Haiku classification |
| **Execution Layer (Stagehand)** | All browsing operations | `act()`, `extract()`, `observe()`, `page.goto()` |
| **Knowledge Base** | User preferences, medical data | Verbosity, conditions, medications for context |
| **Claude Sonnet** | Content summarization, health reasoning | Multi-step reasoning for complex queries |
| **Commerce Agent** | Hand-off for purchases from search | If user finds something to buy, supervisor reroutes |

---

## Stagehand Usage Patterns

| Operation | Stagehand Method | Notes |
|-----------|-----------------|-------|
| Read page | `extract()` with content schema | Filters out nav, ads, footers |
| Navigate | `page.goto()` or `act("go to X")` | Direct URL when known, `act()` for fuzzy |
| Fill forms | `act("fill X with Y")` | Field by field for accuracy |
| Scroll | `act("scroll down")` | For lazy-loaded content |
| Dismiss popups | `act("dismiss/close popup")` | Cookie banners, modals |
| Click links | `act("click on X")` | For navigation within a site |
