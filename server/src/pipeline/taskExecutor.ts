import { browserAutomation } from "../lib/browserAutomation.js";
import { windowsControl } from "../lib/windowsControl.js";
import { gemma4Engine } from "../llm/gemma4.js";
import type {
  TaskPlan,
  ActionStep,
  PageContext,
} from "../types/accessibility.js";

export type ExecutionEventListener = (
  event:
    | "agent_status"
    | "task_plan"
    | "step_update"
    | "approval_required"
    | "assistant_message"
    | "execution_trace"
    | "task_completed",
  data: any,
) => void;

export class TaskExecutor {
  private activePlan: TaskPlan | null = null;
  private isCancelled = false;
  private pendingApprovalResolver: ((approved: boolean) => void) | null = null;

  public cancelCurrentTask(): void {
    console.log("[TaskExecutor] Cancellation requested");
    this.isCancelled = true;
    if (this.pendingApprovalResolver) {
      this.pendingApprovalResolver(false);
      this.pendingApprovalResolver = null;
    }
  }

  public resolveApproval(stepId: string, approved: boolean): void {
    console.log(`[TaskExecutor] Approval resolution for ${stepId}: ${approved}`);
    if (this.pendingApprovalResolver) {
      this.pendingApprovalResolver(approved);
      this.pendingApprovalResolver = null;
    }
  }

