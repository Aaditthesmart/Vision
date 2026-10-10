# VisionOS — System Architecture & Data Flow

**Product**: VisionOS (Gemma 4-Powered Goal-Oriented Computer Interface for Visually Impaired Users)  
**Target Platform**: Windows 11 (Zero-Paid-API, Local Inference)  

---

## 1. High-Level Architecture

VisionOS is structured as a privacy-preserving, zero-paid-API accessibility interface that replaces tedious sequential screen-reader navigation with goal-driven autonomous understanding and verified action execution.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                       VisionOS Electron Client                          │
│     (Electron 33 + React 19 + TailwindCSS + Web Speech Synthesis/STT)    │
│                                                                         │
│  ┌─────────────────────────────────┐   ┌─────────────────────────────┐  │
│  │   Natural Language / Voice Bar  │   │     Live ARIA Live Region   │  │
│  └─────────────────────────────────┘   └─────────────────────────────┘  │
│  ┌─────────────────────────────────┐   ┌─────────────────────────────┐  │
│  │   Active Task Plan Visualizer   │   │  Approval Confirmation Gate │  │
│  └─────────────────────────────────┘   └─────────────────────────────┘  │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │ Socket.IO (ws://localhost:3001)
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                     VisionOS Node.js / Express Server                    │
│                                                                         │
│  ┌─────────────────────────────────┐   ┌─────────────────────────────┐  │
│  │       Task Execution Layer      │   │    Goal Interpretation &    │  │
│  │ - State Lifecycle Transitions   │ ◄─┤    Gemma 4 Reasoning Engine │  │
│  │ - Consequential Approval Gate   │   │ - Structured Zod Schemas    │  │
│  │ - Verification Engine           │   │ - Bounded Action Planning   │  │
│  │ - Autonomous Recovery Loop      │   │ - Accessible Page Summaries │  │
│  └────────────────┬────────────────┘   └──────────────┬──────────────┘  │
│                   │                                   │                 │
│                   │                                   ▼                 │
│                   │                    ┌─────────────────────────────┐  │
│                   │                    │     Local Ollama Client     │  │
│                   │                    │  (http://127.0.0.1:11434)   │  │
│                   │                    │ - Zero Paid API Inference   │  │
│                   │                    │ - Gemma 4 / Local LLM       │  │
│                   │                    └─────────────────────────────┘  │
│                   ▼                                                     │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │                Playwright Browser Automation                      │  │
│  │ - System Edge / Chrome Launcher (Zero extra disk footprint)       │  │
│  │ - Accessible Tree Extraction (Headings, Landmarks, Forms, Roles)   │  │
│  │ - Bounded Safe Actions (Navigate, Locate & Focus, Fill, Click)    │  │
│  │ - DOM State & Focus Verification Engine                           │  │
│  └────────────────┬──────────────────────────────────────────────────┘  │
└───────────────────┼─────────────────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│              Deterministic Accessible Test Bench & Web Pages            │
│                       (http://localhost:3001/test-site)                 │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Core Subsystems

### 2.1 Local Gemma 4 Reasoning (`server/src/llm/`)
- **`ollama.ts`**: Connects to the local Ollama daemon at `http://127.0.0.1:11434`. Validates model connection, queries installed tags, and enforces timeouts to prevent UI freezing during model loading.
- **`gemma4.ts`**: Implements goal interpretation, direct navigation planning, accessible page explanations, and failure recovery. Output is strictly validated using Zod schemas (`GoalInterpretationSchema`, `TaskPlanSchema`, `RecoveryPlanSchema`).
- **Zero Cloud Fallback Guarantee**: If local inference is unavailable or fails, VisionOS reports an honest error rather than transmitting sensitive user DOM data to third-party cloud APIs.

### 2.2 Accessible Page Context Extractor (`server/src/lib/browserAutomation.ts`)
Instead of dumping raw HTML or multi-megabyte DOM snapshots into the model:
1. **Headings**: Extracts heading hierarchy (`H1` to `H6`) with text and locations.
2. **Landmarks**: Identifies semantic landmarks (`navigation`, `main`, `search`, `banner`, `contentinfo`).
3. **Interactive Elements**: Collects accessible names (derived from ARIA labels, `aria-labelledby`, `<label>` tags, or placeholders), roles, visibility status, and unique selectors.
4. **Forms**: Groups form fields with input types, required flags, and bound labels.
5. **Alerts**: Surfaces active error messages, dialogs, and notifications.

### 2.3 Verified Action Lifecycle (`server/src/pipeline/taskExecutor.ts`)
Each action step progresses through an explicit finite state machine:
```
[PLANNED]
    │
    ├─► (Requires Approval?) ──► [WAITING_FOR_APPROVAL] ──► (Declined) ──► [CANCELLED]
    │                                  │
    │                           (Approved)
    │                                  │
    ▼                                  ▼
[EXECUTING] ──► (Action Failed) ──► [RECOVERY_REQUIRED] ──► (Unrecoverable) ──► [FAILED]
    │                                      │
(Success)                           (Alternative Safe Step)
    │                                      │
    ▼                                      ▼
[VERIFYING] ────────────────────────► [SUCCEEDED]
```

### 2.4 Consequential Action Safety Gate
Actions categorized as consequential (e.g., submitting external forms, purchasing items, deleting data) pause the pipeline and emit an `approval_required` event to the client. The application blocks execution until the user explicitly confirms via the accessible dialog.

---

## 3. Privacy & Security Model

1. **Local-First Processing**: DOM contents and user inputs remain on the local machine.
2. **No Arbitrary Code Execution**: Gemma 4 outputs structured JSON action schemas; raw shell commands and `eval()` are forbidden.
3. **Electron Isolation**: Context isolation is enabled, Node integration is disabled in the renderer, and only validated IPC methods are exposed.
4. **Credential Safety**: Form filling is bounded to user-provided parameters and never logs sensitive passwords or authentication tokens.
