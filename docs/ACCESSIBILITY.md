# VisionOS — Accessibility Specifications & Design Standards

VisionOS is designed in accordance with **WCAG 2.1 AA** standards and principles for blind and low-vision users.

---

## 1. Core Accessibility Principles

### 1.1 Goal-Oriented vs. Sequential Traversal
Conventional screen readers (e.g., NVDA, JAWS, Windows Narrator) require users to press `Tab` or arrow keys through dozens of navigation links, promotional banners, and boilerplate elements before reaching the intended form or price filter.

VisionOS allows the user to declare their goal (e.g. *"Find the price filter"*, *"Read the important parts of this article"*, *"Fill out the form with my email"*). Gemma 4 computes the direct path, navigates to the relevant landmark, moves visual and assistive focus, and confirms the action.

---

## 2. Assistive Technology Compatibility

### 2.1 Screen Reader Live Regions (`ARIA Live`)
VisionOS includes an `aria-live="polite"` region with `aria-atomic="true"`:
- Announces agent state changes (`"VisionOS is executing browser actions"`, `"VisionOS is attempting recovery"`).
- Announces task completions and verification evidence.
- Reads assistant explanations and summaries aloud.

### 2.2 Full Keyboard Navigation
- Every control in VisionOS is keyboard-navigable via `Tab` and `Shift + Tab`.
- `Enter` sends natural-language goals.
- `Escape` or the emergency **Cancel** button immediately cancels running tasks.
- Consequential action approval modals trap keyboard focus between **Confirm** and **Decline** buttons.

### 2.3 Visual Focus Indicators & Contrast
- Elements focused by VisionOS receive a high-contrast 4px solid outline with smooth scrolling.
- UI elements adhere to a minimum 4.5:1 contrast ratio against the dark acrylic background.

### 2.4 Multimodal Speech & Text Parity
- Spoken audio responses are powered by standard Web Speech API / Windows SAPI voices with zero cloud dependencies.
- Every spoken response is duplicated as high-contrast written text in the chat log for deaf/hard-of-hearing or low-vision users.
