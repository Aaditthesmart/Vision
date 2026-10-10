/**
 * voiceRecognizer.ts
 * Native Windows Offline Speech Recognition via System.Speech.Recognition.
 * Zero cloud dependencies, zero paid APIs, works out of the box in Electron on Windows.
 */

import { spawn, type ChildProcess } from "child_process";
import { EventEmitter } from "events";

export interface VoiceRecognitionResult {
  transcript: string;
  confidence: number;
}

export class VoiceRecognizer extends EventEmitter {
  private psProcess: ChildProcess | null = null;
  private isListening = false;

  constructor() {
    super();
  }

  /**
   * Start listening to the default microphone.
   * Emits:
   * - "listening_started"
   * - "transcript" (string)
   * - "listening_stopped"
   * - "error" (string)
   */
  public start(): void {
    if (this.isListening) {
      return;
    }

    this.isListening = true;
    this.emit("listening_started");

    // PowerShell script that loads System.Speech and runs continuous speech recognition
    const script = `
Add-Type -AssemblyName System.Speech
try {
  $rec = New-Object System.Speech.Recognition.SpeechRecognitionEngine
  $rec.SetInputToDefaultAudioDevice()
  $dictation = New-Object System.Speech.Recognition.DictationGrammar
  $rec.LoadGrammar($dictation)
  Write-Output "READY_FOR_SPEECH"

  Register-ObjectEvent -InputObject $rec -EventName "SpeechRecognized" -Action {
    $txt = $Event.SourceEventArgs.Result.Text
    $conf = $Event.SourceEventArgs.Result.Confidence
    Write-Output "SPEECH:$conf:$txt"
  } | Out-Null

  Register-ObjectEvent -InputObject $rec -EventName "SpeechHypothesized" -Action {
    $txt = $Event.SourceEventArgs.Result.Text
    Write-Output "HYPO:$txt"
  } | Out-Null

  $rec.RecognizeAsync([System.Speech.Recognition.RecognizeMode]::Multiple)
  
  # Keep process alive until standard input is closed or stop signal
  while ($true) {
    Start-Sleep -Milliseconds 200
  }
} catch {
  Write-Output ("ERROR:" + $_.Exception.Message)
}
`.trim();

    try {
      this.psProcess = spawn(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
        { stdio: ["pipe", "pipe", "pipe"], shell: false },
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
              console.log(`[VoiceRecognizer] Recognized: "${text}" (conf: ${confidence})`);
              this.emit("transcript", { transcript: text, confidence });
            }
          } else if (trimmed.startsWith("HYPO:")) {
            const text = trimmed.slice(5).trim();
            if (text) {
              this.emit("interim", text);
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
        console.log(`[VoiceRecognizer] Process closed with code ${code}`);
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
    this.isListening = false;
    if (this.psProcess) {
      try {
        this.psProcess.kill();
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
