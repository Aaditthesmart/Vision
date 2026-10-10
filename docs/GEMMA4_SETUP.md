# VisionOS — Gemma 4 Integration & Local Inference Guide

VisionOS is built specifically around **Gemma 4** as the core reasoning and planning engine for accessibility workflows.

---

## 1. Why Gemma 4 for Accessibility?

Traditional screen-reader agents often rely on slow, expensive cloud APIs or generic models that lack structured grounding. Gemma 4 provides:
1. **High-Precision Structured Instruction Following**: Accurately maps natural-language requests into structured action plans (`GoalInterpretation` and `TaskPlan`).
2. **Compact Hardware Footprint**: Runs comfortably on commodity Windows laptops (e.g. 11th Gen Intel Core i5 with 16GB RAM and integrated graphics).
3. **Local Privacy**: Accessibility agents interact with sensitive emails, application forms, and browsing data. Gemma 4 keeps all DOM data entirely on the user's laptop.
4. **Zero-Paid-API Operation**: Ensures assistive technology remains universally accessible to all users without recurring subscription costs.

---

## 2. Model Selection & Requirements

| Model Variant | Parameters | Approximate VRAM / RAM | Recommended Hardware | Download Size |
| :--- | :--- | :--- | :--- | :--- |
| **Gemma 4** | Standard | 4-8 GB RAM | Intel Core i5 / AMD Ryzen 5, 16GB RAM | ~3-5 GB |
| **Gemma 2 (2B)** | 2.6 Billion | 2-4 GB RAM | Intel Core i3 / i5, 8GB RAM | 1.6 GB |
| **Gemma 2 (9B)** | 9.2 Billion | 8-12 GB RAM | Intel Core i7, 16GB+ RAM, GPU optional | 5.5 GB |

---

## 3. Configuring Ollama for Windows

By default, VisionOS connects to Ollama at `http://127.0.0.1:11434`.

To customize the model or host endpoint, set the following environment variables in `server/.env`:

```bash
# Ollama Host URL
OLLAMA_HOST=http://127.0.0.1:11434

# Primary Model Identifier
GEMMA_MODEL=gemma4:latest
```

### Automatic Model Fallback Detection
When the server boots, `ollamaClient.checkConnection()` queries `/api/tags`. If `gemma4:latest` is not yet installed on the machine, VisionOS automatically falls back to any available local Gemma variant (e.g., `gemma2:2b` or installed local models) while clearly surfacing the model status in the client UI.

---

## 4. Structured Output Validation

All Gemma 4 outputs are validated at runtime using Zod:

```typescript
export const TaskPlanSchema = z.object({
  userGoal: z.string(),
  summary: z.string(),
  requiresApproval: z.boolean(),
  estimatedRisk: z.enum(["LOW", "MEDIUM", "HIGH"]),
  steps: z.array(ActionStepSchema),
});
```

If model output deviates from the schema or Ollama is offline, VisionOS gracefully falls back to deterministic safe heuristics without crashing.