  public async runTask(
    userInput: string,
    emit: ExecutionEventListener,
  ): Promise<{ success: boolean; message: string }> {
    this.isCancelled = false;
    emit("agent_status", "thinking");
    emit("execution_trace", {
      timestamp: Date.now(),
      level: "info",
      message: `Received user goal: "${userInput}"`,
    });

    try {
      // 1. Extract current browser state
      let ctx: PageContext;
      try {
        ctx = await browserAutomation.extractPageContext();
      } catch (err) {
        emit("execution_trace", {
          timestamp: Date.now(),
          level: "warn",
          message: `Browser not yet navigated: ${err instanceof Error ? err.message : String(err)}`,
        });
        // Dummy default context if no page is open
        ctx = {
          url: "about:blank",
          title: "Blank Page",
          headings: [],
          landmarks: [],
          interactiveElements: [],
          forms: [],
          mainTextSummary: "No webpage is currently loaded.",
          alerts: [],
        };
      }

      // 2. Gemma 4 Goal Interpretation
      emit("execution_trace", {
        timestamp: Date.now(),
        level: "info",
        message: "Interpreting goal with local Gemma 4...",
      });
      const goal = await gemma4Engine.interpretGoal(userInput, ctx);

      emit("execution_trace", {
        timestamp: Date.now(),
        level: "info",
        message: `Interpreted Category: [${goal.intentCategory}], Consequential: ${goal.isConsequential}`,
        details: goal,
      });

      // ── System Control & Voice Actions: Short-circuit for Windows-native actions ──

      // 1. Write Code (in VS Code or active editor)
      if (goal.intentCategory === "write_code") {
        emit("agent_status", "executing");
        const codeText = goal.targetLabelOrText || userInput;
        const result = await windowsControl.writeCodeInVSCode(codeText);
        emit("agent_status", "idle");
        const msg = result.success
          ? `✅ ${result.output || `Wrote code into VS Code: "${codeText.substring(0, 50)}..."`}`
          : `❌ Failed to write code into VS Code: ${result.error}`;
        emit("assistant_message", { role: "assistant", text: msg, speechText: msg });
        emit("task_completed", { success: result.success, message: msg, stepsExecuted: 1 });
        return { success: result.success, message: msg };
      }

      // 2. Open application
      if (goal.intentCategory === "open_app") {
        emit("agent_status", "executing");
        const appName = goal.targetLabelOrText || "notepad";
        const result = await windowsControl.openApp(appName);
        emit("agent_status", "idle");
        const msg = result.success
          ? `✅ Opened ${appName} successfully.`
          : `❌ Could not open ${appName}: ${result.error}`;
        emit("assistant_message", { role: "assistant", text: msg, speechText: msg });
        emit("task_completed", { success: result.success, message: msg, stepsExecuted: 1 });
        return { success: result.success, message: msg };
      }

      // 3. Type text into active window
      if (goal.intentCategory === "type_text") {
        emit("agent_status", "executing");
        const textToType = goal.targetLabelOrText || "";
        const result = await windowsControl.typeText(textToType);
        emit("agent_status", "idle");
        const msg = result.success
          ? `✅ Typed: "${textToType.substring(0, 60)}${textToType.length > 60 ? "..." : ""}"`
          : `❌ Could not type text: ${result.error}`;
        emit("assistant_message", { role: "assistant", text: msg, speechText: msg });
        emit("task_completed", { success: result.success, message: msg, stepsExecuted: 1 });
        return { success: result.success, message: msg };
      }

      // 4. System control (screenshot, volume, shortcuts, window management)
      if (goal.intentCategory === "system_control") {
        emit("agent_status", "executing");
        const payload = goal.systemPayload || {};
        const action = payload.action || "";
        let result;

        if (action === "shortcut" && payload.shortcut) {
          result = await windowsControl.sendKeys(payload.shortcut);
        } else if (action === "screenshot") {
          result = await windowsControl.takeScreenshot();
        } else if (action === "volume" && payload.level) {
          result = await windowsControl.setVolume(parseInt(payload.level, 10));
        } else if (action === "list_windows") {
          result = await windowsControl.listOpenWindows();
        } else if ((action === "minimize" || action === "maximize" || action === "close") && payload.window !== undefined) {
          result = await windowsControl.controlWindow(
            payload.window || "",
            action as "minimize" | "maximize" | "close",
          );
        } else {
          result = { success: false, error: "Unknown system action: " + action };
        }

        emit("agent_status", "idle");
        const resultOutput = result?.output || "";
        const msg = result?.success
          ? `✅ ${goal.explanation}${resultOutput ? " " + resultOutput : ""}`
          : `❌ System action failed: ${result?.error}`;
        emit("assistant_message", { role: "assistant", text: msg, speechText: msg });
        emit("task_completed", { success: !!result?.success, message: msg, stepsExecuted: 1 });
        return { success: !!result?.success, message: msg };
      }

      // If goal is page understanding, explain immediately
      if (goal.intentCategory === "page_understanding") {
        emit("agent_status", "thinking");
        const explanation = await gemma4Engine.explainPage(ctx, userInput);
        emit("agent_status", "idle");
        emit("assistant_message", {
          role: "assistant",
          text: explanation,
          speechText: explanation,
        });
        emit("task_completed", { success: true, message: explanation, stepsExecuted: 0 });
        return { success: true, message: explanation };
      }

      // 3. Plan Navigation / Actions
      emit("execution_trace", {
        timestamp: Date.now(),
        level: "info",
        message: "Generating bounded action plan...",
      });
      const plan = await gemma4Engine.planTask(goal, ctx);
      this.activePlan = plan;
      emit("task_plan", plan);

      if (plan.steps.length === 0) {
        emit("assistant_message", {
          role: "assistant",
          text: goal.explanation,
          speechText: goal.explanation,
        });
        emit("agent_status", "idle");
        emit("task_completed", { success: true, message: goal.explanation, stepsExecuted: 0 });
        return { success: true, message: goal.explanation };
      }

      // 4. Execute Steps with Verification and Safety Gates
      emit("agent_status", "executing");
      let stepsExecuted = 0;

      for (let i = 0; i < plan.steps.length; i++) {
        if (this.isCancelled) {
          emit("agent_status", "idle");
          emit("assistant_message", {
            role: "system",
            text: "Task was cancelled by the user.",
            speechText: "Task cancelled.",
          });
          emit("task_completed", { success: false, message: "Task cancelled by user", stepsExecuted });
          return { success: false, message: "Cancelled by user" };
        }

        const step = plan.steps[i];

        // Approval Gate for consequential actions
        if (step.requiresApproval || step.isConsequential) {
          step.requiresApproval = true;
          step.isConsequential = true;
          step.status = "WAITING_FOR_APPROVAL";
          emit("step_update", step);
          emit("agent_status", "waiting_approval");
          emit("approval_required", {
            stepId: step.id,
            description: step.description,
            expectedOutcome: step.expectedOutcome,
            isConsequential: step.isConsequential,
          });

          emit("assistant_message", {
            role: "assistant",
            text: `Approval required: ${step.description}. Do you confirm?`,
            speechText: `Approval required for ${step.description}. Please confirm or cancel.`,
          });

          const approved = await new Promise<boolean>((resolve) => {
            this.pendingApprovalResolver = resolve;
          });

          if (!approved || this.isCancelled) {
            step.status = "CANCELLED";
            emit("step_update", step);
            emit("agent_status", "idle");
            emit("assistant_message", {
              role: "system",
              text: `Action "${step.description}" was declined by the user.`,
              speechText: "Action declined.",
            });
            emit("task_completed", { success: false, message: "Action declined by user", stepsExecuted });
            return { success: false, message: "Action declined" };
          }
        }

        // Execute step
        step.status = "EXECUTING";
        emit("step_update", step);
        emit("execution_trace", {
          timestamp: Date.now(),
          level: "info",
          message: `Executing step #${i + 1}: ${step.description}`,
        });

        const execResult = await this.executeSingleStep(step);

        if (!execResult.success) {
          step.status = "FAILED";
          step.error = execResult.error;
          emit("step_update", step);
          emit("execution_trace", {
            timestamp: Date.now(),
            level: "error",
            message: `Step #${i + 1} failed: ${execResult.error}`,
          });

          // Trigger Autonomous Recovery
          emit("agent_status", "recovering");
          const updatedCtx = await browserAutomation.extractPageContext();
          const recovery = await gemma4Engine.planRecovery(step, execResult.error || "Unknown error", updatedCtx);

          if (recovery.canRecover && recovery.alternativeSteps.length > 0) {
            emit("assistant_message", {
              role: "assistant",
              text: `Notice: ${recovery.explanation} Attempting recovery...`,
              speechText: "Attempting alternative action.",
            });

            // Execute recovery steps
            let recoverySuccess = true;
            for (const rStep of recovery.alternativeSteps) {
              rStep.status = "EXECUTING";
              emit("step_update", rStep);
              const rResult = await this.executeSingleStep(rStep);
              if (rResult.success) {
                rStep.status = "SUCCEEDED";
                rStep.verificationEvidence = rResult.evidence;
                emit("step_update", rStep);
              } else {
                rStep.status = "FAILED";
                rStep.error = rResult.error;
                emit("step_update", rStep);
                recoverySuccess = false;
                break;
              }
            }

            if (recoverySuccess) {
              step.status = "SUCCEEDED";
              step.verificationEvidence = "Recovered via alternative action";
              emit("step_update", step);
              stepsExecuted++;
              continue;
            }
          }

          // Recovery failed or not possible
          emit("agent_status", "error");
          emit("assistant_message", {
            role: "error",
            text: `Action failed: ${recovery.explanation}`,
            speechText: `Action could not be completed. ${recovery.explanation}`,
          });
          emit("task_completed", { success: false, message: recovery.explanation, stepsExecuted });
          return { success: false, message: recovery.explanation };
        }

        // Step 5: Verification Phase
        step.status = "VERIFYING";
        emit("step_update", step);
        const verification = await browserAutomation.verifyState(
          step.verificationMethod,
          step.value || step.expectedOutcome,
          step.selector,
        );

        if (verification.verified) {
          step.status = "SUCCEEDED";
          step.verificationEvidence = verification.evidence;
          emit("step_update", step);
          emit("execution_trace", {
            timestamp: Date.now(),
            level: "info",
            message: `Step #${i + 1} verified: ${verification.evidence}`,
          });
          stepsExecuted++;
        } else {
          step.status = "FAILED";
          step.error = verification.evidence;
          emit("step_update", step);
          emit("execution_trace", {
            timestamp: Date.now(),
            level: "warn",
            message: `Verification check failed: ${verification.evidence}`,
          });
        }

        if (this.isCancelled) {
          emit("agent_status", "idle");
          emit("assistant_message", {
            role: "system",
            text: "Task was cancelled by the user.",
            speechText: "Task cancelled.",
          });
          emit("task_completed", { success: false, message: "Task cancelled by user", stepsExecuted });
          return { success: false, message: "Task cancelled by user" };
        }
      }

      if (this.isCancelled) {
        emit("agent_status", "idle");
        emit("task_completed", { success: false, message: "Task cancelled by user", stepsExecuted });
        return { success: false, message: "Task cancelled by user" };
      }

      emit("agent_status", "idle");
      const completionMsg = `Completed task: ${plan.summary}`;
      emit("assistant_message", {
        role: "assistant",
        text: completionMsg,
        speechText: completionMsg,
      });
      emit("task_completed", { success: true, message: completionMsg, stepsExecuted });
      return { success: true, message: completionMsg };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error("[TaskExecutor] Error running task:", err);
      emit("agent_status", "error");
      emit("assistant_message", {
        role: "error",
        text: `An unexpected error occurred: ${errorMsg}`,
        speechText: "An error occurred during task execution.",
      });
      emit("task_completed", { success: false, message: errorMsg, stepsExecuted: 0 });
      return { success: false, message: errorMsg };
    }
  }

