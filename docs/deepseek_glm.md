### Deepseek and GLM Coding Plan in Claude Code

### 1) Point Claude Code at your provider (Anthropic-compatible)

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

* For GLM/Z.AI: set `ANTHROPIC_BASE_URL=https://api.z.ai/api/anthropic` and your key.
* For DeepSeek: set `ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic`, key, and (optionally) `ANTHROPIC_MODEL=deepseek-chat`.
* Use `API_TIMEOUT_MS=600000` to avoid client timeouts on long runs.
* Keep `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` for lean operation.
