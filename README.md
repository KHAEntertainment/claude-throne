# Claude Throne

Claude Throne is a fork and evolution of the excellent anthropic-proxy. It keeps the Anthropic-style API surface while routing to OpenAI-compatible providers (OpenRouter by default), and focuses on improved auth, provider ergonomics, and developer experience.

See the project goals and roadmap in docs/Claude-Throne-PRD.md.

## VS Code Extension (In Development)
- GUI to configure provider, keys, models, and port
- Secure credential storage (OS keychain) and proxy lifecycle controls
- Targets seamless Claude Code setup with proper headers and streaming semantics
For details, see docs/Claude-Throne-PRD.md.

## Roadmap (Summary)
- Week 1 — Proxy Enhancements: smart API key resolution + always-auth headers, provider-specific headers (OpenRouter), correct SSE event order, tool-call mapping, config validation, smoke tests.
- Week 2 — Extension Foundation: scaffold VS Code extension (TS + React webview), Python FastAPI backend for secure keyring + proxy orchestration, start/stop controls and status.
- Week 3 — UI Development: config form, model selector with presets, Hive theming, status and error surface.
- Week 4 — Advanced & Polish: model intelligence and availability ping, basic cost/usage, Claude Code auto-config hints, documentation and examples.

## Usage

Current state highlights
- Panel-first configuration: Provider, Custom URL, and Model selections happen in the Claude Throne panel. Port, Debug, and Auto‑apply live in extension Settings.
- xAI (Grok) supported at https://api.x.ai; keys supported via XAI_API_KEY (preferred), GROK_API_KEY, and legacy GROQ_API_KEY.
- Custom endpoint detection: Detects OpenAI-style vs Anthropic-style; offers a one-click Bypass and Apply for Anthropic endpoints to set Claude Code directly.
- Inline key status under Provider: Add/Update API Key button appears contextually.

With this command, you can start the proxy server with your OpenRouter API key on port 3000:

```bash
OPENROUTER_API_KEY=your-api-key npx anthropic-proxy
```

Environment variables:

Note: Configure provider, custom URL, and models in the panel. Environment variables are primarily for the proxy process and CI.

- `ANTHROPIC_PROXY_BASE_URL`: Custom OpenAI-compatible base URL for the proxy (default: `https://openrouter.ai/api`).
- `CUSTOM_API_KEY` / `API_KEY`: Preferred when using a custom base URL.
- `OPENROUTER_API_KEY` | `OPENAI_API_KEY` | `TOGETHER_API_KEY` | `XAI_API_KEY` (aka `GROK_API_KEY`, legacy `GROQ_API_KEY`): Provider keys. The proxy resolves the right key based on `ANTHROPIC_PROXY_BASE_URL`.
- `OPENROUTER_SITE_URL` and `OPENROUTER_APP_TITLE`: Optional headers recommended by OpenRouter (sent as `HTTP-Referer` and `X-Title`).
- `PORT`: The port the proxy server should listen on (default: 3000)
- `REASONING_MODEL`: The reasoning model to use (default: `google/gemini-2.0-pro-exp-02-05:free`)
- `COMPLETION_MODEL`: The completion model to use (default: `google/gemini-2.0-pro-exp-02-05:free`)
- `DEBUG`: Set to `1` to enable debug logging

Key resolution order:

- Custom URL: `CUSTOM_API_KEY` → `API_KEY` → provider key → `OPENROUTER_API_KEY` fallback
- OpenRouter URL: `OPENROUTER_API_KEY`
- OpenAI URL: `OPENAI_API_KEY`
- Together URL: `TOGETHER_API_KEY`
- Grok (xAI) URL: `XAI_API_KEY` (also accepts `GROK_API_KEY` or legacy `GROQ_API_KEY`)

Provider endpoints (Chat Completions)
- OpenAI: https://api.openai.com/v1/chat/completions
- OpenRouter: https://openrouter.ai/api/v1/chat/completions
- Together AI: https://api.together.xyz/v1/chat/completions
- xAI (Grok): https://api.x.ai/v1/chat/completions

If no usable key is found, the proxy returns a clear 400 error.

### Smoke Test

Start the proxy and run a non-streaming request:

```bash
# Example (OpenRouter)
OPENROUTER_API_KEY=... PORT=3000 DEBUG=1 npm start &
sleep 1
curl -s http://localhost:3000/v1/messages \
  -H 'Content-Type: application/json' \
  -d '{"messages":[{"role":"user","content":"Say hi"}],"stream":false}' | jq .
```

## Claude Code

To use the proxy server as a backend for Claude Code, you have to set the `ANTHROPIC_BASE_URL` to the URL of the proxy server:

```bash
ANTHROPIC_BASE_URL=http://0.0.0.0:3000 claude
```

## Attribution
- Upstream project: anthropic-proxy by Max Nowack (https://github.com/maxnowack/anthropic-proxy)
- This fork: maintained by KHA Entertainment (https://github.com/KHAEntertainment/claude-throne)

## License
MIT. Original work © 2025 Max Nowack. Fork changes © their respective authors.

## Contributions
Contributions are welcome. Please open issues and/or Pull Requests. We’ll do a full docs pass once the MVP lands.
