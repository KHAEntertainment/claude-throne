# Thronekeeper

**Universal AI Model Routing for Claude Code** — Use any AI provider (OpenRouter, OpenAI, Together, Deepseek, GLM) with Claude Code and Anthropic-compatible clients.

> **🎉 v1.5.62 — Enable dynamic model fetching for Deepseek/GLM providers!** ✨

<p align="center">
  <img src="docs/images/thronekeeper-hero.png" alt="Thronekeeper - Universal AI Model Routing" width="800">
  </p>

## 🚀 Quick Start

### Prerequisites
- VS Code 1.85.0 or higher (or Cursor, Windsurf, etc.)
- Claude Code installed
- API key from your chosen provider(s) (OpenRouter, OpenAI, etc.)

### Installation

1) Download the Extension
- Go to Releases and download the latest `thronekeeper-{version}.vsix`

2) Install in VS Code
```bash
# Command line
code --install-extension thronekeeper-1.5.62.vsix
```

Or via UI: Extensions (Cmd/Ctrl+Shift+X) → "…" → Install from VSIX…

### First-Time Setup

1. Open the Thronekeeper panel
   - View → Panel → Thronekeeper
   - Or Command Palette: `Thronekeeper: Open Panel`
2. Configure your provider
   - Select provider (OpenRouter recommended for 400+ models)
   - Click "Store API Key" and enter your key
   - Choose models or use recommended pairings
3. Start the proxy
   - Click "Start Your AI Throne"
   - Extension auto-configures Claude Code if enabled
4. Start coding
   - Claude Code now uses your selected models

Notes:
- When you click "Stop Proxy" your Claude Code settings revert to Anthropic defaults.
- If you enter an Anthropic API Key, Thronekeeper refreshes the default Anthropic models list; the key is used only to fetch defaults, not for proxy coding tasks.
- Thronekeeper works per-project. To run multiple instances, set different ports in settings.

### Recommended: OpenRouter Setup

1. Get free API key: https://openrouter.ai/keys
2. Select "OpenRouter" in Thronekeeper
3. Store your API key
4. Browse 400+ models or use pairings, e.g.:
   - Speed: qwen/qwen-2.5-coder-32b-instruct
   - Quality: deepseek/deepseek-r1
5. Start proxy

## ✨ Key Features

- Multi-Provider Support — OpenRouter, OpenAI, Together, Deepseek, GLM, custom endpoints
- Secure Storage — API keys in VS Code keychain, never plaintext
- Three-Model Mode — Separate reasoning/completion/value models for optimal performance
- Real-Time Model Loading — Browse and search available models
- Dynamic Model Loading — Deepseek & GLM fetch models via OpenAI-compatible `/models` endpoints
- Proxy Lifecycle — Start/stop/monitor from the panel

## 📖 Documentation

- Advanced Configuration — `docs/advanced-setup.md`
- Deepseek/GLM Setup — `docs/deepseek_glm.md`

## 🔧 Configuration

Key settings in VS Code Settings or `settings.json`:

```json
{
  "claudeThrone.provider": "openrouter",
  "claudeThrone.proxy.port": 3000,
  "claudeThrone.autoApply": true,
  "claudeThrone.twoModelMode": false
}
```

Note: `claudeThrone.twoModelMode` enables “three-model” selection (reasoning/completion/value) in the UI.

## Troubleshooting

- Extension won’t install: ensure VS Code is up to date, or run `code --install-extension path/to/file.vsix --force`.
- Proxy won’t start: verify the configured port is free; check Output → Thronekeeper for logs.
- Models not loading: confirm provider API key is stored; for Deepseek/GLM the panel shows “Enter an API key to see models.” when unauthorized.

## 📦 Building from Source

```bash
git clone https://github.com/KHAEntertainment/thronekeeper.git
cd thronekeeper
npm install
npm run ext:package  # Creates .vsix in extensions/claude-throne/
```

## 🙏 Attribution

Thronekeeper evolved from [anthropic-proxy](https://github.com/maxnowack/anthropic-proxy) by Max Nowack. While the architecture has been rebuilt, we’re grateful for the inspiration.

**License:** MIT  
**Version:** 1.5.62