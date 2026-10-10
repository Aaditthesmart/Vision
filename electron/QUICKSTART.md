# 🚀 Quick Start Guide - RCY Voice Agent Electron

## Prerequisites

1. **Node.js 20+** installed
2. **Server running** on port 3001
3. **API Keys** configured in server/.env:
   - `ANTHROPIC_API_KEY`
   - `CARTESIA_API_KEY` 
   - `DEEPGRAM_API_KEY`

## Installation

```bash
# Install Electron dependencies
cd electron
npm install

# Install Server dependencies (if not already done)
cd ../server
npm install
cd ../electron
```

## Running the App

### Option 1: All-in-One Script (Recommended)

```bash
./start.sh
```

This will:
- Start the server automatically
- Launch Vite dev server
- Open the Electron app with hot reload

### Option 2: Manual (Run in separate terminals)

**Terminal 1 - Server:**
```bash
cd server
npm run dev
```

**Terminal 2 - Electron:**
```bash
cd electron
npm run dev
```

## Usage

### Global Hotkey
- **Mac**: `Cmd + Shift + Space`
- **Windows/Linux**: `Ctrl + Shift + Space`

Press to toggle the overlay visibility.

### System Tray
- Click icon to show/hide window
- Right-click for menu options:
  - Toggle Overlay Mode
  - Quit

### Voice Interaction
1. Click the microphone button (or wait for it to auto-activate)
2. Speak your query
3. The agent will respond with voice and text

### Window Controls
- **Drag** the top bar to move the window
- **Resize** by dragging edges
- The liquid glass effect responds to mouse movement

## Features

✨ **Liquid Glass Effect** - Beautiful Apple-style glassmorphism  
🎤 **Voice Recognition** - Real-time speech-to-text  
🔊 **Audio Playback** - Natural TTS responses  
🪟 **Overlay Mode** - Always-on-top transparent window  
⌨️ **Global Hotkey** - Access from anywhere  
📍 **System Tray** - Background operation  

## Development

### File Structure

```
electron/
├── src/
│   ├── main.ts              # Electron main process
│   ├── preload.ts           # IPC bridge
│   ├── App.tsx              # React app with LiquidGlass
│   └── components/          # UI components
├── index.html               # Entry HTML
├── vite.config.ts           # Vite configuration
└── start.sh                 # Launch script
```

### Hot Reload

Both the main process (Electron) and renderer (React) support hot reload:
- React changes: Instant refresh
- Main process changes: Auto-restart

### Building

```bash
npm run build      # Build both main and renderer
npm run package    # Create distributable app
```

## Troubleshooting

### "Server not connected"
- Ensure server is running on port 3001
- Check `.env` file has `VITE_SERVER_URL=http://localhost:3001`

### "Microphone not working"
- Grant microphone permissions in System Preferences
- Restart the app after granting permissions

### "Glass effect not visible"
- The effect requires Chromium (Electron uses it by default)
- Ensure your GPU drivers are up to date

### "Hotkey not working"
- Check for conflicts with other apps
- Modify the hotkey in `src/main.ts` (search for `HOTKEY`)

### "Window won't show"
- Press the global hotkey
- Check system tray and click the icon
- Restart the app

## Configuration

### Environment Variables

Create `electron/.env`:

```bash
VITE_SERVER_URL=http://localhost:3001
```

### Customize Hotkey

Edit `src/main.ts`:

```typescript
const HOTKEY = 'CommandOrControl+Shift+Space'; // Change this
```

### Adjust Glass Effect

Edit `src/App.tsx`:

```tsx
<LiquidGlass
  displacementScale={64}    // Distortion intensity
  blurAmount={0.08}         // Frosting level
  saturation={130}          // Color saturation
  aberrationIntensity={2}   // Chromatic aberration
  elasticity={0.3}          // Liquid feel
  cornerRadius={24}         // Border radius
>
```

## Next Steps

- [ ] Customize the tray icon (`assets/tray-icon.png`)
- [ ] Adjust window size in `src/main.ts`
- [ ] Configure default overlay position
- [ ] Add custom keyboard shortcuts
- [ ] Build and distribute the app

## Support

For issues, check:
- Server logs: `/tmp/rcy-server.log`
- Vite logs: `/tmp/rcy-vite.log`
- Electron DevTools: Automatically opens in dev mode

---

**Enjoy your beautiful liquid glass voice agent! 🎉**
