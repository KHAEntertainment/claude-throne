# Advanced Setup Guide

This guide covers advanced usage scenarios for Thronekeeper, including command-line usage, Python backend setup, and development workflows.

## 🖥️ Command Line Usage

For development or CI/CD scenarios, you can use the proxy directly from the command line:

### Basic Usage

```bash
# Basic usage with OpenRouter
OPENROUTER_API_KEY=your-api-key npm start

# With custom provider
ANTHROPIC_PROXY_BASE_URL=https://api.together.xyz/v1 \
TOGETHER_API_KEY=your-key \
npm start

# With two-model mode
OPENROUTER_API_KEY=your-key \
REASONING_MODEL=deepseek/deepseek-chat-v3.1:free \
COMPLETION_MODEL=qwen/qwen3-coder:free \
npm start
```

## 🔧 Python Backend (Optional)

For enhanced security and cross-platform credential management:

```bash
cd backends/python/ct_secretsd
pip install -e .
ct-secretsd
```

The extension will automatically detect and use the Python backend if available.

## Environment Variables

**Note:** The VS Code extension provides a graphical interface for most configuration. Environment variables are primarily for CLI usage, CI/CD, or advanced debugging scenarios.

- `ANTHROPIC_PROXY_BASE_URL`: Custom OpenAI-compatible base URL for the proxy (default: `https://openrouter.ai/api`)
- `CUSTOM_API_KEY` / `API_KEY`: Preferred when using a custom base URL
- `OPENROUTER_API_KEY` | `OPENAI_API_KEY` | `TOGETHER_API_KEY` | `DEEPSEEK_API_KEY` | `GLM_API_KEY` (aka `ZAI_API_KEY`): Provider keys
- `OPENROUTER_SITE_URL` and `OPENROUTER_APP_TITLE`: Optional headers recommended by OpenRouter
- `PORT`: The port the proxy server should listen on (default: 3000)
- `REASONING_MODEL`: The reasoning model to use (default: `google/gemini-2.0-pro-exp-02-05:free`)
- `COMPLETION_MODEL`: The completion model to use (default: `google/gemini-2.0-pro-exp-02-05:free`)
- `DEBUG`: Set to `1` to enable debug logging

### Key Resolution Order

- Custom URL: `CUSTOM_API_KEY` → `API_KEY` → provider key → `OPENROUTER_API_KEY` fallback
- OpenRouter URL: `OPENROUTER_API_KEY`
- OpenAI URL: `OPENAI_API_KEY`
- Together URL: `TOGETHER_API_KEY`
- Deepseek URL: `DEEPSEEK_API_KEY`
- GLM (Z.AI) URL: `GLM_API_KEY` (also accepts `ZAI_API_KEY`)

### Provider Endpoints

- OpenAI: <https://api.openai.com/v1/chat/completions>
- OpenRouter: <https://openrouter.ai/api/v1/chat/completions>
- Together AI: <https://api.together.xyz/v1/chat/completions>
- Deepseek: <https://api.deepseek.com/anthropic> (Anthropic-native, bypasses proxy)
- GLM (Z.AI): <https://api.z.ai/api/anthropic> (Anthropic-native, bypasses proxy)

## Testing

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

### Unit Tests

```bash
# Core proxy tests
npm test

# Extension tests
cd extensions/claude-throne
npm test

# Python backend tests
cd backends/python/ct_secretsd
pytest
```

## Development

### Local Development Setup

```bash
# Clone and install dependencies
git clone https://github.com/KHAEntertainment/thronekeeper.git
cd thronekeeper
npm install

# Extension development
cd extensions/claude-throne
npm install
npm run watch

# Python backend development
cd backends/python/ct_secretsd
pip install -e .
ct-secretsd --dev
```

### Current Development Focus

1. Bug fixes and stability improvements
2. Model availability validation
3. Usage analytics and cost tracking

## Claude Code Integration

For manual Claude Code configuration (not typically needed with the extension):

```bash
ANTHROPIC_BASE_URL=http://0.0.0.0:3000 claude
```

## Debugging

### Debug Endpoint

Use the `/v1/debug/echo` endpoint to inspect requests without making real API calls:

```bash
curl -s http://localhost:3000/v1/debug/echo \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "qwen/qwen3-coder:free",
    "messages": [{"role": "user", "content": "Say hi"}],
    "stream": false
  }' | jq .
```

This shows:
- Model selection logic and fallbacks
- The transformed OpenAI-compatible payload
- Headers that would be sent (with API key redacted)
- Provider and base URL configuration

---

*This document is intended for developers and advanced users. For standard usage, see the main README.md for VS Code extension installation and configuration.*
