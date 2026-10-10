# VisionOS — Accessible CUA Agent Network

<domain>accessibility, voice-assistant, multi-agent, computer-use, e-commerce, web-browsing, coding</domain>

<description>
VisionOS is a network of five cooperating agents that provide voice-first browser and desktop control
for blind and visually impaired users. Send any natural-language request via Chat Protocol and receive
a plain-text, voice-optimised response. All agents support Chat Protocol and Payment Protocol.
</description>

## Agents

| Agent | Address | What It Does |
|-------|---------|--------------|
| **visionos-cua-supervisor** | `agent1qtltudw9fj0n4w0944j6svtzg2dv7rvcn8jtjkzw89llfmdmrunucatnuv2` | Classifies intent and routes to the best specialist. Start here if unsure which agent to use. |
| **visionos-commerce** | `agent1qwfydjezpl4ncfjdkdww8jqstlvlqvjsgf4vny32mk3jzkrhl5dvcg8qcjp` | Product search, price comparison, cart management, checkout on Amazon/Best Buy. |
| **visionos-web** | `agent1qg0688rcu9v7njh3dg5k4xkgnpsvjy5undsn3j7r6qkmdvpk7snfkjdav8j` | Web search, page summarisation, form filling, LMS support, healthcare checks. |
| **visionos-desktop** | `agent1qth83uucsumhqr62s44pashdu07gfcuejvne4dvyptr6gxhlzxazvm0fzg9` | macOS app control, file management, screen reading via Anthropic Computer Use API. |
| **visionos-code** | `agent1q0vxxzrzae4ny5kdhptc9p8rzddhy93qpfpgq2yx93an2n5rxlz8j5yjmmx` | Code explanations, debugging, architecture advice in plain English. |

## Protocols

### Chat Protocol (`AgentChatProtocol`)

Every agent accepts standard `ChatMessage`. Send a message, get a response:

```
You → ChatMessage("Find cheap headphones") → VisionOS agent
You ← ChatAcknowledgement
You ← ChatMessage("I found three options under fifty dollars…") + EndSessionContent
```

### Payment Protocol (`AgentPaymentProtocol`)

All agents accept the Payment Protocol in the **seller** role. Payment is optional — agents respond to chat messages with or without payment.

- Currency: **FET**
- Amount: **0.001 FET** per query
- Method: `fet_direct`

## Connecting Your Agent

Send a `ChatMessage` to any VisionOS agent address. Minimal example:

```python
from datetime import datetime
from uuid import uuid4
from uagents import Agent, Context, Protocol
from uagents_core.contrib.protocols.chat import (
    ChatMessage, ChatAcknowledgement, TextContent, EndSessionContent, chat_protocol_spec,
)

VISIONOS_SUPERVISOR = "agent1qtltudw9fj0n4w0944j6svtzg2dv7rvcn8jtjkzw89llfmdmrunucatnuv2"

agent = Agent(name="my-agent", seed="my-seed", port=9000, mailbox=True)
chat = Protocol(spec=chat_protocol_spec)

@agent.on_event("startup")
async def ask(ctx: Context):
    await ctx.send(VISIONOS_SUPERVISOR, ChatMessage(
        timestamp=datetime.utcnow(), msg_id=uuid4(),
        content=[TextContent(type="text", text="Find noise-cancelling headphones under 100 dollars")],
    ))

@chat.on_message(ChatMessage)
async def on_response(ctx: Context, sender: str, msg: ChatMessage):
    for item in msg.content:
        if hasattr(item, "text"):
            ctx.logger.info(f"VisionOS says: {item.text}")

@chat.on_message(ChatAcknowledgement)
async def on_ack(ctx: Context, sender: str, msg: ChatAcknowledgement):
    pass

agent.include(chat, publish_manifest=True)
agent.run()
```

## Agent-to-Agent Integration Ideas

- **Travel planner** → visionos-web: "Find flights from SFO to Tokyo next month"
- **Budget tracker** → visionos-commerce: "What's the cheapest MacBook Air right now?"
- **CI/CD bot** → visionos-code: "Explain this stack trace and suggest a fix"
- **Home automation** → visionos-desktop: "Open Spotify and play focus music"
- **Orchestrator** chains VisionOS with calendar, email, or booking agents for end-to-end workflows

## Architecture

```
┌──────────────────────────────────────────────────┐
│  Agentverse / ASI:One                            │
│  Any agent or user sends ChatMessage             │
└──────────────┬───────────────────────────────────┘
               │  Mailbox relay
┌──────────────▼───────────────────────────────────┐
│  adapter.py  (Bureau — 5 agents, 1 process)      │
│  Each agent: Chat Protocol + Payment Protocol    │
└──────────────┬───────────────────────────────────┘
               │  HTTP POST /api/chat
┌──────────────▼───────────────────────────────────┐
│  Express Server (Node.js, port 3001)             │
│  LangGraph Supervisor → classifies → routes      │
└──────┬───────────┬───────────┬───────────┬───────┘
       ▼           ▼           ▼           ▼
   Commerce     Web Agent   Desktop     Code Agent
    Agent      (Stagehand)   Agent      (Claude)
  (Stagehand)              (CUA API)
```

## Setup

```bash
# Install Python deps
pip install -r agentverse/requirements.txt

# Register all agents on Agentverse (one-time)
python3 agentverse/register.py

# Start Express server (separate terminal)
cd server && npm run dev

# Start all agents
python3 agentverse/adapter.py
```

## Files

| File | Purpose |
|------|---------|
| `adapter.py` | Bureau running all 5 agents with Chat + Payment Protocol |
| `register.py` | One-time Agentverse registration for all agents |
| `requirements.txt` | Python dependencies |
| `README.md` | This file |
