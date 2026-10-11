import { z } from "zod";

// ── Page & Accessibility Elements ──────────────────────────────────

export interface AccessibleElement {
  id: string;
  role: string;
  name: string;
  tagName: string;
  text?: string;
  value?: string;
  placeholder?: string;
  href?: string;
  selector: string;
  type?: string;
  disabled?: boolean;
  checked?: boolean;
  focused?: boolean;
  isVisible: boolean;
  location?: { x: number; y: number; width: number; height: number };
}

export interface HeadingItem {
  level: number;
  text: string;
  id?: string;
}

export interface LandmarkItem {
  role: string;
  label?: string;
  selector: string;
}

export interface FormItem {
  id: string;
  name?: string;
  label?: string;
  fields: {
    role: string;
    label: string;
    type: string;
    name?: string;
    value?: string;
    placeholder?: string;
    required?: boolean;
    selector: string;
  }[];
}

export interface PageContext {
  url: string;
  title: string;
  headings: HeadingItem[];
  landmarks: LandmarkItem[];
  interactiveElements: AccessibleElement[];
  forms: FormItem[];
  mainTextSummary: string;
  alerts: string[];
  screenshotBase64?: string;
}

// ── Goal Interpretation Schemas ────────────────────────────────────

export const GoalInterpretationSchema = z.object({
  userGoal: z.string().describe("Concise representation of the user's intent"),
  intentCategory: z.enum([
    "page_understanding",
    "find_and_focus",
    "search_results",
    "form_fill",
    "navigate",
    "action",
    "clarify",
    "open_app",       // Open a Windows application
    "type_text",      // Type text into the currently focused app
    "write_code",     // Write code into VS Code or text editor
    "system_control", // System-level commands: volume, screenshot, window control, shortcuts
    "run_command",    // Run a safe shell/PowerShell command
    "chrome_search",  // Open Chrome and search Google
    "compile_run",    // Compile and run current code file
    "analyze_code",   // Explain/fix/find bugs in code
    "run_tests",      // Run project tests
    "create_python_project", // Create Python project with venv
    "create_website", // Build HTML/CSS/JS website
    "file_ops",       // File operations: create folder, find file, notes, recent file
  ]),
  targetElementDescription: z.string().nullable().optional().describe("Description of element or area to interact with"),
  targetRole: z.string().nullable().optional().describe("Role like button, link, textbox, filter"),
  targetLabelOrText: z.string().nullable().optional().describe("Expected label or text of target"),
  formData: z.record(z.string(), z.string()).nullable().optional().describe("Key-value pairs for form filling"),
  systemPayload: z.record(z.string(), z.string()).nullable().optional().describe("Extra key-value pairs for system commands"),
  isConsequential: z.boolean().default(false).describe("True if action submits form, buys item, deletes data, etc."),
  clarificationNeeded: z.string().nullable().optional().describe("Question to ask user if goal is ambiguous"),
  explanation: z.string().describe("Natural language explanation for the user"),
});

export type GoalInterpretation = z.infer<typeof GoalInterpretationSchema>;

// ── Action Step Lifecycle ──────────────────────────────────────────

export type ActionStatus =
  | "PLANNED"
  | "WAITING_FOR_APPROVAL"
  | "EXECUTING"
  | "VERIFYING"
  | "SUCCEEDED"
  | "FAILED"
  | "RECOVERY_REQUIRED"
  | "CANCELLED";

export const ActionStepSchema = z.object({
  id: z.string(),
  description: z.string().describe("User-friendly explanation of the step"),
  actionType: z.enum([
    "navigate",
    "locate_and_focus",
    "click",
    "fill",
    "select",
    "scroll",
    "extract",
    "verify",
    "explain",
  ]),
  selector: z.string().optional().describe("CSS selector or locator strategy"),
  targetRole: z.string().optional(),
  targetName: z.string().optional(),
  value: z.string().optional().describe("Value to fill or URL to navigate to"),
  expectedOutcome: z.string().describe("What should be true after this action completes"),
  verificationMethod: z.enum([
    "url_change",
    "element_focused",
    "value_matched",
    "content_present",
    "element_visible",
    "page_loaded",
    "none",
  ]),
  isConsequential: z.boolean().default(false),
  requiresApproval: z.boolean().default(false),
  status: z.enum([
    "PLANNED",
    "WAITING_FOR_APPROVAL",
    "EXECUTING",
    "VERIFYING",
    "SUCCEEDED",
    "FAILED",
    "RECOVERY_REQUIRED",
    "CANCELLED",
  ]).default("PLANNED"),
  error: z.string().optional(),
  verificationEvidence: z.string().optional(),
});

export type ActionStep = z.infer<typeof ActionStepSchema>;

export const TaskPlanSchema = z.object({
  userGoal: z.string(),
  summary: z.string().describe("Short explanation of the planned workflow"),
  steps: z.array(ActionStepSchema),
  requiresApproval: z.boolean().default(false),
  estimatedRisk: z.enum(["LOW", "MEDIUM", "HIGH"]).default("LOW"),
});

export type TaskPlan = z.infer<typeof TaskPlanSchema>;

// ── Recovery Plan Schema ───────────────────────────────────────────

export const RecoveryPlanSchema = z.object({
  canRecover: z.boolean().describe("Whether an alternative safe path exists"),
  explanation: z.string().describe("Explanation of why the step failed and what to do next"),
  alternativeSteps: z.array(ActionStepSchema).default([]),
});

export type RecoveryPlan = z.infer<typeof RecoveryPlanSchema>;

// ── Model Status & Diagnostics ─────────────────────────────────────

export interface ModelStatus {
  provider: "ollama_local";
  modelName: string;
  connected: boolean;
  availableModels: string[];
  zeroPaidApi: boolean;
  error?: string;
}

// ── Client-Server Socket Events ────────────────────────────────────

export interface ClientToServerEvents {
  user_message: (data: { text: string; conversationId?: string }) => void;
  approve_action: (data: { stepId: string; approved: boolean }) => void;
  cancel_task: () => void;
  request_page_summary: () => void;
  request_model_status: () => void;
  navigate_url: (data: { url: string }) => void;
}

export interface ServerToClientEvents {
  agent_status: (status: "idle" | "listening" | "thinking" | "executing" | "waiting_approval" | "verifying" | "recovering" | "error") => void;
  model_status: (status: ModelStatus) => void;
  page_summary: (data: { title: string; url: string; summary: string; headings: HeadingItem[]; landmarkCount: number }) => void;
  task_plan: (plan: TaskPlan) => void;
  step_update: (step: ActionStep) => void;
  approval_required: (data: { stepId: string; description: string; expectedOutcome: string; isConsequential: boolean }) => void;
  assistant_message: (data: { text: string; role: "assistant" | "system" | "error"; speechText?: string }) => void;
  execution_trace: (data: { timestamp: number; level: "info" | "warn" | "error"; message: string; details?: any }) => void;
  task_completed: (data: { success: boolean; message: string; stepsExecuted: number }) => void;
}
