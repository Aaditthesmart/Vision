# VisionOS — Licensing, Attribution & Third-Party Disclosures

---

## 1. Upstream Attribution

VisionOS is derived from and builds upon the foundational prototype developed during **TreeHacks 2026**:
- **Original Repository**: [https://github.com/ledaniel0/treehacks2026](https://github.com/ledaniel0/treehacks2026)
- **Original Authors & Contributors**: Daniel Le and the TreeHacks 2026 Team.

---

## 2. Open-Source Contributions & Major Enhancements

Our work significantly transforms the legacy prototype into a robust, Windows-first accessibility product:

1. **Complete Zero-Paid-API Architecture**: Replaced all proprietary cloud APIs (Anthropic Claude, OpenAI GPT-4, Deepgram, Cartesia, Perplexity, Elasticsearch) with local Gemma 4 inference (Ollama), Playwright, Web Speech APIs, and local state management.
2. **Goal-Oriented Accessibility Engine**: Implemented accessible DOM tree parsing (landmarks, headings, ARIA names, form roles) and direct navigation shortcuts for visually impaired users.
3. **Verified Action Execution & Recovery**: Introduced finite state lifecycle management (`PLANNED` -> `EXECUTING` -> `VERIFYING` -> `SUCCEEDED` / `FAILED`), consequential action approval gates, and autonomous recovery loops.
4. **Cross-Platform Windows 11 Optimization**: Fixed Electron main process bugs, removed macOS-only AppleScript/JXA scripts, and ensured seamless operation on commodity Windows hardware without dedicated GPUs.
5. **Deterministic Test Bench & Automated E2E Suite**: Developed a comprehensive local test website and test runner covering all 8 core accessibility workflows.

---

## 3. License Notice

The codebase is licensed under the permissive **MIT License** / **ISC License**. All modifications, documentation, and additions respect upstream licensing requirements.
