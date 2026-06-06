---
title: DeepSeek2API
emoji: 🔥
colorFrom: blue
colorTo: purple
sdk: docker
app_port: 7860
pinned: true
---

# DeepSeek2API Reverse Proxy (Stateless Edition)

A high-performance, stateless reverse proxy bridging OpenAI-compatible completions (e.g. from Janitor AI, SillyTavern) to DeepSeek's internal web chat API. 

## Key Features

- **Stateless Architecture**: Automatically manages chat context by dumping it into a unified prompt text. Never lose context due to session drops!
- **Dynamic Feature Mapping**: Native support for DeepSeek's `thinking` (R1) and `search` features parsed directly from customized model strings.
- **SSE Streaming Translation**: Consumes DeepSeek JSON-diff socket events and maps `<think>` blocks and tokens smoothly back to generic OpenAI-compatible SSE events (`chat.completion.chunk`).
- **WAF Bypass Resilience**: Requires manually authenticated accounts via HTTP cookies and Bearer tokens for ultimate stability without head-heavy automated browser triggers.

## Available Models

- `deepseek-v4-pro` - Standard deepseek expert behavior.
- `deepseek-v4-pro-thinking` - DeepSeek Pro with thinking (Reasoner) enabled.
- `deepseek-v4-pro-search` - DeepSeek Pro with web search enabled.
- `deepseek-v4-flash` - Instant responses.
- `deepseek-v4-flash-thinking` - Instant responses + thinking.
- `deepseek-v4-flash-search` - Instant responses + search.
- `deepseek-v4-flash-search-thinking` - Instant responses + search and thinking!

_Note: The `expert` variant prohibits using search and thinking at the same time to match DeepSeek UI limits._

## Deployment
This proxy connects via Node.js natively:
1. `npm install`
2. `node index.js`
No persistent volume state logic is required for conversations, only user credentials remain stored.

## File Structure & Upload Manifest

When uploading to **Hugging Face Spaces** (Docker environment), exactly these files MUST be uploaded. **Do NOT upload the `node_modules` or `data` folders.** 

```text
/
├── Dockerfile                # Builds Xvfb, X11vnc, noVNC, and Chrome for HF Spaces
├── start.sh                  # HF startup script binding VNC and Node
├── index.js                  # Main Express Server and Proxy logic
├── package.json              # Node dependencies (express, playwright, etc)
├── package-lock.json         
├── sha3_wasm_bg.wasm         # WebAssembly module for fast PoW calculation
├── README.md                 
└── lib/
    ├── browser_controller.js # Playwright automated real-browser capturing script
    ├── database.js           # SQLite handlers and auto-seed logic
    ├── deepseekClient.js     # Upstream API payload construction and headers
    └── page.js               # Admin UI Dashboard + noVNC iframe layout
```

### Steps to Deploy to Hugging Face:
1. Create a new Space on Hugging Face.
2. Select **Docker** as the Space SDK (Very important! Do not select Node/Static).
3. Upload the exact files listed above, maintaining the `lib/` folder structure.
4. Hugging Face will automatically read the `Dockerfile`, install Chrome, and execute `start.sh` on port `7860`.
