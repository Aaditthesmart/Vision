# 🎙️ RCY - Voice Agent Platform

A real-time voice conversational agent with multiple deployment options: Web (Next.js) and **Desktop Overlay (Electron with Liquid Glass)**.

## 🏗️ Project Structure

```
rcy/
├── client/          # Next.js web client (original)
├── server/          # Express + Socket.IO server with LLM agents
└── electron/        # 🆕 Electron desktop app with liquid glass overlay
```

## ✨ What's New: Electron Edition

The new **Electron app** (`electron/`) provides a beautiful desktop overlay experience:

- **🪟 Liquid Glass Effect**: Apple-inspired glassmorphism UI using [liquid-glass-react](https://github.com/rdev/liquid-glass-react)
- **🔝 Always-on-Top Overlay**: Floats above other applications
- **⌨️ Global Hotkey**: Toggle with `Cmd/Ctrl + Shift + Space`
- **📍 System Tray**: Minimize to background
- **🎤 Full Voice Support**: Web Audio API + Speech Recognition
- **🔄 Same Backend**: Uses the existing server via Socket.IO

## 🚀 Quick Start

### 1. Install Dependencies

```bash
# Server
cd server
npm install

# Electron App
cd ../electron
npm install
```

### 2. Configure Environment

**Server** (`server/.env`):
```bash
ANTHROPIC_API_KEY=your_key_here
CARTESIA_API_KEY=your_key_here
DEEPGRAM_API_KEY=your_key_here
```

**Electron** (`electron/.env`):
```bash
VITE_SERVER_URL=http://localhost:3001
```

### 3. Launch

**Easy Way** (starts everything):
```bash
cd electron
./start.sh
```

**Manual Way** (separate terminals):
```bash
# Terminal 1 - Server
cd server
npm run dev

# Terminal 2 - Electron
cd electron
npm run dev
```

## 🏛️ Architecture

### Option A: Separate Server (Current Implementation)

```
┌─────────────────────────────────────────┐
│  Electron Window (Transparent Overlay)  │
│  ┌────────────────────────────────────┐ │
│  │   LiquidGlass Component            │ │
│  │   ┌──────────────────────────────┐ │ │
│  │   │  React UI + Voice Agent      │ │ │
│  │   │  - Web Audio API             │ │ │
│  │   │  - Speech Recognition        │ │ │
│  │   │  - Socket.IO Client          │ │ │
│  │   └──────────────────────────────┘ │ │
│  └────────────────────────────────────┘ │
└─────────────────────────────────────────┘
              │
              │ Socket.IO (ws://localhost:3001)
              ↓
┌─────────────────────────────────────────┐
│  Express Server (Separate Process)      │
│  - Socket.IO Server                     │
│  - LLM Agents (Anthropic)               │
│  - TTS (Cartesia)                       │
│  - STT (Deepgram)                       │
│  - Browser Automation (Stagehand)       │
└─────────────────────────────────────────┘
```

**Pros:**
- ✅ Simple to develop and debug
- ✅ Server can be run separately
- ✅ Easy to update either part independently
- ✅ Stagehand's Chromium is separate from Electron

**Cons:**
- ❌ Two processes to manage
- ❌ Requires server to be running

## 📦 Deployment Options

### Web Client (Original)
```bash
cd client
npm run dev     # Development
npm run build   # Production build
```

### Electron App (New)
```bash
cd electron
npm run dev       # Development with hot reload
npm run build     # Build main + renderer
npm run package   # Create distributable (.app, .exe, etc.)
```

## 🎨 Features

### Electron App Features
- **Liquid Glass Effect**: Real-time distortion and refraction
- **Transparent Window**: True transparency with click-through
- **Draggable**: Move window by dragging title bar
- **Resizable**: Adjust window size as needed
- **Global Hotkey**: Access from any app
- **System Tray**: Minimize to tray for background operation
- **Overlay Mode**: Always-on-top, visible on all workspaces

### Core Features (Both Clients)
- **Real-time Voice**: Duplex streaming with instant barge-in
- **LLM Integration**: Anthropic Claude with agent tools
- **Text-to-Speech**: Cartesia for natural voice synthesis
- **Speech-to-Text**: Deepgram for accurate transcription
- **Browser Automation**: Stagehand for web tasks
- **Multi-Agent**: Supervisor, commerce, coding, general agents

## 🛠️ Development

### Technology Stack

**Electron App:**
- Electron 33 (Chromium 130)
- React 19
- Vite (dev server & bundler)
- TypeScript
- Tailwind CSS
- liquid-glass-react

**Server:**
- Node.js
- Express
- Socket.IO
- Anthropic SDK
- Stagehand (Browserbase)
- Cartesia (TTS)
- Deepgram (STT)

### Hot Reload

Both Electron components support hot reload:
- **Main Process** (tsx watch): Auto-restarts on changes
- **Renderer** (Vite): Instant refresh on React changes

## 📚 Documentation

- [Electron Quick Start](electron/QUICKSTART.md) - Get started with the desktop app
- [Electron README](electron/README.md) - Detailed Electron documentation
- [Server Documentation](server/README.md) - Server setup and API

## 🎯 Roadmap

- [x] Electron desktop app with liquid glass
- [x] Transparent overlay window
- [x] Global hotkey support
- [x] System tray integration
- [ ] Custom tray icon
- [ ] Keyboard shortcuts configuration
- [ ] Window position persistence
- [ ] Multiple overlay presets
- [ ] Auto-updater integration
- [ ] Windows/Linux packaging

## 🤝 Contributing

This project uses:
- **Option A architecture**: Separate server process
- **liquid-glass-react**: For the beautiful glass effect
- **Socket.IO**: For client-server communication
- **Web APIs**: Speech Recognition, Web Audio API

## 📝 License

MIT

---

**🎉 Enjoy your beautiful voice agent overlay!**

For questions or issues, check the logs:
- Server: `/tmp/rcy-server.log`
- Vite: `/tmp/rcy-vite.log`
- Electron DevTools: Opens automatically in dev mode