  private async executeSingleStep(
    step: ActionStep,
  ): Promise<{ success: boolean; evidence?: string; error?: string }> {
    switch (step.actionType) {
      case "locate_and_focus":
        if (!step.selector) return { success: false, error: "No selector for focus action" };
        return await browserAutomation.locateAndFocus(step.selector);

      case "click":
        if (!step.selector) return { success: false, error: "No selector for click action" };
        return await browserAutomation.clickElement(step.selector);

      case "fill":
        if (!step.selector) return { success: false, error: "No selector for fill action" };
        return await browserAutomation.fillField(step.selector, step.value || "");

      case "select":
        if (!step.selector) return { success: false, error: "No selector for select action" };
        return await browserAutomation.selectOption(step.selector, step.value || "");

      case "navigate":
        if (!step.value) return { success: false, error: "No URL provided for navigation" };
        const nav = await browserAutomation.navigate(step.value);
        return { success: nav.success, evidence: `Navigated to ${nav.url}`, error: nav.error };

      case "explain": {
        try {
          const updatedCtx = await browserAutomation.extractPageContext();
          const summary = await gemma4Engine.explainPage(updatedCtx);
          return { success: true, evidence: summary };
        } catch {
          return { success: true, evidence: "Page loaded" };
        }
      }

      default:
        return { success: true, evidence: "Step completed" };
    }
  }
}

export const taskExecutor = new TaskExecutor();
