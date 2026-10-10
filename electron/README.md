# RCY Voice Agent - Electron Edition

A beautiful liquid glass overlay voice agent built with Electron, React, and the liquid-glass-react effect.

## Features

- **Liquid Glass Effect**: Beautiful Apple-inspired glassmorphism UI
- **Transparent Overlay**: Always-on-top window that floats over other apps
- **Voice Interaction**: Real-time speech recognition and synthesis
- **Global Hotkey**: Toggle visibility with `Cmd/Ctrl + Shift + Space`
- **System Tray**: Minimize to tray for background operation

## Architecture

This is Option A implementation:
- **Electron**: Handles the overlay window with transparent glass effect
- **React + Vite**: Fast, modern frontend with liquid-glass-react
- **Separate Server**: Socket.IO server runs as a separate process (in `../server`)
- **Web Audio API**: Full audio playback support in Electron
- **Browser Speech Recognition**: Native speech-to-text

## Setup

### 1. Install Dependencies

```bash
cd electron
npm install
```

### 2. Start the Server

In a separate terminal:

```bash
cd ../server
npm run dev
```

### 3. Run the Electron App

```bash
npm run dev
```

This will:
- Start Vite dev server on port 5173
- Launch Electron with hot reload
- Connect to the server on port 3001

## Building

```bash
npm run build
npm run package
```

This creates a standalone Electron app in `dist/`.

## Usage

### Global Hotkey
- `Cmd + Shift + Space` (Mac) or `Ctrl + Shift + Space` (Windows/Linux): Toggle overlay visibility

### System Tray
- Click tray icon to show/hide
- Right-click for menu (Enable/Disable Overlay Mode, Quit)

### Overlay Mode
When enabled:
- Window is always on top
- Hidden from taskbar
- Visible on all workspaces
- Can drag to reposition

### Voice Agent
1. Click the microphone button
2. Speak your query
3. Agent responds with voice and text

## Configuration

Create a `.env` file:

```bash
VITE_SERVER_URL=http://localhost:3001
```

## Development

### Project Structure

```
electron/
├── src/
│   ├── main.ts              # Electron main process
│   ├── preload.ts           # Preload script for IPC
│   ├── main.tsx             # React entry point
│   ├── App.tsx              # Main app with LiquidGlass
│   ├── components/          # React components
│   │   ├── VoiceAgent.tsx
│   │   ├── MicButton.tsx
│   │   ├── StatusIndicator.tsx
│   │   └── Transcript.tsx
│   ├── hooks/               # Custom React hooks
│   │   ├── useSocket.ts
│   │   ├── useAudioPlayer.ts
│   │   └── useSpeechRecognition.ts
│   └── lib/
│       └── types.ts
├── index.html
├── package.json
└── vite.config.ts
```

### Key Technologies

- **Electron**: Native desktop app framework
- **React 18**: UI framework
- **Vite**: Lightning-fast dev server and bundler
- **liquid-glass-react**: Apple's liquid glass effect
- **Socket.IO**: Real-time communication with server
- **Web Audio API**: Audio playback
- **Web Speech API**: Speech recognition
- **Tailwind CSS**: Utility-first styling

## Troubleshooting

### Glass effect not showing
- Make sure you're on a supported browser (Chromium-based)
- Safari/Firefox have partial support (no displacement)

### Audio not working
- Check microphone permissions
- Ensure Web Audio API is initialized (click mic button first)

### Server connection failed
- Verify server is running on port 3001
- Check `.env` file has correct `VITE_SERVER_URL`

### Hotkey not registering
- Check for conflicts with other apps
- Try changing the hotkey in `src/main.ts`

## License

MIT
