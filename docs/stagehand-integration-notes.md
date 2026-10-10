# Stagehand Integration: How It Works (and Doesn't Yet)

## Current Voice Pipeline (What Actually Runs)

```
User speaks
  → Deepgram STT (transcription)
  → Haiku classifier (~200ms, picks intent: commerce/coding/general)
  → System prompt selected (e.g. "You are a shopping assistant for a blind user...")
  → LLM streams response token-by-token (Sonnet/Haiku)
  → Sentence splitter buffers tokens until sentence boundary
  → Each sentence → Cartesia TTS → audio chunks → client speaker
```

This is a **text-only conversation** with different personas. The LLM has NO tools — it can only generate text. It cannot browse the web, click buttons, or read pages.

## Daniel's Agent Architecture (Added, Not Yet Wired In)

Daniel built a full agent system with browser control:

```
server/src/agents/
  ├── supervisor.ts    — LangGraph router: classifies → routes to agent
  ├── commerce.ts      — Shopping agent with ReAct tool loop
  ├── general.ts       — Web navigation agent with ReAct tool loop
  ├── coding.ts        — Code assistant (text-only, no tools)
  └── tools.ts         — 4 LangChain tools wrapping Stagehand:
                           • navigate_to_url(url)
                           • click_element(description)
                           • extract_data(instruction)
                           • observe_page()
```

### How a Stagehand call would work (when integrated):

```
User: "Find me a laptop under $500 on Amazon"

1. Classify → "commerce"
2. Commerce agent starts ReAct loop:
   - Think: "I need to search Amazon for laptops under $500"
   - Tool call: navigate_to_url("https://amazon.com")
     → Stagehand launches headless browser
     → page.goto("https://amazon.com")
     → Returns: "Navigated to Amazon.com"
   - Think: "Now I need to search for laptops"
   - Tool call: click_element("search bar")
     → Stagehand finds the search bar on the page
     → page.act("click on search bar and type 'laptop under $500'")
     → Returns: "Clicked search bar and typed query"
   - Tool call: extract_data("product names, prices, and ratings")
     → Stagehand reads the page content
     → page.extract({...schema...})
     → Returns: [{name: "Acer Aspire", price: "$449", rating: "4.3"}, ...]
   - Think: "I have 3 results, let me present them"
3. Agent returns formatted text response
4. Response → TTS → audio to user
```

### Why it's not wired in yet: the latency problem

Each Stagehand tool call takes 2-10 seconds (browser navigation, page rendering, LLM extraction). A single commerce query might need 3-5 tool calls = 10-30 seconds of silence before the user hears anything.

Our streaming pipeline gives first audio in ~500ms because the LLM starts speaking immediately. These two approaches are fundamentally at odds.

## Possible Integration Approaches (Future)

### Option A: Two-phase response
1. LLM immediately says "Let me look that up on Amazon for you" (streamed, fast)
2. Agent runs Stagehand tools in background (10-30s)
3. When done, LLM speaks the results (streamed)

### Option B: Tool-aware streaming
1. LLM streams normally, but can emit tool calls mid-stream
2. When a tool call is detected, pause TTS, run the tool, resume streaming
3. User hears: "I'm searching Amazon now... [pause] ... I found three laptops..."

### Option C: Pre-fetch + cache
1. For common queries, pre-browse and cache results
2. LLM responds from cache (fast, no tool calls needed)

### Option D: Supervisor decides routing
1. Classifier determines if tools are needed
2. If NO tools needed → streaming pipeline (fast)
3. If tools needed → agent pipeline with "hold on" message first

## What's In Place Now

- Stagehand initializes on server start (headless browser ready)
- ExecutionContext is created and passed to the socket handler
- Agent files exist with full tool definitions
- But `runSupervisor()` is never called from the voice pipeline
- The streaming handler only uses system prompts, no tools

## What Needs to Happen for Full Integration

1. Decide on an integration approach (A/B/C/D above)
2. Wire `createHandler` to call agents when tools are needed
3. Handle the latency gap (progressive responses, status updates)
4. Test with real browser interactions
