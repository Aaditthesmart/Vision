# Plan: Agent-S Desktop Control Integration

## Context

The project is a voice-first accessible browser for blind users (TreeHacks 2026). It has a LangGraph supervisor that routes to commerce/coding/general agents. The coding agent is currently a text-only stub. We want to add full desktop control via Agent-S so the assistant can control any app (VS Code, Terminal, Finder, Spotify, etc.) outside the browser.

**Key decisions made:**
- **Architecture**: Hybrid — Agent-S framework with Claude (Anthropic) as grounding model (no UI-TARS/GPU needed)
- **Routing**: New "desktop" category in the supervisor classifier (4-way routing)
- **Agent design**: Single desktop agent with mode-switching (coding vs general desktop prompts, same tools)
- **Sidecar**: Python FastAPI on port 8001, auto-started by Node.js server

---

## Step 1: Verify Supervisor Routing to "desktop" Category

**Files to modify:**
- `server/src/types/index.ts` — Add `"desktop"` to `AgentCategory` union type
- `server/src/agents/supervisor.ts` — Update classifier prompt, router, and graph edges

**Changes:**

1. **`server/src/types/index.ts:29`** — Extend AgentCategory:
   ```typescript
   export type AgentCategory = "commerce" | "coding" | "general" | "desktop";
   ```

2. **`server/src/agents/supervisor.ts`** — Update `CLASSIFY_SYSTEM` prompt (line 74-86):
   - Add `"desktop"` category: tasks requiring OS-level control outside the browser — opening apps, typing in desktop apps, file management, system settings, coding in VS Code, running terminal commands
   - Keep `"coding"` for text-only code help (explain code, debug conceptually, discuss architecture)
   - Clarify boundary: "If the user wants something DONE on the computer (not just explained), classify as desktop"

3. **`server/src/agents/supervisor.ts`** — Update `routeByCategory` (line 165-176):
   ```typescript
   case "desktop": return "desktopAgent";
   ```

4. **`server/src/agents/supervisor.ts`** — Update `createSupervisor` (line 185+):
   - Import and create `desktopAgent`
   - Add `desktopAgent` node to the graph
   - Add edge: `desktopAgent → formatResponse`
   - Add `"desktopAgent"` to conditional edges

**Verification**: Send test messages and confirm classification:
- "open VS Code" → desktop
- "explain what a for loop is" → coding
- "buy headphones on Amazon" → commerce
- "read this article" → general
- "run my Python script in Terminal" → desktop
- "open Spotify and play music" → desktop

---

## Step 2: Set Up Agent-S Python Sidecar

**New files:**
- `agent-s-sidecar/server.py` — FastAPI server (follows existing plan in visionimplementationplan.md lines 437-554)
- `agent-s-sidecar/requirements.txt` — Python dependencies
- `agent-s-sidecar/start.sh` — Startup script

**Implementation:**

1. **`agent-s-sidecar/requirements.txt`**:
   ```
   gui-agents
   fastapi
   uvicorn
   pyautogui
   pytesseract
   ```

2. **`agent-s-sidecar/server.py`** — FastAPI app with 4 endpoints:
   - `POST /predict` — Single-step: capture screenshot → Agent-S reason → execute action
   - `POST /execute` — Multi-step: run full task loop (up to N steps)
   - `POST /screenshot` — Capture current screen state
   - `GET /health` — Readiness check

   **Critical config**: Use Claude as grounding model instead of UI-TARS:
   ```python
   ENGINE_PARAMS = {
       "engine_type": "anthropic",
       "model": "claude-sonnet-4-5-20250929",
   }
   GROUNDING_PARAMS = {
       "engine_type": "anthropic",
       "model": "claude-sonnet-4-5-20250929",
       "grounding_width": 1920,
       "grounding_height": 1080,
   }
   ```
   This eliminates the need for UI-TARS / HuggingFace endpoint / GPU entirely.

3. **`agent-s-sidecar/start.sh`**:
   ```bash
   #!/bin/bash
   cd "$(dirname "$0")"
   pip install -r requirements.txt --quiet
   uvicorn server:app --host 0.0.0.0 --port 8001
   ```

**macOS prerequisites** (one-time):
- `brew install tesseract` (for pytesseract OCR)
- Grant Accessibility permissions: System Settings → Privacy & Security → Accessibility → add Terminal/iTerm
- Grant Screen Recording permissions: System Settings → Privacy & Security → Screen Recording → add Terminal/iTerm

---

## Step 3: Create Desktop Agent (TypeScript)

**New file:** `server/src/agents/desktop.ts`

**Reuses existing patterns from:**
- `server/src/agents/commerce.ts` — ReAct loop structure, tool binding, `extractText()` helper
- `server/src/agents/tools.ts` — Tool creation pattern with `DynamicStructuredTool`

**Implementation:**

1. **Desktop tools** — HTTP calls to Agent-S sidecar (port 8001):
   - `execute_desktop_task` — Multi-step task execution (calls `/execute`)
   - `capture_screen` — Screenshot capture (calls `/screenshot`)
   - `single_desktop_action` — Single-step action (calls `/predict`)

2. **Mode-switching system prompts**:
   - **Coding mode**: Activated when supervisor classification has `subIntent` matching coding patterns. Prompt knows about VS Code, Terminal, debugging, file navigation.
   - **General desktop mode**: Default. Prompt knows about opening apps, system navigation, file management, basic interactions.

