import type { Socket } from "socket.io";
import { taskExecutor } from "../pipeline/taskExecutor.js";
import { browserAutomation } from "../lib/browserAutomation.js";
import { ollamaClient } from "../llm/ollama.js";
import { gemma4Engine } from "../llm/gemma4.js";
import { voiceRecognizer } from "../lib/voiceRecognizer.js";
import type { ModelStatus } from "../types/accessibility.js";

export function createHandler() {
  return function handleConnection(socket: Socket) {
    console.log(`[Socket] VisionOS Accessibility Client connected: ${socket.id}`);

    const emitEvent = (event: string, data: any) => {
      socket.emit(event, data);
    };

    // Send initial model connection status immediately
    ollamaClient.checkConnection().then((status) => {
      const modelStatus: ModelStatus = {
        provider: "ollama_local",
        modelName: status.selectedModel,
        connected: status.connected,
        availableModels: status.models,
        zeroPaidApi: true,
        error: status.error,
      };
      socket.emit("model_status", modelStatus);
      console.log(`[Socket] Sent model status to ${socket.id}:`, modelStatus);
    });

    // ── Voice Recognition Socket Events ────────────────────────────
    const onTranscript = async (res: { transcript: string; confidence: number }) => {
      socket.emit("voice_transcript", res);
      // Auto-execute the recognized voice command
      if (res.transcript && res.transcript.trim()) {
        console.log(`[Voice Recognition] Auto-executing voice goal: "${res.transcript}"`);
        await taskExecutor.runTask(res.transcript.trim(), (event, data) => {
          emitEvent(event, data);
        });
      }
    };

    const onInterim = (interimText: string) => {
      socket.emit("voice_interim", { text: interimText });
    };

    const onListeningStarted = () => {
      socket.emit("voice_status", { listening: true });
    };

    const onListeningStopped = () => {
      socket.emit("voice_status", { listening: false });
    };

    const onVoiceError = (err: string) => {
      socket.emit("voice_error", { error: err });
    };

    voiceRecognizer.on("transcript", onTranscript);
    voiceRecognizer.on("interim", onInterim);
    voiceRecognizer.on("listening_started", onListeningStarted);
    voiceRecognizer.on("listening_stopped", onListeningStopped);
    voiceRecognizer.on("error", onVoiceError);

    socket.on("start_voice", () => {
      console.log("[Socket] Received start_voice request");
      voiceRecognizer.start();
    });

    socket.on("stop_voice", () => {
      console.log("[Socket] Received stop_voice request");
      voiceRecognizer.stop();
    });

    // 1. Natural language user goal
    socket.on("user_message", async (payload: { text: string }) => {
      const text = payload.text?.trim();
      if (!text) return;
      console.log(`[Socket] User goal received: "${text}"`);

      await taskExecutor.runTask(text, (event, data) => {
        emitEvent(event, data);
      });
    });

    // 2. Consequential Action Approval Gate
    socket.on("approve_action", (payload: { stepId: string; approved: boolean }) => {
      console.log(`[Socket] User approval response for ${payload.stepId}: ${payload.approved}`);
      taskExecutor.resolveApproval(payload.stepId, payload.approved);
    });

    // 3. User Task Cancellation
    socket.on("cancel_task", () => {
      console.log("[Socket] User requested task cancellation");
      taskExecutor.cancelCurrentTask();
    });

    // 4. Request Page Summary / Explanation
    socket.on("request_page_summary", async () => {
      try {
        const ctx = await browserAutomation.extractPageContext();
        const summary = await gemma4Engine.explainPage(ctx);
        socket.emit("page_summary", {
          title: ctx.title,
          url: ctx.url,
          summary,
          headings: ctx.headings,
          landmarkCount: ctx.landmarks.length,
        });
        socket.emit("assistant_message", {
          role: "assistant",
          text: summary,
          speechText: summary,
        });
      } catch (err) {
        socket.emit("assistant_message", {
          role: "error",
          text: "No webpage is currently open or loaded.",
          speechText: "No webpage is currently open.",
        });
      }
    });

    // 5. Explicit URL Navigation
    socket.on("navigate_url", async (payload: { url: string }) => {
      if (!payload.url) return;
      console.log(`[Socket] Client requested navigation to: ${payload.url}`);
      socket.emit("agent_status", "executing");
      const res = await browserAutomation.navigate(payload.url);
      socket.emit("agent_status", "idle");

      if (res.success) {
        const ctx = await browserAutomation.extractPageContext();
        const summary = await gemma4Engine.explainPage(ctx);
        socket.emit("page_summary", {
          title: res.title,
          url: res.url,
          summary,
          headings: ctx.headings,
          landmarkCount: ctx.landmarks.length,
        });
        socket.emit("assistant_message", {
          role: "assistant",
          text: `Navigated to "${res.title}". ${summary}`,
          speechText: `Navigated to ${res.title}.`,
        });
      } else {
        socket.emit("assistant_message", {
          role: "error",
          text: `Failed to navigate to ${payload.url}: ${res.error}`,
          speechText: "Navigation failed.",
        });
      }
    });

    // 6. Request Model Status
    socket.on("request_model_status", async () => {
      const status = await ollamaClient.checkConnection();
      socket.emit("model_status", {
        provider: "ollama_local",
        modelName: status.selectedModel,
        connected: status.connected,
        availableModels: status.models,
        zeroPaidApi: true,
        error: status.error,
      });
    });

    socket.on("disconnect", () => {
      console.log(`[Socket] Client disconnected: ${socket.id}`);
      voiceRecognizer.off("transcript", onTranscript);
      voiceRecognizer.off("interim", onInterim);
      voiceRecognizer.off("listening_started", onListeningStarted);
      voiceRecognizer.off("listening_stopped", onListeningStopped);
      voiceRecognizer.off("error", onVoiceError);
      voiceRecognizer.stop();
    });
  };
}
