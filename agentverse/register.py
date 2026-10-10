"""
Register VisionOS agents on Agentverse for discoverability.
Run once: python3 agentverse/register.py
"""

import os
from dotenv import load_dotenv
from uagents_core.identity import Identity
from fetchai.registration import register_with_agentverse

load_dotenv(os.path.join(os.path.dirname(__file__), "..", "server", ".env"))

API_KEY = os.getenv("AGENTVERSE_KEY")
WEBHOOK = "https://localhost:3001"

AGENTS = [
    {
        "name": "visionos-cua-supervisor",
        "seed": "visionos-supervisor-seed-phrase",
        "readme": """
<domain>accessibility,voice-assistant,multi-agent,computer-use</domain>
<description>
CUA Supervisor Agent for VisionOS — a voice-first, multi-agent browser and desktop
assistant built for blind and visually impaired users.

Accepts any natural-language request via Chat Protocol, classifies intent using Claude,
and routes to the best specialist agent (Commerce, Web, Desktop, or Code).
Returns voice-optimised plain-text responses.

Supports Chat Protocol and Payment Protocol. Compatible with ASI:One.

Example queries:
- "Find the cheapest AirPods Pro online"
- "Summarise this Wikipedia page"
- "Open VS Code and run my tests"
- "Explain what a binary search tree is"
</description>
        """.strip(),
    },
    {
        "name": "visionos-commerce",
        "seed": "visionos-commerce-seed-phrase",
        "readme": """
<domain>accessibility,e-commerce,shopping,price-comparison</domain>
<description>
Commerce Agent for VisionOS — handles the full e-commerce lifecycle for blind users.

Capabilities: product search, price comparison across stores, cart management,
budget tracking, and guided checkout on Amazon, Best Buy, and more.
Voice-first, budget-aware, never auto-confirms purchases.

Powered by Claude and Stagehand browser automation.
Supports Chat Protocol and Payment Protocol.

Example queries:
- "Find me noise-cancelling headphones under 200 dollars"
- "Compare prices for iPhone 15 across stores"
- "Add the first result to my cart"
</description>
        """.strip(),
    },
    {
        "name": "visionos-web",
        "seed": "visionos-web-seed-phrase",
        "readme": """
<domain>accessibility,web-browsing,search,education,healthcare</domain>
<description>
Web Agent for VisionOS — general-purpose web browsing and information retrieval
for blind and visually impaired users.

Capabilities: web search, page navigation and summarisation, form filling,
Canvas/Coursera LMS support (assignments, due dates), and healthcare safety
checks (ingredient analysis, drug interactions).

Powered by Claude and Stagehand browser automation.
Supports Chat Protocol and Payment Protocol.

Example queries:
- "Search for today's tech news"
- "Read me the main content of this page"
- "What assignments are due this week on Canvas?"
</description>
        """.strip(),
    },
    {
        "name": "visionos-desktop",
        "seed": "visionos-desktop-seed-phrase",
        "readme": """
<domain>accessibility,desktop-automation,computer-use,macos</domain>
<description>
Desktop Agent for VisionOS — OS-level control for blind users on macOS
using the Anthropic Computer Use API.

Capabilities: mouse and keyboard control, app switching (Finder, Safari,
VS Code, Terminal, Spotify), file management, system settings, and
screen reading with conversational descriptions of on-screen content.

Supports Chat Protocol and Payment Protocol.

Example queries:
- "Open Spotify and play my liked songs"
- "Switch to Terminal and run npm test"
- "What's currently on my screen?"
</description>
        """.strip(),
    },
    {
        "name": "visionos-code",
        "seed": "visionos-code-seed-phrase",
        "readme": """
<domain>accessibility,programming,developer-tools,coding</domain>
<description>
Code Agent for VisionOS — coding assistant for blind and visually impaired
developers.

Capabilities: explains code in plain English, debugs errors, suggests fixes,
discusses architecture and design patterns. Uses location-aware descriptions
(e.g. "on line twelve of app.py").

Powered by Claude. Text-only, no browser tools needed.
Supports Chat Protocol and Payment Protocol.

Example queries:
- "Explain what this useEffect hook does"
- "Why am I getting a TypeError on line 45?"
- "What's the best pattern for error handling here?"
</description>
        """.strip(),
    },
]


def main():
    for agent in AGENTS:
        identity = Identity.from_seed(agent["seed"], 0)
        print(f"Registering {agent['name']}…")
        register_with_agentverse(
            identity=identity,
            url=WEBHOOK,
            agentverse_token=API_KEY,
            agent_title=agent["name"],
            readme=agent["readme"],
            agent_type="uagent",
        )
        print(f"  ✓ {agent['name']} registered (address: {identity.address})")

    print("\nDone! All agents registered on Agentverse.")


if __name__ == "__main__":
    main()
