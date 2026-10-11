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

      // Task 1: Chrome search
      if (goal.intentCategory === "chrome_search") {
        emit("agent_status", "executing");
        const query = goal.targetLabelOrText || "";
        const result = await windowsControl.openChromeAndSearch(query);
        emit("agent_status", "idle");
        const msg = result.success ? `✅ ${result.output}` : `❌ ${result.error}`;
        emit("assistant_message", { role: "assistant", text: msg, speechText: msg });
        emit("task_completed", { success: result.success, message: msg, stepsExecuted: 1 });
        return { success: result.success, message: msg };
      }

      // Task 17: Compile and run code
      if (goal.intentCategory === "compile_run") {
        emit("agent_status", "executing");
        emit("assistant_message", { role: "assistant", text: "Compiling and running your code...", speechText: "Compiling and running." });
        const result = await windowsControl.compileAndRun();
        emit("agent_status", "idle");
        const msg = result.success ? `✅ Program output:\n${result.output}` : `❌ Compile/run error: ${result.error}`;
        emit("assistant_message", { role: "assistant", text: msg, speechText: result.success ? `Program output: ${result.output?.slice(0, 200)}` : `Error: ${result.error}` });
        emit("task_completed", { success: result.success, message: msg, stepsExecuted: 1 });
        return { success: result.success, message: msg };
      }

      // Task 18/21: Analyze code / fix bug
      if (goal.intentCategory === "analyze_code") {
        emit("agent_status", "thinking");
        const codeResult = await windowsControl.readCodeFileForAnalysis();
        if (!codeResult.success || !codeResult.code) {
          const errMsg = `❌ ${codeResult.error || "No code file found to analyze."}`;
          emit("assistant_message", { role: "assistant", text: errMsg, speechText: errMsg });
          emit("task_completed", { success: false, message: errMsg, stepsExecuted: 0 });
          return { success: false, message: errMsg };
        }
        const analysis = await gemma4Engine.generateCode(`Analyze this code and explain what it does, find any bugs, and suggest fixes:\n${codeResult.code}`);
        emit("agent_status", "idle");
        const msg = `📋 Code Analysis: ${codeResult.fileName}\n\n${analysis.summary}`;
        emit("assistant_message", { role: "assistant", text: msg, speechText: `Analysis of ${codeResult.fileName}: ${analysis.summary}` });
        emit("task_completed", { success: true, message: msg, stepsExecuted: 1 });
        return { success: true, message: msg };
      }

      // Task 22: Run tests
      if (goal.intentCategory === "run_tests") {
        emit("agent_status", "executing");
        emit("assistant_message", { role: "assistant", text: "Running your tests...", speechText: "Running tests." });
        const result = await windowsControl.runTests();
        emit("agent_status", "idle");
        const msg = result.success ? `✅ Test results:\n${result.output}` : `❌ Tests failed: ${result.error || result.output}`;
        emit("assistant_message", { role: "assistant", text: msg, speechText: result.success ? `Tests completed. ${result.output?.slice(0, 150)}` : `Tests failed. ${result.error}` });
        emit("task_completed", { success: result.success, message: msg, stepsExecuted: 1 });
        return { success: result.success, message: msg };
      }

      // Task 19: Create Python venv project
      if (goal.intentCategory === "create_python_project") {
        emit("agent_status", "executing");
        const name = goal.targetLabelOrText || "MyPythonProject";
        emit("assistant_message", { role: "assistant", text: `Creating Python project "${name}"...`, speechText: `Creating Python project ${name}.` });
        const result = await windowsControl.createPythonVenvProject(name);
        emit("agent_status", "idle");
        const msg = result.success ? `✅ ${result.output}` : `❌ ${result.error}`;
        emit("assistant_message", { role: "assistant", text: msg, speechText: msg });
        emit("task_completed", { success: result.success, message: msg, stepsExecuted: 1 });
        return { success: result.success, message: msg };
      }

      // Task 20: Create website
      if (goal.intentCategory === "create_website") {
        emit("agent_status", "executing");
        const name = goal.targetLabelOrText || "MyWebsite";
        emit("assistant_message", { role: "assistant", text: `Building website "${name}"...`, speechText: `Building website ${name}.` });
        const result = await windowsControl.createBasicWebsite(name);
        emit("agent_status", "idle");
        const msg = result.success ? `✅ ${result.output}` : `❌ ${result.error}`;
        emit("assistant_message", { role: "assistant", text: msg, speechText: msg });
        emit("task_completed", { success: result.success, message: msg, stepsExecuted: 1 });
        return { success: result.success, message: msg };
      }

      // Tasks 23-28: File operations
      if (goal.intentCategory === "file_ops") {
        emit("agent_status", "executing");
        const payload = goal.systemPayload || {};
        const fileAction = payload.action || "";
        let result: { success: boolean; output?: string; error?: string };

        switch (fileAction) {
          case "create_folder":
            result = await windowsControl.createFolder(payload.folderName || "New Folder");
            break;
          case "find_file":
            result = await windowsControl.findFileInDocuments(payload.query || "");
            break;
          case "create_notes":
            result = await windowsControl.createNotesFile();
            break;
          case "recent_file":
            result = await windowsControl.getMostRecentFile();
            break;
          case "open_in_vscode":
            result = await windowsControl.openFolderInVSCode(payload.folderName || "");
            break;
          default:
            result = { success: false, error: `Unknown file action: ${fileAction}` };
        }

        emit("agent_status", "idle");
        const msg = result.success ? `✅ ${result.output}` : `❌ ${result.error}`;
        emit("assistant_message", { role: "assistant", text: msg, speechText: msg });
        emit("task_completed", { success: result.success, message: msg, stepsExecuted: 1 });
        return { success: result.success, message: msg };
      }

      // 1. Write Code (in VS Code with AI code generation)
      if (goal.intentCategory === "write_code") {
        emit("agent_status", "thinking");
        emit("assistant_message", {
          role: "assistant",
          text: "Generating code with Gemma 4...",
          speechText: "Generating code.",
        });

        const generated = await gemma4Engine.generateCode(userInput);
        emit("agent_status", "executing");
        
        const result = await windowsControl.writeCodeInVSCode(generated.code, generated.fileName);
        emit("agent_status", "idle");
        
        const msg = result.success
          ? `✅ Generated ${generated.language} code for ${generated.summary}. Created "${generated.fileName}" on Desktop and opened in Visual Studio Code.`
          : `❌ Failed to write code into VS Code: ${result.error}`;
        
        emit("assistant_message", { role: "assistant", text: msg, speechText: `Created ${generated.fileName} in Visual Studio Code. ${generated.summary}` });
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

      // 3. YouTube Search & Auto-Play Video
      if (goal.intentCategory === "navigate" && goal.targetLabelOrText?.includes("youtube.com/results")) {
        emit("agent_status", "executing");
        const queryMatch = goal.targetLabelOrText.match(/search_query=([^&]+)/);
        const query = queryMatch ? decodeURIComponent(queryMatch[1]) : userInput.replace(/.*youtube/i, "").trim();
        
        emit("assistant_message", {
          role: "assistant",
          text: `Searching YouTube for "${query}" and playing video...`,
          speechText: `Searching YouTube for ${query}.`,
        });

        const ytResult = await browserAutomation.searchAndPlayYouTube(query);
        emit("agent_status", "idle");

        const msg = ytResult.success
          ? `🎬 Playing on YouTube: "${ytResult.videoTitle}"`
          : `✅ Opened YouTube search for "${query}".`;
        
        emit("assistant_message", { role: "assistant", text: msg, speechText: ytResult.success ? `Playing ${ytResult.videoTitle}` : `Opened YouTube for ${query}` });
        emit("task_completed", { success: true, message: msg, stepsExecuted: 2 });
        return { success: true, message: msg };
      }

      // 4. Google Search & Spoken Summary Extraction
      if (goal.intentCategory === "navigate" && goal.targetLabelOrText?.includes("google.com/search")) {
        emit("agent_status", "executing");
        const queryMatch = goal.targetLabelOrText.match(/q=([^&]+)/);
        const query = queryMatch ? decodeURIComponent(queryMatch[1]) : userInput.replace(/^search\s+/i, "").trim();

        emit("assistant_message", {
          role: "assistant",
          text: `Searching Google for "${query}"...`,
          speechText: `Searching Google for ${query}.`,
        });

        const gResult = await browserAutomation.searchGoogleAndGetSummary(query);
        emit("agent_status", "idle");

        emit("assistant_message", { role: "assistant", text: `🔍 Google Results for "${query}":\n${gResult.summary}`, speechText: gResult.summary });
        emit("task_completed", { success: true, message: gResult.summary, stepsExecuted: 1 });
        return { success: true, message: gResult.summary };
      }

      // 5. Type text into active window
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

      // 6. System control (screenshot, volume, shortcuts, window management, screen reading)
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
        } else if (action === "read_screen") {
          result = await windowsControl.readScreen();
        } else if (action === "active_window") {
          result = await windowsControl.getActiveWindow();
        } else if (action === "focus_window" && payload.window) {
          result = await windowsControl.focusWindow(payload.window);
        } else if (action === "spotify_next") {
          result = await windowsControl.spotifyNextTrack();
        } else if (action === "spotify_play_pause") {
          result = await windowsControl.spotifyNextTrack(); // reuse — sends media key
        } else if (action === "get_status") {
          const lastMsg = "The last action completed. Use 'tell me what is on screen' to check the current state.";
          result = { success: true, output: lastMsg };
        } else if (action === "cancel_task") {
          emit("agent_status", "idle");
          this.cancelCurrentTask();
          const cancelMsg = "Task cancelled. Ready for your next command.";
          emit("assistant_message", { role: "assistant", text: cancelMsg, speechText: cancelMsg });
          emit("task_completed", { success: true, message: cancelMsg, stepsExecuted: 0 });
          return { success: true, message: cancelMsg };
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
