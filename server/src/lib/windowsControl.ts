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
   * Find the actual installed path for VS Code executable on Windows.
   */
  public getVSCodePath(): string {
    const candidatePaths = [
      path.join(os.homedir(), "AppData", "Local", "Programs", "Microsoft VS Code", "bin", "code.cmd"),
      path.join(os.homedir(), "AppData", "Local", "Programs", "Microsoft VS Code", "Code.exe"),
      "C:\\Program Files\\Microsoft VS Code\\bin\\code.cmd",
      "C:\\Program Files\\Microsoft VS Code\\Code.exe",
      "C:\\Program Files (x86)\\Microsoft VS Code\\bin\\code.cmd",
    ];

    for (const p of candidatePaths) {
      if (fs.existsSync(p)) {
        return p;
      }
    }
    return "code";
  }

  /**
   * Run a PowerShell command and capture output.
   */
  public async runPS(script: string, timeoutMs = 15000): Promise<SystemActionResult> {
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
    if (key.includes("vs code") || key.includes("vscode") || key.includes("visual studio code")) {
      return this.openVSCode();
    }

    const exe = nameMap[key] || appName;

    // Special case for ms-settings
    if (exe.startsWith("ms-settings:")) {
      return this.runPS(`Start-Process "${exe}"`);
    }

    return this.runPS(`Start-Process "${exe}" -ErrorAction SilentlyContinue`);
  }

  /**
   * Open VS Code, optionally with a file or folder path.
   */
  public async openVSCode(pathToOpen?: string): Promise<SystemActionResult> {
    const vsCodeExe = this.getVSCodePath();
    const target = pathToOpen ? pathToOpen.replace(/'/g, "''") : ".";
    const script = `& '${vsCodeExe}' '${target}' 2>&1; Write-Output "VS Code launched"`;
    return this.runPS(script);
  }

  /**
   * Write code directly into VS Code or create a code file and open it in VS Code.
   */
  public async writeCodeInVSCode(code: string, fileName?: string): Promise<SystemActionResult> {
    try {
      const desktopDir = path.join(os.homedir(), "Desktop");
      const targetFileName = fileName || "visionos_code.py";
      const filePath = path.isAbsolute(targetFileName)
        ? targetFileName
        : path.join(desktopDir, targetFileName);

      // Write code file to disk
      fs.writeFileSync(filePath, code, "utf-8");

      // Open file in VS Code using resolved executable
      const vsCodeExe = this.getVSCodePath();
      const escapedPath = filePath.replace(/'/g, "''");
      const script = `
& '${vsCodeExe}' -g '${escapedPath}' 2>&1
Start-Sleep -Milliseconds 800
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinVS {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}
"@
$proc = Get-Process | Where-Object { $_.ProcessName -eq "Code" -or $_.MainWindowTitle -like "*Visual Studio Code*" } | Select-Object -First 1
if ($proc) {
  [WinVS]::ShowWindow($proc.MainWindowHandle, 9)
  [WinVS]::SetForegroundWindow($proc.MainWindowHandle)
}
Write-Output "Opened ${path.basename(filePath)} in Visual Studio Code"
`.trim();

      const result = await this.runPS(script);
      return {
        success: true,
        output: `Created and opened "${path.basename(filePath)}" in Visual Studio Code with the generated code.`,
      };
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
    const script = `Get-Process | Where-Object { $_.MainWindowTitle -ne '' } | ForEach-Object { "$($_.Name): $($_.MainWindowTitle)" }`;
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
$proc = Get-Process | Where-Object { $_.MainWindowTitle -like "*${titlePart}*" -or $_.ProcessName -like "*${titlePart}*" } | Select-Object -First 1
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
      const script = `$proc = Get-Process | Where-Object { $_.MainWindowTitle -like "*${titlePart}*" } | Select-Object -First 1; if ($proc) { $proc.CloseMainWindow(); Write-Output "Closed: $($proc.MainWindowTitle)" } else { Write-Output "Window not found: ${titlePart}" }`;
      return this.runPS(script);
    }
    const script = `
Add-Type @"
using System.Runtime.InteropServices;
public class Win { [DllImport("user32.dll")] public static extern bool ShowWindow(System.IntPtr h, int n); }
"@
$proc = Get-Process | Where-Object { $_.MainWindowTitle -like "*${titlePart}*" } | Select-Object -First 1
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
