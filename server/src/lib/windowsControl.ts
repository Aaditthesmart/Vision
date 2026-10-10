/**
 * windowsControl.ts
 * Windows-native system control via PowerShell / WScript / Win32.
 * Zero external dependencies, zero paid APIs.
 * Allows VisionOS to open apps, write code in VS Code, type text, control windows, run commands.
 */

import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

export interface SystemActionResult {
  success: boolean;
  output?: string;
  error?: string;
}

class WindowsControl {
  /**
   * Run a PowerShell command and capture output.
   */
  public async runPS(script: string, timeoutMs = 12000): Promise<SystemActionResult> {
    return new Promise((resolve) => {
      const ps = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], {
        stdio: ["ignore", "pipe", "pipe"],
        shell: false,
      });

      let stdout = "";
      let stderr = "";

      ps.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
      ps.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });

      const timer = setTimeout(() => {
        try { ps.kill(); } catch { /* ignore */ }
        resolve({ success: false, error: "Command timed out after " + timeoutMs + "ms" });
      }, timeoutMs);

      ps.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0) {
          resolve({ success: true, output: stdout.trim() });
        } else {
          resolve({ success: false, error: stderr.trim() || stdout.trim() || `Exit code ${code}` });
        }
      });
    });
  }

  // ── App Launching ───────────────────────────────────────────────────

  /**
   * Open a named application by name (e.g., "notepad", "calculator", "vs code", "chrome").
   */
  public async openApp(appName: string): Promise<SystemActionResult> {
    const nameMap: Record<string, string> = {
      "notepad": "notepad.exe",
      "calculator": "calc.exe",
      "paint": "mspaint.exe",
      "file explorer": "explorer.exe",
      "explorer": "explorer.exe",
      "edge": "msedge.exe",
      "microsoft edge": "msedge.exe",
      "chrome": "chrome.exe",
      "google chrome": "chrome.exe",
      "firefox": "firefox.exe",
      "word": "WINWORD.EXE",
      "microsoft word": "WINWORD.EXE",
      "excel": "EXCEL.EXE",
      "powerpoint": "POWERPNT.EXE",
      "vs code": "code",
      "vscode": "code",
      "visual studio code": "code",
      "cmd": "cmd.exe",
      "command prompt": "cmd.exe",
      "powershell": "powershell.exe",
      "task manager": "taskmgr.exe",
      "settings": "ms-settings:",
      "control panel": "control.exe",
      "snipping tool": "snippingtool.exe",
      "spotify": "spotify.exe",
      "vlc": "vlc.exe",
      "zoom": "zoom.exe",
      "whatsapp": "whatsapp.exe",
    };

    const key = appName.toLowerCase().trim();
    const exe = nameMap[key] || appName;

    // Special case for ms-settings
    if (exe.startsWith("ms-settings:")) {
      return this.runPS(`Start-Process "${exe}"`);
    }

    if (key.includes("vs code") || key.includes("vscode") || key.includes("visual studio code")) {
      return this.openVSCode();
    }

    return this.runPS(`Start-Process "${exe}" -ErrorAction SilentlyContinue`);
  }

  /**
   * Open VS Code, optionally with a file or folder path.
   */
  public async openVSCode(pathToOpen?: string): Promise<SystemActionResult> {
    const target = pathToOpen ? `"${pathToOpen}"` : ".";
    return this.runPS(`& code ${target} 2>&1; Write-Output "VS Code launched"`);
  }

  /**
   * Write code directly into VS Code or create a code file and open it in VS Code.
   */
  public async writeCodeInVSCode(code: string, fileName?: string): Promise<SystemActionResult> {
    try {
      if (fileName) {
        // Create file in user workspace or Desktop
        const desktopDir = path.join(os.homedir(), "Desktop");
        const filePath = path.isAbsolute(fileName) ? fileName : path.join(desktopDir, fileName);
        fs.writeFileSync(filePath, code, "utf-8");
        await this.runPS(`& code "${filePath}" 2>&1; Write-Output "Opened ${path.basename(filePath)} in VS Code"`);
        return { success: true, output: `Created and opened ${path.basename(filePath)} in VS Code with your code.` };
      }

      // If no file name, focus VS Code and type/paste the code
      const focusResult = await this.focusWindow("Visual Studio Code");
      if (!focusResult.success || focusResult.output?.includes("not found")) {
        // Launch VS Code and write to a new script
        const tempFile = path.join(os.homedir(), "Desktop", "visionos_script.py");
        fs.writeFileSync(tempFile, code, "utf-8");
        await this.runPS(`& code "${tempFile}" 2>&1`);
        return { success: true, output: `Wrote code to visionos_script.py on Desktop and opened in VS Code.` };
      }

      // Paste code via clipboard into active VS Code editor
      return await this.typeText(code);
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }

  /**
   * Type text in the currently focused application using clipboard paste for accuracy and speed.
   */
  public async typeText(text: string): Promise<SystemActionResult> {
    const escaped = text.replace(/'/g, "''");
    const script = `
Add-Type -AssemblyName System.Windows.Forms
$txt = @'
${text}
'@
[System.Windows.Forms.Clipboard]::SetText($txt)
Start-Sleep -Milliseconds 250
[System.Windows.Forms.SendKeys]::SendWait("^v")
Write-Output "Typed text into active window"
`.trim();

    return this.runPS(script);
  }

  /**
   * Send a keyboard shortcut to the active window (e.g., "ctrl+s", "enter", "f5").
   */
  public async sendKeys(shortcut: string): Promise<SystemActionResult> {
    const keyMap: Record<string, string> = {
      "ctrl+s": "^s",
      "save": "^s",
      "save file": "^s",
      "ctrl+c": "^c",
      "copy": "^c",
      "ctrl+v": "^v",
      "paste": "^v",
      "ctrl+x": "^x",
      "cut": "^x",
      "ctrl+z": "^z",
      "undo": "^z",
      "ctrl+y": "^y",
      "redo": "^y",
      "ctrl+a": "^a",
      "select all": "^a",
      "ctrl+f": "^f",
      "find": "^f",
      "ctrl+n": "^n",
      "new": "^n",
      "ctrl+w": "^w",
      "ctrl+t": "^t",
      "ctrl+`": "^`",
      "terminal": "^`",
      "f5": "{F5}",
      "run": "{F5}",
      "run code": "{F5}",
      "enter": "{ENTER}",
      "press enter": "{ENTER}",
      "escape": "{ESC}",
      "tab": "{TAB}",
      "backspace": "{BACKSPACE}",
      "delete": "{DELETE}",
      "space": " ",
      "alt+f4": "%{F4}",
      "alt+tab": "%{TAB}",
    };

    const key = shortcut.toLowerCase().trim();
    const sendKeyStr = keyMap[key] || key;

    const script = `
Add-Type -AssemblyName System.Windows.Forms
Start-Sleep -Milliseconds 200
[System.Windows.Forms.SendKeys]::SendWait("${sendKeyStr}")
Write-Output "Executed shortcut: ${shortcut}"
`.trim();

    return this.runPS(script);
  }

  /**
   * Take a screenshot and save it to Desktop.
   */
  public async takeScreenshot(): Promise<SystemActionResult> {
    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const desktop = path.join(os.homedir(), "Desktop");
    const outPath = path.join(desktop, `VisionOS_Screenshot_${ts}.png`).replace(/\\/g, "\\\\");

    const script = `
Add-Type -AssemblyName System.Windows.Forms
$screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bmp = New-Object System.Drawing.Bitmap($screen.Width, $screen.Height)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($screen.Location, [System.Drawing.Point]::Empty, $screen.Size)
$bmp.Save("${outPath}")
$g.Dispose(); $bmp.Dispose()
Write-Output "Screenshot saved to Desktop: VisionOS_Screenshot_${ts}.png"
`.trim();

    return this.runPS(script);
  }

  /**
   * List all currently open application windows.
   */
  public async listOpenWindows(): Promise<SystemActionResult> {
    const script = `Get-Process | Where-Object {$_.MainWindowTitle -ne ''} | ForEach-Object { "$($_.Name): $($_.MainWindowTitle)" }`;
    return this.runPS(script);
  }

  /**
   * Focus/bring a window to foreground by partial title match.
   */
  public async focusWindow(titlePart: string): Promise<SystemActionResult> {
    const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinAPI {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}
"@
$proc = Get-Process | Where-Object {$_.MainWindowTitle -like "*${titlePart}*"} | Select-Object -First 1
if ($proc) {
  [WinAPI]::ShowWindow($proc.MainWindowHandle, 9)
  [WinAPI]::SetForegroundWindow($proc.MainWindowHandle)
  Write-Output "Focused window: $($proc.MainWindowTitle)"
} else {
  Write-Output "Window not found containing: ${titlePart}"
}
`.trim();

    return this.runPS(script, 8000);
  }

  /**
   * Minimize, maximize, or close a window by partial title.
   */
  public async controlWindow(
    titlePart: string,
    action: "minimize" | "maximize" | "close",
  ): Promise<SystemActionResult> {
    const nCmdShow = action === "minimize" ? 6 : action === "maximize" ? 3 : 0;
    if (action === "close") {
      const script = `$proc = Get-Process | Where-Object {$_.MainWindowTitle -like "*${titlePart}*"} | Select-Object -First 1; if ($proc) { $proc.CloseMainWindow(); Write-Output "Closed: $($proc.MainWindowTitle)" } else { Write-Output "Window not found: ${titlePart}" }`;
      return this.runPS(script);
    }
    const script = `
Add-Type @"
using System.Runtime.InteropServices;
public class Win { [DllImport("user32.dll")] public static extern bool ShowWindow(System.IntPtr h, int n); }
"@
$proc = Get-Process | Where-Object {$_.MainWindowTitle -like "*${titlePart}*"} | Select-Object -First 1
if ($proc) { [Win]::ShowWindow($proc.MainWindowHandle, ${nCmdShow}); Write-Output "${action}d: $($proc.MainWindowTitle)" } else { Write-Output "Not found: ${titlePart}" }
`.trim();
    return this.runPS(script, 8000);
  }

  /**
   * Set system volume (0–100).
   */
  public async setVolume(level: number): Promise<SystemActionResult> {
    const clamped = Math.max(0, Math.min(100, level));
    const script = `
$wsh = New-Object -ComObject WScript.Shell
$keys = [Math]::Round((${clamped} / 2))
1..$keys | ForEach-Object { $wsh.SendKeys([char]175) }
Write-Output "Volume adjusted to approximately ${clamped}%"
`.trim();
    return this.runPS(script);
  }

  /**
   * Open a URL in the default browser.
   */
  public async openUrl(url: string): Promise<SystemActionResult> {
    const script = `Start-Process "${url}"; Write-Output "Opened URL: ${url}"`;
    return this.runPS(script);
  }
}

export const windowsControl = new WindowsControl();
