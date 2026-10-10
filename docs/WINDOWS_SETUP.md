# VisionOS — Windows 11 Installation & Setup Guide

This guide provides reproducible step-by-step instructions for running VisionOS on a standard Windows 11 laptop.

---

## 1. Prerequisites

- **Operating System**: Windows 11 (64-bit)
- **Processor**: Intel Core i5 (11th Gen or higher) / AMD Ryzen 5
- **RAM**: 16 GB recommended (8 GB minimum)
- **Disk Space**: At least 5 GB free for local model weights and dependencies
- **Node.js**: v20.x or v22.x / v24.x ([Download Node.js](https://nodejs.org/))
- **Ollama for Windows**: ([Download Ollama](https://ollama.com/download/windows))
- **Browser**: Microsoft Edge or Google Chrome (already pre-installed on Windows)

---

## 2. Setting Up Ollama & Gemma 4

1. Install Ollama for Windows from [ollama.com](https://ollama.com/).
2. Open PowerShell or Windows Terminal and pull Gemma 4 / Gemma 2:
   ```powershell
   ollama pull gemma4
   ```
   *(If Gemma 4 is not yet indexed on your local Ollama repository, download the lightweight `gemma2:2b` or use an existing local model):*
   ```powershell
   ollama pull gemma2:2b
   ```
3. Verify that the Ollama daemon is running:
   ```powershell
   curl.exe http://127.0.0.1:11434/api/tags
   ```

---

## 3. Installing Dependencies

In the root VisionOS directory, install dependencies for both the backend server and the Electron application:

```powershell
# 1. Install server dependencies
cd server
npm install

# 2. Install Electron client dependencies
cd ../electron
npm install
```

---

## 4. Running the Application

### Option A: Complete Desktop Application (Recommended)

In the `electron` directory:
```powershell
npm run dev
```
This starts both the VisionOS backend orchestrator on `http://localhost:3001` and the Electron overlay desktop window.

### Option B: Standalone Server & Test Bench

If you want to run only the backend server and explore the accessible test website in your browser:
```powershell
cd server
npm start
```
Then open your browser to:
- **Test Bench**: [http://localhost:3001/test-site](http://localhost:3001/test-site)
- **Health & Status Check**: [http://localhost:3001/health](http://localhost:3001/health)

---

## 5. Running Automated Accessibility Tests

To execute the 8 end-to-end automated accessibility test scenarios:

```powershell
cd server
npm test
```

---

## 6. Keyboard Shortcuts & Accessibility Controls

- **Toggle Overlay**: `Ctrl + Shift + V`
- **Focus Goal Input**: `Tab` / `Shift + Tab`
- **Submit Goal**: `Enter`
- **Cancel Active Task**: `Esc` or click the red **Cancel** button
- **Toggle Voice Feedback**: Click the speaker icon in the top right
