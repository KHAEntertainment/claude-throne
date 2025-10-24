# Thronekeeper

Thronekeeper is a sophisticated fork and evolution of anthropic-proxy that provides universal AI model routing for Claude Code and other Anthropic-compatible clients. It maintains the Anthropic-style API surface while intelligently routing to OpenAI-compatible providers, with a focus on enhanced authentication, provider ergonomics, and developer experience.

**Version 1.4.5 - Production Ready** ✅

<p align="center">
  <img src="docs/images/thronekeeper-hero.png" alt="Thronekeeper - Universal AI Model Routing" width="800">
</p>

## Features

### 🎯 Core Proxy Server
- **Smart Provider Detection**: Automatically识别 OpenRouter, OpenAI, Together AI, Groq, and custom endpoints
- **Intelligent API Key Resolution**: Context-aware key selection with provider-specific fallbacks
- **Model Selection Logic**: Support for separate reasoning and execution models
- **Debug Endpoint**: `/v1/debug/echo` for request inspection and troubleshooting
- **Comprehensive Testing**: Full test suite covering all functionality

### 🚀 VS Code Extension (v1.4.5)
- **Modern React Webview**: Feature-rich configuration panel with real-time model loading
- **Multi-Provider Support**: Configure OpenRouter, OpenAI, Together, Grok, and custom providers
- **Secure Credential Storage**: Integration with VS Code secrets API and optional Python backend
- **Two-Model Mode**: Separate reasoning and execution models for optimal performance
- **Model Management**: Search, filter, and save custom model combinations
- **Proxy Lifecycle**: Start, stop, and monitor proxy status from the extension
- **Claude Code Integration**: Automatic configuration management with workspace/global scope

### 🔧 Python Backend (ct_secretsd)
- **Secure Storage**: Cross-platform keyring integration for API keys
- **Provider Adapters**: Extensible system for different AI providers
- **Encrypted Fallback**: File-based storage with encryption when keyring unavailable
- **FastAPI Service**: RESTful API for credential management and proxy control
- **Health Monitoring**: Provider status checking and validation

## Origins & Attribution

