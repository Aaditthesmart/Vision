# VisionOS — Gemma 4 Accessibility Implementation Plan & Repository Audit

**Product**: VisionOS (Gemma 4-Powered Goal-Oriented Computer Interface for Visually Impaired Users)  
**Target Platform**: Windows 11 (Intel Core i5 / 16GB RAM / Integrated Intel Graphics / Zero-Paid-API)  
**Date**: October 2026  

---

## 1. Executive Summary & Audit Findings

VisionOS was originally conceived at TreeHacks 2026 as an Electron-based desktop voice assistant overlay. The legacy codebase relied heavily on paid cloud services (Anthropic Claude, OpenAI GPT-4, Deepgram STT, Cartesia TTS, Perplexity Sonar, Elasticsearch Cloud) and macOS-only system APIs (AppleScript, JXA, CoreGraphics, screencapture, pbcopy).

This audit outlines the transformation into a **Windows-first, zero-paid-API, accessible interface powered by local Gemma 4 inference (via Ollama)** and **Playwright-driven accessible browser automation**.

### 1.1 Existing Features vs. Target State

| Feature Area | Legacy Codebase Status | Target VisionOS Implementation |
| :--- | :--- | :--- |
| **Primary LLM Reasoning** | Anthropic Claude 3.5 / OpenAI GPT-4 (Cloud APIs) | **Local Gemma 4 via Ollama** (`http://127.0.0.1:11434`), structured Zod schemas, zero cloud fallback |
| **Browser Automation** | `@browserbasehq/stagehand` requiring OpenAI GPT-4.1 API & macOS Chrome path | **Native Playwright** (`chromium`), role/accessible-name locators, bounded allowlisted actions |
| **Desktop Automation** | macOS-only AppleScript/JXA (`screencapture`, `sips`, `pbcopy`, `CoreGraphics`) | **Cross-platform / Windows Desktop Layer** with fallback diagnostics & safe browser-first execution |
| **Speech-to-Text (STT)** | Deepgram Live Streaming API (Paid Key Required) | **Web Speech Recognition API / Local STT**, with zero-paid text-first keyboard parity |
| **Text-to-Speech (TTS)** | Cartesia Sonic API (Paid Key Required) | **Windows SAPI / Browser SpeechSynthesis**, natural local voices, screen-reader friendly |
| **Knowledge Base** | Elasticsearch Cloud (`@elastic/elasticsearch`) | **Local JSON/SQLite Memory Store** for user preferences & recent task history; no cloud servers |
| **UI & Accessibility** | Fixed 700x350 glass box, no keyboard text input, no ARIA regions, no plan inspector | **Accessible Windows 11 UI**: Text input bar, ARIA live announcements, visual task plan, approval modal, cancellation control |
| **Verification & Lifecycle**| Blind tool execution without state verification | **Explicit Action Lifecycle**: `PLANNED` -> `WAITING_FOR_APPROVAL` -> `EXECUTING` -> `VERIFYING` -> `SUCCEEDED`/`FAILED` |
| **Safety & Approvals** | Shell commands (`/bin/bash`), unconstrained browser clicks | **Consequential Action Approval Gates**, sandbox path safety, domain validation |

---

## 2. Identified Vulnerabilities & Platform Incompatibilities

1. **Hardcoded macOS Commands**:
   - `server/src/agents/tools.ts`: Referenced `/bin/bash`, `/usr/bin/find`, `/usr/bin/grep`.
   - `server/src/lib/computerControl.ts`: Full dependency on macOS `osascript` and `CoreGraphics`.
   - `server/src/lib/stagehand.ts`: Hardcoded Chrome path `/Applications/Google Chrome.app/...`.
   - `electron/src/main.ts`: Calling macOS-specific `systemPreferences.isTrustedAccessibilityClient()`, undefined `fadeWindow()` function causing build errors.

