/**
 * voiceRecognizer.ts
 * Native Windows Offline Speech Recognition via System.Speech.Recognition.
 * Zero cloud dependencies, zero paid APIs, works out of the box in Electron on Windows.
 */

import { spawn, type ChildProcess } from "child_process";
import { EventEmitter } from "events";
import * as path from "path";
import * as fs from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface VoiceRecognitionResult {
  transcript: string;
  confidence: number;
}

export class VoiceRecognizer extends EventEmitter {
  private psProcess: ChildProcess | null = null;
  private isListening = false;
  private scriptPath: string;

  constructor() {
    super();
    // Ensure scripts directory exists
    const scriptsDir = path.join(__dirname, "..", "..", "scripts");
    if (!fs.existsSync(scriptsDir)) {
      fs.mkdirSync(scriptsDir, { recursive: true });
    }
    this.scriptPath = path.join(scriptsDir, "voice_recognizer.ps1");

    const psContent = `
Add-Type -AssemblyName System.Speech
try {
    $rec = New-Object System.Speech.Recognition.SpeechRecognitionEngine
    $rec.SetInputToDefaultAudioDevice()
    $grammar = New-Object System.Speech.Recognition.DictationGrammar
    $rec.LoadGrammar($grammar)
    [Console]::WriteLine("READY_FOR_SPEECH")
    [Console]::Out.Flush()
    
    while ($true) {
        $result = $rec.Recognize([System.TimeSpan]::FromSeconds(2))
        if ($null -ne $result) {
            $txt = $result.Text
            $conf = $result.Confidence
            if (-not [string]::IsNullOrWhiteSpace($txt)) {
                [Console]::WriteLine("SPEECH:" + $conf + ":" + $txt)
                [Console]::Out.Flush()
            }
        }
    }
} catch {
    [Console]::WriteLine("ERROR:" + $_.Exception.Message)
    [Console]::Out.Flush()
}
`.trim();

    fs.writeFileSync(this.scriptPath, psContent, "utf-8");
  }

  /**
   * Start listening to the default microphone.
   */
  public start(): void {
    if (this.isListening) {
      console.log("[VoiceRecognizer] Already listening");
      return;
    }

    this.isListening = true;
    this.emit("listening_started");
    console.log("[VoiceRecognizer] Starting Windows Speech Recognition engine...");

    try {
      this.psProcess = spawn(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          this.scriptPath,
        ],
        { stdio: ["ignore", "pipe", "pipe"], shell: false },
      );

      this.psProcess.stdout?.on("data", (data: Buffer) => {
        const lines = data.toString().split(/\r?\n/);
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          if (trimmed === "READY_FOR_SPEECH") {
            console.log("[VoiceRecognizer] Windows microphone engine active and listening");
          } else if (trimmed.startsWith("SPEECH:")) {
            const parts = trimmed.slice(7).split(":");
            const confidence = parseFloat(parts[0]) || 0.8;
            const text = parts.slice(1).join(":").trim();
            if (text) {
              console.log(`[VoiceRecognizer] Recognized speech: "${text}" (conf: ${confidence})`);
              this.emit("transcript", { transcript: text, confidence });
            }
          } else if (trimmed.startsWith("ERROR:")) {
            console.error("[VoiceRecognizer] Error from engine:", trimmed);
            this.emit("error", trimmed.slice(6));
          }
        }
      });

      this.psProcess.stderr?.on("data", (data: Buffer) => {
        const errText = data.toString().trim();
        if (errText) {
          console.warn("[VoiceRecognizer] stderr:", errText);
        }
      });

      this.psProcess.on("close", (code) => {
        console.log(`[VoiceRecognizer] Process exited with code ${code}`);
        this.isListening = false;
        this.psProcess = null;
        this.emit("listening_stopped");
      });
    } catch (err) {
      this.isListening = false;
      this.psProcess = null;
      console.error("[VoiceRecognizer] Failed to spawn recognizer:", err);
      this.emit("error", String(err));
      this.emit("listening_stopped");
    }
  }

  /**
   * Stop listening and terminate the recognizer process.
   */
  public stop(): void {
    if (!this.isListening && !this.psProcess) return;
    console.log("[VoiceRecognizer] Stopping voice engine...");
    this.isListening = false;
    if (this.psProcess) {
      try {
        this.psProcess.kill("SIGTERM");
      } catch {
        // ignore
      }
      this.psProcess = null;
    }
    this.emit("listening_stopped");
  }

  public getStatus(): boolean {
    return this.isListening;
  }
}

export const voiceRecognizer = new VoiceRecognizer();
