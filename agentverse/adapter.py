"""
VisionOS Agentverse adapter.
Bridges ASI:One Chat + Payment Protocol to the Express /api/chat endpoint.
Runs all 5 agents (supervisor + 4 specialists) via Bureau in a single process.

Usage: python3 agentverse/adapter.py
Requires: Express server running on localhost:3001
"""

import os
import certifi
os.environ.setdefault("SSL_CERT_FILE", certifi.where())

import requests
from datetime import datetime
from uuid import uuid4

from dotenv import load_dotenv
from uagents import Agent, Bureau, Context, Protocol
from uagents_core.contrib.protocols.chat import (
    ChatMessage,
    ChatAcknowledgement,
    EndSessionContent,
    TextContent,
    chat_protocol_spec,
)
from uagents_core.contrib.protocols.payment import (
    CommitPayment,
    RejectPayment,
    CompletePayment,
    payment_protocol_spec,
)

load_dotenv(os.path.join(os.path.dirname(__file__), "..", "server", ".env"))

EXPRESS_URL = os.getenv("EXPRESS_URL", "http://localhost:3001")

# ── Agent definitions (must match register.py seeds) ─────────

AGENTS = [
    {"name": "visionos-cua-supervisor", "seed": "visionos-supervisor-seed-phrase", "port": 8001},
    {"name": "visionos-commerce",       "seed": "visionos-commerce-seed-phrase",    "port": 8002},
    {"name": "visionos-web",            "seed": "visionos-web-seed-phrase",         "port": 8003},
    {"name": "visionos-desktop",        "seed": "visionos-desktop-seed-phrase",     "port": 8004},
    {"name": "visionos-code",           "seed": "visionos-code-seed-phrase",        "port": 8005},
]


def _call_express(text: str) -> str:
    """Forward a message to the Express supervisor and return the response."""
    resp = requests.post(f"{EXPRESS_URL}/api/chat", json={"message": text}, timeout=60)
    resp.raise_for_status()
    return resp.json().get("response", "Sorry, I could not process that.")


def _attach_protocols(agent: Agent) -> None:
    """Attach Chat + Payment protocols to an agent."""
    chat = Protocol(spec=chat_protocol_spec)
    pay = Protocol(spec=payment_protocol_spec, role="seller")
    pending: dict[str, tuple[str, str]] = {}

    @chat.on_message(ChatMessage)
    async def on_chat(ctx: Context, sender: str, msg: ChatMessage):
        await ctx.send(sender, ChatAcknowledgement(
            timestamp=datetime.utcnow(), acknowledged_msg_id=msg.msg_id,
        ))
        text = "".join(i.text for i in msg.content if isinstance(i, TextContent)).strip()
        if not text:
            return
        ctx.logger.info(f"Chat: {text[:80]}")
        try:
            response_text = _call_express(text)
        except Exception as e:
            ctx.logger.error(f"Express call failed: {e}")
            response_text = "Sorry, VisionOS is temporarily unavailable. Please try again."
        await ctx.send(sender, ChatMessage(
            timestamp=datetime.utcnow(), msg_id=uuid4(),
            content=[TextContent(type="text", text=response_text), EndSessionContent(type="end-session")],
        ))

    @chat.on_message(ChatAcknowledgement)
    async def on_ack(ctx: Context, _s: str, msg: ChatAcknowledgement):
        ctx.logger.info(f"ACK {msg.acknowledged_msg_id}")

    @pay.on_message(CommitPayment)
    async def on_commit(ctx: Context, sender: str, msg: CommitPayment):
        entry = pending.pop(msg.reference, None)
        if not entry:
            return
        orig_sender, text = entry
        try:
            response_text = _call_express(text)
        except Exception as e:
            ctx.logger.error(f"Express call failed: {e}")
            response_text = "Sorry, VisionOS is temporarily unavailable. Please try again."
        await ctx.send(orig_sender, ChatMessage(
            timestamp=datetime.utcnow(), msg_id=uuid4(),
            content=[TextContent(type="text", text=response_text), EndSessionContent(type="end-session")],
        ))
        await ctx.send(sender, CompletePayment(transaction_id=msg.transaction_id))

    @pay.on_message(RejectPayment)
    async def on_reject(ctx: Context, sender: str, msg: RejectPayment):
        ctx.logger.warning(f"Payment rejected: {msg.reason}")
        for ref, (s, _) in list(pending.items()):
            if s == sender:
                pending.pop(ref, None)
                break

    agent.include(chat, publish_manifest=True)
    agent.include(pay, publish_manifest=True)


# ── Build Bureau ─────────────────────────────────────────────

bureau = Bureau()

for cfg in AGENTS:
    a = Agent(name=cfg["name"], seed=cfg["seed"], port=cfg["port"], mailbox=True)
    _attach_protocols(a)
    bureau.add(a)
    print(f"  {cfg['name']:30s} {a.address}")

if __name__ == "__main__":
    print(f"\nVisionOS agents starting (Express: {EXPRESS_URL})…\n")
    bureau.run()