2. **Paid API Lock-in**:
   - Server crashed or disabled tools if `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `DEEPGRAM_API_KEY`, or `CARTESIA_API_KEY` were missing.

3. **Accessibility Semantic Deficits**:
   - The UI lacked an `<input>` field for text entry, relying solely on microphone clicks.
   - Assistive technologies (screen readers like NVDA/JAWS/Windows Narrator) could not track live agent state or inspect task plans.
   - Missing keyboard shortcuts for stopping/cancelling running tasks.

4. **Licensing & Attribution**:
   - Upstream codebase is licensed under ISC / MIT. All modifications will preserve original author attribution while establishing clean open-source documentation.

---

## 3. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           VisionOS Client                                │
│       (Electron 33 + React 19 + Accessible UI + Web Speech API)         │
│                                                                         │
│  [Natural Language Input / Voice]       [Live ARIA Live Region]         │
│  [Goal & Current Page Summary]          [Task Plan & Verification View] │
│  [Approval Dialog Gate]                 [Emergency Cancel Button]       │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │ Socket.IO (ws://localhost:3001)
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      VisionOS Backend Orchestrator                       │
│                                                                         │
│  ┌───────────────────────┐         ┌─────────────────────────────────┐  │
│  │   Local Gemma 4 LLM   │ ◄─────► │     Goal & Context Engine       │  │
│  │     (via Ollama)      │         │ - Accessible DOM Parser         │  │
│  │ - Goal Interpretation │         │ - Landmark & Heading Extraction │  │
│  │ - Direct Nav Planning │         │ - Form & Filter Discovery       │  │
│  │ - Action Verification │         └────────────────┬────────────────┘  │
│  │ - Autonomous Recovery │                          │                    │
│  └───────────────────────┘                          ▼                    │
│                                    ┌─────────────────────────────────┐  │
│                                    │ Bounded Playwright Automation   │  │
│                                    │ - Role-based Locators           │  │
│                                    │ - Navigation & Focus Control    │  │
│                                    │ - Action Lifecycle & Verify     │  │
│                                    └────────────────┬────────────────┘  │
│                                                     │                    │
└─────────────────────────────────────────────────────┼───────────────────┘
                                                      │
                                                      ▼
                              ┌─────────────────────────────────────────┐
                              │  Local Deterministic Test Environment   │
                              │   (http://localhost:3001/test-site)     │
                              │ - Products, Price Filter, Accessible    │
                              │   Forms, Article, Error/Recovery Demos  │
                              └─────────────────────────────────────────┘
```

---

## 4. Implementation Checklist & Prioritization

### Phase 1: Foundation & Local Model Engine (P0)
- [x] Comprehensive repository audit and `docs/IMPLEMENTATION_PLAN.md`
- [ ] Create `server/src/llm/ollama.ts` & `server/src/llm/gemma4.ts` local model provider (with connection checks, model validation, structured JSON output)
- [ ] Add zero-paid-API server configuration and remove mandatory paid cloud keys
- [ ] Implement cross-platform desktop & utility abstraction (replacing macOS-only `/bin/bash`, `osascript`, etc.)

### Phase 2: Goal-Oriented Browser Engine & Page Context Extraction (P0)
- [ ] Build `server/src/lib/browserAutomation.ts` using Playwright:
  - Accessible snapshot extraction (headings, landmarks, interactive controls, forms, links)
  - Bounded allowlisted actions: navigate, click, fill, select, focus, scroll, screenshot
- [ ] Build `server/src/pipeline/goalEngine.ts` for Gemma 4 goal interpretation and direct navigation planning
- [ ] Implement `server/src/pipeline/taskExecutor.ts` with verified execution lifecycle and autonomous recovery

### Phase 3: Safety, Consequential Approval Gates & Local Test Site (P0 / P1)
- [ ] Build deterministic test website (`server/src/test-site/` served via Express):
  - Product catalog with price filters
  - Accessible multi-field application form
  - Tech article with heading hierarchy
  - Missing element / recovery trigger
  - Consequential purchase/submit approval trigger
- [ ] Implement approval gate & cancellation handler in task executor

### Phase 4: Accessible Electron & React UI (P1)
- [ ] Fix Electron `main.ts` for Windows 11 compatibility (remove broken macOS calls, fix window framing)
- [ ] Overhaul `electron/src/components/` with accessible keyboard text input, ARIA live announcements, visual task plan tracker, model status indicator, approval modal, and trace drawer
- [ ] Implement zero-paid speech synthesis & recognition via standard Web Speech API

### Phase 5: Automated Verification & Documentation (P1)
- [ ] Implement automated test suite covering all 8 required scenarios:
  1. Page understanding
  2. Goal-oriented navigation (price filter)
  3. Search result discovery
  4. Form filling without submission
  5. Failure recovery
  6. Model unavailable error handling
  7. Approval gate enforcement
  8. Task cancellation
- [ ] Create comprehensive documentation files:
  - `README.md`
  - `docs/ARCHITECTURE.md`
  - `docs/WINDOWS_SETUP.md`
  - `docs/GEMMA4_SETUP.md`
  - `docs/ACCESSIBILITY.md`
  - `docs/TESTING.md`
  - `docs/DEMO_SCRIPT.md`
  - `docs/LICENSING_AND_ATTRIBUTION.md`
