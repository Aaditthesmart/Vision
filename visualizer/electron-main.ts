import { app, BrowserWindow, globalShortcut, screen } from "electron";

let win: BrowserWindow | null = null;

const WIN_SIZE = 350; // circle fits in a 350x350 box

function createWindow() {
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;

  win = new BrowserWindow({
    width: WIN_SIZE,
    height: WIN_SIZE,
    x: Math.floor((sw - WIN_SIZE) / 2),
    y: Math.floor((sh - WIN_SIZE) / 2),
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    backgroundColor: "#00000000",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setAlwaysOnTop(true, "screen-saver");

  // Allow dragging — the renderer will set -webkit-app-region: drag

  if (process.env.NODE_ENV === "development") {
    win.loadURL("http://localhost:5174");
  } else {
    win.loadFile("dist/renderer/index.html");
  }

  win.on("closed", () => {
    win = null;
  });
}

let isFading = false;

function fadeWindow(w: BrowserWindow, fadeIn: boolean, duration = 600): Promise<void> {
  return new Promise((resolve) => {
    const steps = 20;
    const stepTime = duration / steps;
    let current = fadeIn ? 0 : 1;
    const delta = fadeIn ? 1 / steps : -1 / steps;

    if (fadeIn) {
      w.setOpacity(0);
      w.show();
    }

    const interval = setInterval(() => {
      current += delta;
      current = Math.max(0, Math.min(1, current));
      w.setOpacity(current);

      if ((fadeIn && current >= 1) || (!fadeIn && current <= 0)) {
        clearInterval(interval);
        if (!fadeIn) {
          w.hide();
          w.setOpacity(1);
        }
        resolve();
      }
    }, stepTime);
  });
}

app.whenReady().then(() => {
  createWindow();

  // Cmd+Shift+X to toggle visibility
  globalShortcut.register("CommandOrControl+Shift+X", async () => {
    if (!win || isFading) return;
    isFading = true;
    if (win.isVisible()) {
      await fadeWindow(win, false);
    } else {
      await fadeWindow(win, true);
    }
    isFading = false;
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});