Thronekeeper was initially forked from [anthropic-proxy](https://github.com/maxnowack/anthropic-proxy) by [Max Nowack](https://github.com/maxnowack) — a clean, focused CLI tool for proxying Anthropic API requests to OpenRouter. We're deeply grateful for Max's foundational work, which inspired this project.

**What started as a fork has evolved into a complete rebuild:**

| Aspect | Original (`anthropic-proxy`) | Thronekeeper |
|--------|------------------------------|---------------|
| **Architecture** | Single-file CLI (~350 LOC) | Full VS Code extension ecosystem |
| **Providers** | OpenRouter only | OpenRouter, OpenAI, Together, Grok, custom endpoints |
| **Security** | Environment variables only | VS Code SecretStorage + optional Python keyring backend |
| **UI** | Command-line only | Modern webview panel with real-time model loading |
| **Model Support** | Single model | Two-model mode (reasoning + execution) |
| **Testing** | None | Comprehensive test suite |
| **Configuration** | Environment variables | Workspace/global settings, saved combinations |

While the core proxy concept remains, the architecture, scope, and implementation have diverged significantly. We've detached from the fork network to establish Thronekeeper's independent identity, but we'll always acknowledge Max's work as the inspiration that got this started.

**Original License:** MIT License  
**Original Author:** Max Nowack  
**Original Repo:** https://github.com/maxnowack/anthropic-proxy

Thank you, Max! 🙏

## Installation & Usage

### 🚀 VS Code Extension (Recommended)

1. **Install the extension** from the VS Code marketplace or install the `.vsix` file:
   ```bash
   code --install-extension claude-throne-1.4.5.vsix
   ```

2. **Open the Thronekeeper panel**:
   - View → Thronekeeper (Panel)
   - Or use the Command Palette: `Thronekeeper: Open Panel`

3. **Configure your provider**:
   - Select your AI provider (OpenRouter, OpenAI, Together, Grok, or Custom)
   - Add your API key using the secure storage button
   - Choose your preferred models or use the recommended pairings

4. **Start the proxy**:
   - Click "Start Your AI Throne" in the panel
   - The extension will automatically configure Claude Code if enabled

5. **Two-Model Mode** (Advanced):
   - Enable in extension settings (`claudeThrone.twoModelMode`)
   - Set separate reasoning and execution models for optimal performance

### 🖥️ Command Line Usage

For development or CI/CD, you can still use the proxy directly:

```bash
# Basic usage with OpenRouter
OPENROUTER_API_KEY=your-api-key npx anthropic-proxy

# With custom provider
ANTHROPIC_PROXY_BASE_URL=https://api.together.xyz/v1 \
TOGETHER_API_KEY=your-key \
npx anthropic-proxy

# With two-model mode
OPENROUTER_API_KEY=your-key \
REASONING_MODEL=deepseek/deepseek-chat-v3.1:free \
COMPLETION_MODEL=qwen/qwen3-coder:free \
npx anthropic-proxy
```

### 🔧 Python Backend (Optional)

For enhanced security and cross-platform credential management:

```bash
cd backends/python/ct_secretsd
pip install -e .
ct-secretsd
```

The extension will automatically detect and use the Python backend if available.

## Environment Variables

**Note:** The VS Code extension provides a graphical interface for most configuration. Environment variables are primarily for CLI usage, CI/CD, or advanced debugging scenarios.

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

## Troubleshooting

### Common Issues (v1.4.6+)

#### Issue 1: Two-Model Mode Not Working

**Symptoms:**
- Both reasoning and completion models are set in the UI
- Only the primary model is used for all requests
- `.claude/settings.json` shows only one model being applied

**Cause:**
The webview's two-model toggle was updating local state but not notifying the backend, so the `twoModelMode` config remained false.

**Solution:**
1. In the Thronekeeper panel, toggle "Use Two Models" **off** and then back **on**
2. Stop the proxy if running
3. Start the proxy again
4. Verify in Output panel (View → Output → Thronekeeper) that you see logs like:
   ```
   [applyToClaudeCode] Two-model mode enabled
   [applyToClaudeCode] - OPUS (complex reasoning): deepseek/deepseek-r1
   [applyToClaudeCode] - SONNET (balanced tasks): qwen/qwen-2.5-coder-32b-instruct
   ```

**Verification:**
Check `.claude/settings.json` - you should see both models:
```json
{
  "env": {
    "ANTHROPIC_DEFAULT_OPUS_MODEL": "deepseek/deepseek-r1",
    "ANTHROPIC_DEFAULT_SONNET_MODEL": "qwen/qwen-2.5-coder-32b-instruct"
  }
}
```

**Fixed in:** v1.4.6 - The webview now properly notifies the backend when two-model mode is toggled.

---

#### Issue 2: `.claude/settings.json` Being Deleted

**Symptoms:**
- Pre-existing `.claude/settings.json` content (like `mcpServers`, custom config) disappears after stopping the proxy
- Only happens when the file had other settings besides Thronekeeper's env vars

**Cause:**
The revert logic was too aggressive and deleted the entire file if it became empty after removing env vars.

**Solution:**
Update to v1.4.6 or later. The fix:
- Only removes Thronekeeper's env variables during revert
- Preserves all other settings in `.claude/settings.json`
- Never deletes the file entirely if it existed before

**Recommendation:**
If you have important config in `.claude/settings.json`, **back it up** before first use as a precaution.

---

#### Issue 3: Claude Code Still Using Proxy After Stop

**Symptoms:**
- After stopping Thronekeeper proxy, Claude Code shows connection errors
- Messages like "Failed to connect to http://127.0.0.1:3000"
- Claude Code doesn't automatically switch back to Anthropic's API

**Cause:**
The revert function removed custom settings but didn't restore Anthropic's default base URL (`https://api.anthropic.com`).

**Solution:**
Update to v1.4.6 or later. The fix:
- Explicitly sets `ANTHROPIC_BASE_URL=https://api.anthropic.com` during revert
- Restores extension settings to Anthropic defaults
- Clears cached proxy URLs

**Manual Workaround (if on older version):**
Add to `.claude/settings.json`:
```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "https://api.anthropic.com"
  }
}
```
Or in VS Code settings, set the base URL to `https://api.anthropic.com` for your Claude extension.

---

#### Issue 4: Slow Response Times (20+ seconds)

**Symptoms:**
- Simple requests take 20+ seconds to complete
- Even basic "say hi" messages are slow
- Speed varies significantly between requests

**Possible Causes:**
1. **Model Selection** - Large reasoning models (1T+ parameters) are inherently slower
2. **Network Latency** - Connection issues between you, the proxy, and the provider
3. **Provider Rate Limits** - Some providers throttle free tier requests
4. **Model-Specific Performance** - Some models are slower than others at the same size

**Diagnosis Steps:**

1. **Enable Debug Logging**:
   - In extension settings: `claudeThrone.proxy.debug: true`
   - Or via environment: `DEBUG=1`
   - Check Output panel (View → Output → Thronekeeper)

2. **Check Timing Logs** (v1.4.6+):
   Look for timing information in the logs:
   ```
   [Timing] Request completed in 1234ms (HTTP 200)
   [Tokens] Input: 45, Output: 120, Total: 165
   [Timing] Total request time: 1234ms (97.3 tokens/sec)
   ```

3. **Verify Model Selection**:
   The logs will show which model is being used:
   ```
   [Model] Auto-selected deepseek/deepseek-r1 (REASONING_MODEL env var)
   ```

4. **Test Different Models**:
   Try smaller/faster models:
   - Fast: `qwen/qwen-2.5-coder-32b-instruct` (32B params)
   - Medium: `qwen/qwen-2.5-coder-72b-instruct` (72B params)
   - Slow: `deepseek/deepseek-r1` (1T+ params, reasoning-focused)

**Solutions:**

- **For Speed**: Use smaller models (7B-32B parameters)
- **For Quality**: Use larger models but expect slower responses
- **Two-Model Mode**: Combine a large reasoning model with a fast execution model:
  - Reasoning: `deepseek/deepseek-r1` (for complex tasks)
  - Execution: `qwen/qwen-2.5-coder-32b-instruct` (for fast responses)

**Network Issues:**
If timing logs show long delays before the request even starts:
- Check your internet connection
- Try a different provider (OpenRouter vs OpenAI vs Together)
- Check provider status pages for outages

---

### Model Selection Issues

The proxy respects the `model` parameter sent by Claude Code or other clients. If no model is specified in the request:
- For reasoning requests (`thinking: true`), it uses `REASONING_MODEL` environment variable
- For completion requests, it uses `COMPLETION_MODEL` environment variable
- If neither environment variable is set, it falls back to the hardcoded default model

To verify which model is being selected, enable debug logging with `DEBUG=1`:

```bash
DEBUG=1 OPENROUTER_API_KEY=... npm start
```

The debug output will show:
- The model requested by the client (`requestedModel`)
- The model that will be sent to OpenRouter (`selectedModel`)
- Whether the model was overridden by environment variables (`wasOverridden`)

### Debugging Request Issues

Use the `/v1/debug/echo` endpoint to inspect what the proxy would send to OpenRouter without making a real API call:

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
- Whether an API key is configured

Use this to compare requests with other clients (like KiloCode) and diagnose formatting issues.

### False Rate Limit Errors

"Rate limit" errors from OpenRouter can have multiple causes beyond actual rate limiting:

1. **Model Selection Issues**: Requesting a model that doesn't exist or is unavailable
2. **Malformed Requests**: Invalid tool schemas, missing required fields, or incorrect formatting
3. **Header Issues**: Missing or incorrect OpenRouter-specific headers
4. **Actual Rate Limits**: You've exceeded the provider's rate limits

**Diagnosis steps:**

1. Enable debug logging: `DEBUG=1`
2. Use the `/v1/debug/echo` endpoint to verify the request format
3. Check that the model name is correct and available
4. Test the same request with curl directly to OpenRouter to isolate proxy issues
5. Compare with requests from working clients (e.g., KiloCode)

**Common issues:**

- The proxy was ignoring the requested model and using a rate-limited default (fixed in this version)
- Tool schemas with `format: "uri"` can cause validation errors with some providers
- Missing `HTTP-Referer` or `X-Title` headers for OpenRouter free models

### OpenRouter-Specific Issues

- **Privacy settings**: Free models require your OpenRouter account to have the correct privacy settings enabled
- **Model availability**: Some free models may have restrictions or be temporarily unavailable
- **Generic errors**: OpenRouter may return generic error messages for various validation issues

Useful OpenRouter resources:
- Rate limits documentation: https://openrouter.ai/docs#rate-limits
- Models and pricing: https://openrouter.ai/models
- Privacy settings: https://openrouter.ai/settings/privacy

---

## Model Selection Best Practices

### Understanding Model Trade-offs

**Speed vs Quality:**
- **Small models (7B-32B params)**: Fast responses, good for simple tasks
- **Medium models (70B params)**: Balanced performance and quality
- **Large models (1T+ params)**: Best quality, but slower responses

**Cost Considerations:**
- Free models are great for development and experimentation
- Some free models have rate limits or reduced availability
- Check provider pricing for production use

### Recommended Model Pairings

#### For Speed-Focused Development
```
Reasoning: qwen/qwen-2.5-coder-32b-instruct
Completion: qwen/qwen-2.5-coder-32b-instruct
```
- Single model, fast responses
- Good for rapid iteration and testing
- Suitable for most coding tasks

#### For Quality-Focused Development
```
Reasoning: deepseek/deepseek-r1
Completion: deepseek/deepseek-r1
```
- Reasoning-optimized model
- Best for complex problem solving
- Slower, but higher quality output

#### Balanced Two-Model Setup (Recommended)
```
Reasoning: deepseek/deepseek-r1
Completion: qwen/qwen-2.5-coder-32b-instruct
```
- Large model for complex reasoning tasks
- Fast model for routine completions
- Best of both worlds

#### Budget-Friendly Setup
```
Reasoning: google/gemini-2.0-flash-exp:free
Completion: google/gemini-2.0-flash-exp:free
```
- Free Google models
- Good general performance
- No usage costs

### Model Selection by Task Type

**Code Generation & Refactoring:**
- Primary: `qwen/qwen-2.5-coder-32b-instruct` or `deepseek/deepseek-coder-v2.5`
- Why: Optimized for code understanding and generation

**Complex Problem Solving:**
- Primary: `deepseek/deepseek-r1` or `o1-preview` (if available)
- Why: Reasoning-focused models excel at breaking down complex problems

**Fast Autocomplete/Suggestions:**
- Primary: `qwen/qwen-2.5-coder-7b-instruct` or `codellama/CodeLlama-7b-Instruct`
- Why: Smaller models provide instant responses

**Documentation & Explanations:**
- Primary: `anthropic/claude-3.5-sonnet` (via OpenRouter)
- Why: Excellent at clear, detailed explanations

### Testing Your Configuration

1. **Start with defaults** - Use the recommended balanced setup
2. **Monitor performance** - Check Output panel for timing logs
3. **Adjust based on needs**:
   - Too slow? Try smaller models
   - Quality issues? Try larger models
   - Mixed workload? Use two-model mode

4. **Verify model selection**:
   ```bash
   # Check which model is being used
   curl http://localhost:3000/v1/debug/echo \
     -H 'Content-Type: application/json' \
     -d '{"messages":[{"role":"user","content":"test"}]}'
   ```

### Provider-Specific Recommendations

**OpenRouter:**
- Best for variety - access to 400+ models
- Free tier available for many models
- Good for experimenting with different models

**OpenAI:**
- Best for reliability and support
- GPT-4 and o1 models available
- Requires paid API key

**Together AI:**
- Good open-source model selection
- Fast inference for supported models
- Competitive pricing

**Grok (via xAI):**
- Access to Grok models
- Good performance
- Newer provider, growing ecosystem

---

### Comparing with Other Clients

If a model works in KiloCode or another client but not Thronekeeper:

1. Use `/v1/debug/echo` to see what Thronekeeper would send
2. Compare the `model` field, `messages` structure, and `tools` formatting
3. Check that headers match what the working client sends
4. Enable `DEBUG=1` to see the full request/response cycle
5. Look for differences in how tools are formatted or content is normalized

## Attribution & License

**Original Inspiration:** [anthropic-proxy](https://github.com/maxnowack/anthropic-proxy) by Max Nowack

**License:** MIT License
- Original work © 2025 Max Nowack
- Thronekeeper extensions and modifications © 2025 KHA Entertainment and contributors

See the full [Origins & Attribution](#origins--attribution) section above for details on the evolution from the original project.

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the above copyright notices and this permission notice being included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED.

## Current Status

- **Version:** 1.4.5 (Production Ready)
- **VS Code Extension:** ✅ Fully functional with modern React webview
- **Python Backend:** ✅ Complete ct_secretsd service with secure storage
- **Core Proxy:** ✅ Enhanced with smart key resolution and debugging
- **Testing:** ✅ Comprehensive test suite
- **Documentation:** ✅ User guides and API documentation

## Configuration Reference

### VS Code Extension Settings
Key settings in `settings.json` or Settings UI:

```json
{
  "claudeThrone.proxy.port": 3000,
  "claudeThrone.proxy.debug": false,
  "claudeThrone.autoApply": true,
  "claudeThrone.twoModelMode": false,
  "claudeThrone.reasoningModel": "",
  "claudeThrone.completionModel": "",
  "claudeThrone.customEndpointKind": "auto"
}
```

### Extension Commands
- `Thronekeeper: Open Panel` - Open the configuration panel
- `Thronekeeper: Store [Provider] API Key` - Store API keys securely
- `Thronekeeper: Start/Stop Proxy` - Control proxy lifecycle
- `Thronekeeper: Apply/Revert Base URL` - Configure Claude Code

## Development

### Local Development Setup
```bash
# Clone and install dependencies
git clone https://github.com/KHAEntertainment/thronekeeper.git
cd claude-throne
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

### Testing
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

Current development focuses on:
1. Bug fixes and stability improvements
2. Model availability validation
3. Usage analytics and cost tracking
4. Additional provider support

## Contributions
Contributions are welcome. Please open issues and/or Pull Requests. We’ll do a full docs pass once the MVP lands.
