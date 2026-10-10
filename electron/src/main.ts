import {
  app,
  BrowserWindow,
  globalShortcut,
  Tray,
  Menu,
  screen,
  ipcMain,
  nativeImage,
  session,
} from "electron";
import path from "path";
import { spawn, ChildProcess } from "child_process";
import { existsSync, readFileSync } from "fs";
import { parse as parseDotenv } from "dotenv";

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let serverProcess: ChildProcess | null = null;
let serverManaged = false;

const HOTKEY = "CommandOrControl+Shift+V";
const SERVER_URL = "http://localhost:3001";
const SERVER_HEALTH_URL = `${SERVER_URL}/health`;

// ── Server Process Management ───────────────────────────────────────

function sendServerStatus(status: "starting" | "ready" | "crashed") {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("server-status", status);
  }
}

async function checkServerHealth(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(SERVER_HEALTH_URL, { signal: controller.signal });
    clearTimeout(timeout);
    return res.ok;
  } catch {
    return false;
  }
}

async function waitForServer(maxWaitMs = 15000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    if (await checkServerHealth()) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function startServer(): Promise<void> {
  if (await checkServerHealth()) {
    console.log("[Electron] Backend server already active at", SERVER_URL);
    sendServerStatus("ready");
    return;
  }

  sendServerStatus("starting");
  console.log("[Electron] Spawning VisionOS backend server...");

  const serverDir = path.resolve(__dirname, "../../server");
  if (!existsSync(path.join(serverDir, "package.json"))) {
    console.warn("[Electron] Server directory not found at", serverDir);
    sendServerStatus("crashed");
    return;
  }

  const envPath = path.join(serverDir, ".env");
  let serverEnv: Record<string, string> = {};
  if (existsSync(envPath)) {
    try {
      serverEnv = parseDotenv(readFileSync(envPath));
    } catch (err) {
      console.warn("[Electron] Failed to parse .env:", err);
    }
  }

  const isWindows = process.platform === "win32";
  const cmd = isWindows ? "npx.cmd" : "npx";

  serverProcess = spawn(cmd, ["tsx", "src/index.ts"], {
    cwd: serverDir,
    env: { ...process.env, ...serverEnv },
    stdio: "pipe",
    shell: true,
  });
  serverManaged = true;

  serverProcess.stdout?.on("data", (data: Buffer) => {
    process.stdout.write(`[Server] ${data.toString()}`);
  });

  serverProcess.stderr?.on("data", (data: Buffer) => {
    process.stderr.write(`[Server:err] ${data.toString()}`);
  });

  serverProcess.on("exit", (code) => {
    console.log(`[Electron] Server process exited with code ${code}`);
    if (serverManaged) {
      sendServerStatus("crashed");
      serverProcess = null;
    }
  });

  const ready = await waitForServer();
  if (ready) {
    console.log("[Electron] Backend server ready");
    sendServerStatus("ready");
  } else {
    console.warn("[Electron] Server start timed out");
    sendServerStatus("crashed");
  }
}

function killServer() {
  if (serverProcess && !serverProcess.killed) {
    console.log("[Electron] Terminating server process...");
    serverManaged = false;
    serverProcess.kill("SIGTERM");
    setTimeout(() => {
      if (serverProcess && !serverProcess.killed) {
        serverProcess.kill("SIGKILL");
      }
    }, 2000);
    serverProcess = null;
  }
}

// ── Window Management ──────────────────────────────────────────────

function createWindow() {
  const { width: screenWidth, height: screenHeight } =
    screen.getPrimaryDisplay().workAreaSize;

  const windowWidth = 840;
  const windowHeight = 580;
  const windowX = Math.floor((screenWidth - windowWidth) / 2);
  const windowY = Math.floor((screenHeight - windowHeight) / 2);

  mainWindow = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    x: windowX,
    y: windowY,
    minWidth: 700,
    minHeight: 450,
    transparent: false,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: false,
    resizable: true,
    backgroundColor: "#0f172a",
    hasShadow: true,
    roundedCorners: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Show window only after content is ready (prevents white flash)
  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
    mainWindow?.focus();
    console.log("[Electron] Window ready and visible");
  });

  mainWindow.webContents.on("did-fail-load", (event, errorCode, errorDesc, url) => {
    console.error(`[Electron] Failed to load: ${url} — ${errorDesc} (${errorCode})`);
    // Retry after a short delay (Vite may still be starting)
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        console.log("[Electron] Retrying page load...");
        if (process.env.NODE_ENV === "development" || !app.isPackaged) {
          mainWindow.loadURL("http://localhost:5173");
        }
      }
    }, 2000);
  });

  if (process.env.NODE_ENV === "development" || !app.isPackaged) {
    mainWindow.loadURL("http://localhost:5173");
  } else {
    mainWindow.loadFile(path.join(__dirname, "renderer/index.html"));
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function toggleWindow() {
  if (!mainWindow) {
    createWindow();
    return;
  }
  if (mainWindow.isVisible()) {
    mainWindow.hide();
  } else {
    mainWindow.show();
    mainWindow.focus();
    mainWindow.setAlwaysOnTop(true);
    mainWindow.moveTop();
  }
}

function createTray() {
  try {
    const iconSize = 16;
    const canvas = Buffer.alloc(iconSize * iconSize * 4);
    for (let i = 0; i < canvas.length; i += 4) {
      canvas[i] = 56; // R
      canvas[i + 1] = 189; // G
      canvas[i + 2] = 248; // B
      canvas[i + 3] = 255; // A
    }
    const trayIcon = nativeImage.createFromBuffer(canvas, {
      width: iconSize,
      height: iconSize,
    });
    tray = new Tray(trayIcon);

    const contextMenu = Menu.buildFromTemplate([
      { label: "Show / Hide VisionOS", click: toggleWindow },
      { type: "separator" },
      { label: "Quit", click: () => app.quit() },
    ]);

    tray.setToolTip("VisionOS — Gemma 4 Accessibility Interface");
    tray.setContextMenu(contextMenu);
    tray.on("click", toggleWindow);
  } catch (err) {
    console.warn("[Electron] Tray creation failed:", err);
  }
}

// ── App Lifecycle ──────────────────────────────────────────────────

app.whenReady().then(async () => {
  // Grant microphone & media permissions automatically
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(true);
  });
  session.defaultSession.setPermissionCheckHandler(() => true);

  await startServer();
  createWindow();
  createTray();

  try {
    const registered = globalShortcut.register(HOTKEY, toggleWindow);
    if (registered) {
      console.log(`[Electron] Global hotkey registered: ${HOTKEY}`);
    }
  } catch (err) {
    console.warn("[Electron] Failed to register global hotkey:", err);
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  killServer();
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  killServer();
});

// Window controls IPC
ipcMain.on("window-minimize", () => {
  mainWindow?.minimize();
});

ipcMain.on("window-close", () => {
  mainWindow?.hide();
});
