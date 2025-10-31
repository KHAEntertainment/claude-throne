### Deepseek and GLM Coding Plan in Claude Code

## Overview

Deepseek and GLM are Anthropic-native providers that support the Anthropic Messages API format. Claude Throne now routes all requests through the proxy for these providers, which handles authentication and forwards requests to the provider's API endpoint.

### 1) Using Deepseek/GLM with Thronekeeper Extension (Recommended)

The easiest way to use Deepseek or GLM is through the Thronekeeper VS Code extension:

1. **Store your API key** in the extension (stored securely in your OS keychain)
2. **Select your provider** (Deepseek or GLM) from the dropdown
3. **Start the proxy** - The extension will:
   - Start the local proxy on `http://127.0.0.1:3000` (or your configured port)
   - Configure the proxy to forward to the provider's Anthropic-native endpoint
   - Apply settings to Claude Code automatically
4. **Claude Code connects to the proxy** at `http://127.0.0.1:3000/v1`
5. **The proxy handles authentication** by injecting your API key and forwarding to:
   - Deepseek: `https://api.deepseek.com/anthropic`
   - GLM: `https://api.z.ai/api/anthropic`

This approach ensures:
- Secure API key management (no keys in plaintext files)
- Automatic authentication header injection
- Easy switching between providers
- Consistent behavior with other providers (OpenRouter, OpenAI, Together)

### 2) Manual Configuration (Advanced)

If you prefer to configure Claude Code manually without the extension, you can point it directly at the provider's Anthropic-compatible endpoint:

**Option A — GLM/Z.AI**

```jsonc
// ~/.claude/settings.json
{
  "env": {
    "ANTHROPIC_AUTH_TOKEN": "<ZAI_API_KEY>",
    "ANTHROPIC_BASE_URL": "https://api.z.ai/api/anthropic",
    "API_TIMEOUT_MS": "600000",
    "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1"
  }
}
```

**Option B — DeepSeek**

```jsonc
// ~/.claude/settings.json
{
  "env": {
    "ANTHROPIC_AUTH_TOKEN": "<DEEPSEEK_API_KEY>",
    "ANTHROPIC_BASE_URL": "https://api.deepseek.com/anthropic",
    "API_TIMEOUT_MS": "600000",
    "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1",
    "ANTHROPIC_MODEL": "deepseek-chat",            // primary
    "ANTHROPIC_SMALL_FAST_MODEL": "deepseek-chat"  // small/fast slot
  }
}
```

**Note:** When using manual configuration, you must manage API keys yourself. The Thronekeeper extension approach is recommended for better security and easier management.

### 3) Primary Claude Code model mapping (defaults you can override)

```jsonc
// ~/.claude/settings.json
{
  "env": {
    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "glm-4.5-air",
    "ANTHROPIC_DEFAULT_SONNET_MODEL": "glm-4.6",
    "ANTHROPIC_DEFAULT_OPUS_MODEL":  "glm-4.6"
  }
}
```

Notes:

* Prefer env vars over hardcoding elsewhere so you can swap models without code changes.
* Use `ANTHROPIC_MODEL` when a single model name is required by a client.

---

### 4) Anthropic-format compatibility (DeepSeek) — ultra-brief

* **Headers:** `x-api-key` supported; `anthropic-version`/`anthropic-beta` ignored.
* **Core fields:** `model` (use DeepSeek name), `max_tokens`, `stop_sequences`, `stream`, `system`, `temperature (0–2)`, `top_p` supported; `top_k`, `thinking`, `container`, `metadata`, `service_tier`, `mcp_servers` ignored.
* **Tools:** `tools[].name|description|input_schema` supported; `tool_choice` = `none|auto|any|tool` supported.
* **Content types:** text/tool_use/tool_result supported; images/documents/search_result/server_tool_use/web_search/code_exec/mcp_* **not** supported.

### 6) Quick run checklist

**Using Thronekeeper Extension (Recommended):**
1. Open Thronekeeper panel in VS Code
2. Select Deepseek or GLM as your provider
3. Store your API key (stored securely in OS keychain)
4. Click "Start Proxy"
5. Extension automatically configures Claude Code to use the proxy
6. The proxy handles authentication and forwards to the provider

**Manual Configuration:**
* For GLM/Z.AI: set `ANTHROPIC_BASE_URL=https://api.z.ai/api/anthropic` and your key in `~/.claude/settings.json`
* For DeepSeek: set `ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic`, key, and (optionally) `ANTHROPIC_MODEL=deepseek-chat`
* Use `API_TIMEOUT_MS=600000` to avoid client timeouts on long runs
* Keep `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` for lean operation

**Proxy Architecture:**
* The proxy listens on `http://127.0.0.1:3000/v1` (configurable port)
* Detects Anthropic-native providers and injects the `x-api-key` header
* Forwards requests to the provider's actual endpoint
* Transparently handles authentication so Claude Code doesn't need the API key
* **Client authentication:** Claude Code may send its own `Authorization` header for session management. The proxy accepts any client auth header and ignores it for upstream requests. The proxy uses env-var-resolved API keys (`GLM_API_KEY`, `DEEPSEEK_API_KEY`, etc.) for upstream authentication, allowing Claude Code to work with any provider without knowing the provider's API key.
