import "dotenv/config";
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { createHandler } from "./socket/handler.js";
import { browserAutomation } from "./lib/browserAutomation.js";
import { ollamaClient } from "./llm/ollama.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = parseInt(process.env.PORT || "3001", 10);

async function start() {
  console.log("=================================================");
  console.log(" VisionOS Accessibility Server (Zero-Paid-API) ");
  console.log(" Powered by Local Gemma 4 via Ollama             ");
  console.log("=================================================");

  // 1. Verify Local Ollama Connection
  const ollamaStatus = await ollamaClient.checkConnection();
  if (ollamaStatus.connected) {
    console.log(`[Server] Local Ollama: CONNECTED (Model: ${ollamaStatus.selectedModel})`);
    console.log(`[Server] Available models: ${ollamaStatus.models.join(", ") || "none"}`);
  } else {
    console.warn(`[Server] Local Ollama NOT detected at http://127.0.0.1:11434 (${ollamaStatus.error})`);
    console.warn("[Server] Operating in deterministic fallback mode until Ollama is started.");
  }

  // 2. Express + HTTP Server
  const app = express();
  app.use(cors());
  app.use(express.json());

  // Serve the Deterministic Test Website
  const testSitePath = path.join(__dirname, "test-site");
  app.use("/test-site", express.static(testSitePath));
  console.log(`[Server] Test Bench available at: http://localhost:${PORT}/test-site`);

  // Health and Status Endpoints
  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      zeroPaidApi: true,
      ollamaConnected: ollamaStatus.connected,
      selectedModel: ollamaStatus.selectedModel,
    });
  });

  app.get("/api/model-status", async (_req, res) => {
    const status = await ollamaClient.checkConnection();
    res.json({
      provider: "ollama_local",
      modelName: status.selectedModel,
      connected: status.connected,
      availableModels: status.models,
      zeroPaidApi: true,
      error: status.error,
    });
  });

  const httpServer = createServer(app);

  // 3. Socket.IO Setup
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
  });

  const handleConnection = createHandler();
  io.on("connection", handleConnection);

  httpServer.listen(PORT, () => {
    console.log(`[Server] Listening on http://localhost:${PORT}`);
    console.log("[Server] Ready for Electron and Web Accessibility Clients.");
  });

  // Graceful shutdown
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, async () => {
      console.log(`\n[Server] ${signal} received — shutting down browser and server.`);
      await browserAutomation.close();
      httpServer.close();
      process.exit(0);
    });
  }
}

start().catch((err) => {
  console.error("[Server] Fatal startup error:", err);
  process.exit(1);
});
