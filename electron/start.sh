#!/bin/bash

# DEPRECATED: Electron now spawns the server automatically.
# Use `cd electron && npm run dev` instead.
# This script is kept for backwards compatibility only.

# RCY Voice Agent - Electron Launch Script (legacy)
# This script starts the server and electron app together

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}🚀 Starting RCY Voice Agent${NC}"
echo ""

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    echo -e "${RED}❌ Error: package.json not found. Please run this script from the electron directory.${NC}"
    exit 1
fi

# Check if server directory exists
if [ ! -d "../server" ]; then
    echo -e "${RED}❌ Error: Server directory not found at ../server${NC}"
    exit 1
fi

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}📦 Installing Electron dependencies...${NC}"
    npm install
fi

# Check if server node_modules exists
if [ ! -d "../server/node_modules" ]; then
    echo -e "${YELLOW}📦 Installing Server dependencies...${NC}"
    cd ../server && npm install && cd ../electron
fi

# Function to cleanup on exit
cleanup() {
    echo -e "\n${YELLOW}🛑 Shutting down...${NC}"
    kill $SERVER_PID 2>/dev/null || true
    kill $VITE_PID 2>/dev/null || true
    exit 0
}

trap cleanup INT TERM

# Start the server in the background
echo -e "${GREEN}🔧 Starting server...${NC}"
cd ../server
npm run dev > /tmp/rcy-server.log 2>&1 &
SERVER_PID=$!
cd ../electron

# Wait for server to be ready
echo -e "${YELLOW}⏳ Waiting for server to start...${NC}"
sleep 3

# Check if server is running
if ! kill -0 $SERVER_PID 2>/dev/null; then
    echo -e "${RED}❌ Server failed to start. Check logs at /tmp/rcy-server.log${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Server started (PID: $SERVER_PID)${NC}"

# Start Vite dev server in the background
echo -e "${GREEN}🔧 Starting Vite dev server...${NC}"
npm run dev:renderer > /tmp/rcy-vite.log 2>&1 &
VITE_PID=$!

# Wait for Vite to be ready
echo -e "${YELLOW}⏳ Waiting for Vite to start...${NC}"
sleep 5

# Check if Vite is running
if ! kill -0 $VITE_PID 2>/dev/null; then
    echo -e "${RED}❌ Vite failed to start. Check logs at /tmp/rcy-vite.log${NC}"
    kill $SERVER_PID 2>/dev/null || true
    exit 1
fi

echo -e "${GREEN}✅ Vite started (PID: $VITE_PID)${NC}"

# Start Electron
echo -e "${GREEN}🖥️  Launching Electron...${NC}"
echo ""
echo -e "${GREEN}═══════════════════════════════════════${NC}"
echo -e "${GREEN}  RCY Voice Agent is now running!${NC}"
echo -e "${GREEN}  Press Cmd+Shift+Space to toggle${NC}"
echo -e "${GREEN}  Press Ctrl+C to quit${NC}"
echo -e "${GREEN}═══════════════════════════════════════${NC}"
echo ""

# Run Electron in foreground
NODE_ENV=development npm run dev:main

# Cleanup when Electron exits
cleanup
