# VisionOS — 3-Minute Live Demonstration Script

This script walks through a reproducible 3-minute demonstration of VisionOS on Windows 11.

---

## Act 1: Launch & Local Connection Verification (0:00 - 0:45)
1. **Launch VisionOS on Windows 11**:
   - Open PowerShell and run: `npm run dev` in the `electron/` directory.
   - Point out the top app bar displaying **"Zero-Paid-API"** and the model connection indicator: **"Gemma 4 (Local)"**.
2. **Open the Deterministic Test Bench**:
   - Click **"Open Test Bench"** or type `"Navigate to http://localhost:3001/test-site"`.
   - The browser opens the deterministic catalog and application form.

---

## Act 2: Goal-Oriented Navigation & Form Filling (0:45 - 1:45)
3. **Page Understanding**:
   - Click **"Explain Page"** or speak/type: `"Tell me what is on this page."`
   - VisionOS summarizes key headings, landmarks, and catalog items without reading out 50 irrelevant navigation links.
4. **Direct Goal Navigation**:
   - Type or speak: `"Find the price filter."`
   - Gemma 4 plans the task, executes it, moves visual/screen-reader focus directly to the price filter dropdown, and verifies the active focus state.
5. **Form Assistance without Submission**:
   - Type: `"Fill in the application form with name Jordan Smith and email jordan@example.com."`
   - VisionOS fills the designated fields, verifies their values in the DOM, and safely stops before submission.

---

## Act 3: Consequential Approval Gate & Failure Recovery (1:45 - 3:00)
6. **Consequential Action Approval Gate**:
   - Type: `"Submit the application form."`
   - VisionOS detects the consequential nature of the action, pauses the pipeline, and displays the **Approval Modal**.
   - Explain: *"Gemma 4 enforces user consent. It never submits consequential forms without explicit confirmation."*
   - Click **"Confirm & Proceed"** to complete submission.
7. **Failure Recovery & Honest Explanations**:
   - Type: `"Click the nonexistent promo voucher button."`
   - The automation fails gracefully; Gemma 4 analyzes updated page context, detects the element is absent, and returns an honest explanation.
8. **Emergency Cancellation**:
   - Trigger a multi-step task and press `Esc` or click **"Cancel"** to demonstrate instant pipeline abortion.
