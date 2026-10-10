# VisionOS 🎙️
### A Gemma 4-Powered, Goal-Oriented Computer Interface for Visually Impaired Users

[![Platform](https://img.shields.io/badge/Platform-Windows%2011-blue.svg)](https://microsoft.com/windows)
[![AI Model](https://img.shields.io/badge/Model-Gemma%204%20(Local%20Ollama)-orange.svg)](https://ollama.com/library/gemma4)
[![Cost](https://img.shields.io/badge/Cost-Zero--Paid--API-emerald.svg)](docs/ARCHITECTURE.md)
[![Accessibility](https://img.shields.io/badge/WCAG-2.1%20AA%20Compliant-purple.svg)](docs/ACCESSIBILITY.md)
[![License](https://img.shields.io/badge/License-MIT%20%2F%20ISC-green.svg)](docs/LICENSING_AND_ATTRIBUTION.md)

---

## 🌟 The Problem VisionOS Solves

Conventional screen-reader experiences force blind and low-vision users to traverse complex websites **sequentially** — tabbing through dozens of irrelevant navigation menus, decorative images, and cookie banners just to find a simple price filter or application form.

A sighted person glances at a page, identifies what matters, and acts immediately. **VisionOS brings that same power to visually impaired users.**

Instead of manual step-by-step exploration, the user simply expresses their goal:
- *"Tell me what is on this page."*
- *"Find the price filter and focus it."*
- *"Find the cheapest headphones under ₹2,000."*
- *"Fill in this form with my name and email, but do not submit it."*
- *"Find the second search result and explain what it contains."*

VisionOS interprets the intention, parses the accessible DOM hierarchy (landmarks, headings, forms, interactive roles), plans the shortest bounded path, executes the actions, **verifies the real browser state**, and communicates clearly with the user.

---

## 🎯 Key Capabilities

1. **Local Gemma 4 Reasoning**: Powered entirely by local Ollama inference (`http://127.0.0.1:11434`). Zero cloud AI API keys required. All page contents remain strictly private on the user's laptop.
2. **Goal-Oriented Bounded Automation**: Playwright-driven browser interaction using accessible roles, accessible names, and semantic landmarks rather than brittle visual coordinates.
3. **Verified Action Lifecycle**: Every step transitions through an explicit finite state machine: `PLANNED` ➔ `WAITING_FOR_APPROVAL` ➔ `EXECUTING` ➔ `VERIFYING` ➔ `SUCCEEDED` / `FAILED`.
4. **Consequential Action Approval Gate**: Gemma 4 pauses before submitting forms, purchasing items, or modifying sensitive settings, requiring explicit user consent.
5. **Autonomous Failure Recovery**: If an element is missing or a page changes, VisionOS analyzes updated context, attempts safe alternatives, or reports honest explanations.
6. **Zero-Paid Voice & Keyboard Parity**: Standard Web Speech API / Windows SAPI speech synthesis and live speech recognition, paired with full keyboard navigation and ARIA live regions for screen readers (NVDA, JAWS, Narrator).

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                       VisionOS Electron Overlay                         │
│       (Electron 33 + React 19 + ARIA Live + Web Speech API)             │
│                                                                         │
│  [Natural Language / Voice Bar]         [Task Plan & Verification View] │
│  [Page Context Summary]                 [Consequential Approval Modal]  │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │ Socket.IO (ws://localhost:3001)
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                     VisionOS Node.js / Express Server                    │
│                                                                         │
│  ┌─────────────────────────┐         ┌───────────────────────────────┐  │
│  │    Local Gemma 4 LLM    │ ◄─────► │    Accessible DOM Parser      │  │
│  │      (via Ollama)       │         │ - Headings & Landmarks        │  │
│  │ - Goal Interpretation   │         │ - Forms & Interactive Roles   │  │
│  │ - Bounded Task Planning │         └──────────────┬────────────────┘  │
│  │ - Verification & Repair │                        │                   │
│  └─────────────────────────┘                        ▼                   │
│                                      ┌───────────────────────────────┐  │
│                                      │ Playwright Browser Automation │  │
│                                      │ - Safe Allowlisted Actions    │  │
│                                      │ - State Verification Engine   │  │
│                                      └──────────────┬────────────────┘  │
└─────────────────────────────────────────────────────┼───────────────────┘
                                                      │
                                                      ▼
                              ┌─────────────────────────────────────────┐
                              │  Deterministic Accessible Test Bench    │
                              │   (http://localhost:3001/test-site)     │
                              └─────────────────────────────────────────┘
```

---

## 🚀 Quick Start (Windows 11)

### 1. Prerequisites
- **Node.js**: v20+ / v22+ / v24+
- **Ollama**: Download and install from [ollama.com](https://ollama.com/)
- **Download Model**:
  ```powershell
  ollama pull gemma4
  # or lightweight fallback:
  ollama pull gemma2:2b
  ```

### 2. Install Dependencies
```powershell
# Server
cd server
npm install

# Electron App
cd ../electron
npm install
```

### 3. Launch VisionOS
```powershell
# From the project root:
npm run electron

# Or launch independently:
npm run server    # Backend server (port 3001)
npm run electron  # Desktop Electron overlay
```

VisionOS will appear on your desktop with hotkey `Ctrl + Shift + V`.

---

## 🧪 Automated Accessibility Test Suite

VisionOS includes a deterministic test bench and automated E2E test suite covering 8 mandatory accessibility scenarios:

```powershell
cd server
npm test
```

### Verified Test Results:
- ✔ **TEST 1: Page Understanding** — Extracts headings & landmarks; generates concise grounded summary without element flooding.
- ✔ **TEST 2: Goal Navigation** — Locates and moves focus directly to `#price-filter`.
- ✔ **TEST 3: Search Result Discovery** — Summarizes second product card (`boAt Rockerz 450`).
- ✔ **TEST 4: Form Assistance** — Fills in Name and Email; verifies values in DOM without submitting.
- ✔ **TEST 5: Failure Recovery** — Handles missing elements gracefully with honest explanations.
- ✔ **TEST 6: Model Unavailable** — Catches disconnected Ollama cleanly with zero cloud fallback leakage.
- ✔ **TEST 7: Approval Gate** — Blocks consequential form submission until user explicitly confirms.
- ✔ **TEST 8: Task Cancellation** — Cancels running multi-step task instantly on `Esc` / Cancel button.

---

## 📚 Documentation Directory

- [Implementation Plan & Audit](docs/IMPLEMENTATION_PLAN.md)
- [System Architecture & Data Flow](docs/ARCHITECTURE.md)
- [Windows 11 Setup Guide](docs/WINDOWS_SETUP.md)
- [Gemma 4 Configuration](docs/GEMMA4_SETUP.md)
- [Accessibility Specifications (WCAG 2.1 AA)](docs/ACCESSIBILITY.md)
- [Automated Testing & Benchmark](docs/TESTING.md)
- [3-Minute Live Demo Script](docs/DEMO_SCRIPT.md)
- [Licensing & Upstream Attribution](docs/LICENSING_AND_ATTRIBUTION.md)

---

## 🤝 Attribution & Open Source

VisionOS is built upon the foundational TreeHacks 2026 prototype by Daniel Le and team ([https://github.com/ledaniel0/treehacks2026](https://github.com/ledaniel0/treehacks2026)). Licensed under the **MIT / ISC License**.