3. **Agent function signature** — Matches existing agent contract:
   ```typescript
   export function createDesktopAgent() {
     return async function desktopAgent(state: {
       userInput: string;
       conversationHistory: ConversationTurn[];
       userProfile: UserProfile | null;
       pageSnapshot: PageSnapshot | null;
     }): Promise<{ responseText: string }>;
   }
   ```

4. **ReAct loop** — Same pattern as commerce agent:
   - Claude Sonnet 4.5 as the reasoning model
   - Bind desktop tools
   - Max 5 tool steps (desktop tasks should be quick for demo)
   - Parse tool calls, execute against sidecar, feed results back

5. **Health check on first use** — Before calling sidecar, check `/health`. If down, return text-only fallback response explaining desktop control is unavailable.

---

## Step 4: Wire Desktop Agent into Supervisor

**File:** `server/src/agents/supervisor.ts`

**Changes** (all surgical, reusing existing patterns):

1. Add import: `import { createDesktopAgent } from "./desktop.js";`
2. In `createSupervisor()`:
   - `const desktopAgentFn = createDesktopAgent();`
   - Add `desktopNode` wrapper (same pattern as `commerceNode` on lines 192-197)
   - Add `.addNode("desktopAgent", desktopNode)` to graph
   - Add `.addEdge("desktopAgent", "formatResponse")` to graph
3. Update `routeByCategory` return type to include `"desktopAgent"`

---

## Step 5: Auto-Start Sidecar from Node.js Server

**File to modify:** `server/src/index.ts` (or wherever the server starts)

**Implementation:**
- On server startup, spawn `python3 agent-s-sidecar/server.py` as a child process
- Poll `GET /health` every 500ms for up to 15 seconds
- If health check passes → log success, enable desktop agent
- If health check fails → log warning, desktop agent returns text-only fallback
- On server shutdown → kill child process (SIGTERM)

**Lightweight**: Agent-S sidecar is just a FastAPI server (~50MB memory). The heavy work (LLM calls, screenshots) happens on-demand. No performance impact at idle.

---

## Edge Cases & Error Handling

| Edge Case | Handling |
|-----------|----------|
| **Sidecar not running** | Health check on first desktop tool call. Return text fallback: "I can't control the desktop right now. Let me help with what I can explain." |
| **macOS permissions missing** | pyautogui will throw `PyAutoGUIException`. Sidecar catches and returns `{ error: "accessibility_permission_denied" }`. Desktop agent tells user to grant permissions. |
| **Screenshot capture fails** | Return error from sidecar. Agent retries once, then falls back to text. |
| **Agent-S action fails mid-step** | Agent-S has built-in reflection. After failure, it re-plans. `/execute` endpoint handles this internally. |
| **Multiple monitors** | Configure Agent-S for primary monitor only. Add `DISPLAY_NUMBER=1` env var. |
| **API rate limiting (429)** | Sidecar wraps Claude calls with exponential backoff (3 retries). |
| **Long-running task** | `/execute` has `max_steps` param (default 10). Timeout of 60 seconds per step. Total task timeout of 5 minutes. |
| **Sidecar crashes** | Node.js child process listener detects exit. Log error. Next desktop request returns text fallback. Auto-restart on next call attempt. |
| **Screen resolution mismatch** | Configure `grounding_width`/`grounding_height` to match actual display on startup (read from `system_profiler`). |
| **User barge-in during desktop task** | AbortController signal propagated to sidecar via `/abort` endpoint (or just let current step finish and don't send more). |
| **Agent controls the overlay itself** | System prompt explicitly instructs: "Never interact with the voice assistant overlay window." |
| **Security: exec() running arbitrary code** | Agent-S only executes pyautogui-generated code (mouse/keyboard actions). Not arbitrary user code. Sidecar validates action format before exec(). |

---

## Verification Plan

1. **Unit test routing**: Send classification test messages, verify "desktop" category
2. **Sidecar health**: Start sidecar, verify `GET /health` returns 200
3. **Screenshot endpoint**: Call `POST /screenshot`, verify base64 PNG returned
4. **Single action**: Call `POST /predict` with "click on the Finder icon in the dock"
5. **Multi-step task**: Call `POST /execute` with "open TextEdit and type hello world"
6. **End-to-end voice**: Say "open Safari" into the voice assistant, verify it opens Safari
7. **Fallback**: Stop sidecar, say "open Spotify", verify graceful text-only response
8. **Coding mode**: Say "open VS Code and fix the bug on line 5", verify coding-mode prompt activates

---

## Files Summary

| File | Action | Lines Changed (est.) |
|------|--------|---------------------|
| `server/src/types/index.ts:29` | Edit | ~1 line |
| `server/src/agents/supervisor.ts` | Edit | ~20 lines (classifier prompt, router, graph) |
| `server/src/agents/desktop.ts` | **New** | ~120 lines (desktop agent + tools) |
| `agent-s-sidecar/server.py` | **New** | ~80 lines (FastAPI endpoints) |
| `agent-s-sidecar/requirements.txt` | **New** | ~5 lines |
| `agent-s-sidecar/start.sh` | **New** | ~5 lines |
| `server/src/index.ts` | Edit | ~20 lines (sidecar auto-start) |
