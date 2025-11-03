# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Thronekeeper (formerly Claude-Throne) is a sophisticated AI model routing system that provides universal access to multiple AI providers through a unified Anthropic-compatible API. It's a fork and evolution of anthropic-proxy with enhanced features including a VS Code extension, secure credential management, and multi-provider support.

## Architecture

The system consists of three main components:

1. **Proxy Server** (`index.js`) - Node.js Fastify server that translates Anthropic API requests to OpenAI-compatible format
2. **VS Code Extension** (`extensions/claude-throne/`) - TypeScript/React webview for configuration and management
3. **Python Backend** (`backends/python/ct_secretsd/`) - FastAPI service for enhanced security and credential management

## Development Commands

### Core Proxy Development
```bash
# Start the proxy server
npm start

# Run tests
npm test

# Run smoke test
bash scripts/smoke.sh
```

### VS Code Extension Development
```bash
# Development mode with auto-compilation
cd extensions/claude-throne
npm run watch

# Build extension
npm run compile

# Package VSIX file
npm run package

# Bundle proxy for extension distribution
npm run bundle:proxy
```

### Python Backend Development
```bash
# Development installation
cd backends/python/ct_secretsd
pip install -e .

# Run in development mode
ct-secretsd --dev
```

### Packaging and Distribution
```bash
# Package VSIX with version bump
bash scripts/package-vsix.sh

# Options via environment variables:
BUMP=patch|minor|major|prerelease  # Version bump type
PREID=alpha                        # Pre-release label
```

## Key Components

### Proxy Server (`index.js`)
- **Entry Point**: Main proxy server that handles Anthropic API translation
- **Key Files**:
  - `key-resolver.js` - Provider detection and API key resolution
  - `transform.js` - Content normalization and transformation
  - `xml-tool-formatter.js` - XML tool calling for models that need it
  - `xml-tool-parser.js` - XML response parsing
- **Endpoints**:
  - `POST /v1/messages` - Main chat completion endpoint
  - `GET /v1/models` - Model listing endpoint
  - `GET /healthz` - Health check endpoint
  - `POST /v1/debug/echo` - Debug endpoint for request inspection

### VS Code Extension
- **Entry Point**: `extensions/claude-throne/src/extension.ts`
- **Main Services**:
  - `ProxyManager.ts` - Proxy process lifecycle management
  - `Secrets.ts` - VS Code secrets API integration
  - `Models.ts` - Model data and provider information
  - `ClaudeSettings.ts` - Claude Code configuration management
- **Webview**: `PanelViewProvider.ts` - React webview controller
- **Configuration**: Extensive VS Code settings for proxy and model configuration

### Python Backend (`ct_secretsd`)
- **Entry Point**: `backends/python/ct_secretsd/ct_secretsd/main.py`
- **Core Components**:
  - `app.py` - FastAPI application and endpoints
  - `providers.py` - Provider adapter implementations
  - `storage.py` - Secure storage backends (keyring/file)
  - `proxy_controller.py` - Proxy lifecycle management

## Provider Support

The system supports multiple AI providers with intelligent detection:

- **OpenRouter** - 400+ models with proper headers and free model handling
- **OpenAI** - GPT-4, GPT-4o, o1 models
- **Together AI** - Open source models
- **Deepseek** - Anthropic-native API (direct connection)
- **GLM (Z.AI)** - Anthropic-native API (direct connection)
- **Custom** - Any OpenAI-compatible endpoint

## Configuration System

### Environment Variables
- `ANTHROPIC_PROXY_BASE_URL` - Base URL for the upstream provider
- `CUSTOM_API_KEY`, `OPENROUTER_API_KEY`, `OPENAI_API_KEY`, etc. - Provider-specific API keys
- `REASONING_MODEL`, `COMPLETION_MODEL`, `VALUE_MODEL` - Model selection for three-model mode
- `DEBUG` - Enable debug logging

### VS Code Settings
- `claudeThrone.proxy.port` - Proxy server port (default: 3000)
- `claudeThrone.proxy.debug` - Enable debug logging
- `claudeThrone.autoApply` - Auto-configure Claude Code
- `claudeThrone.twoModelMode` - Enable separate reasoning, completion, and value models (three-model mode)
- `claudeThrone.applyScope` - Workspace vs global configuration scope

## Testing

### Test Structure
- **Unit Tests**: Core logic functions (key resolution, provider detection)
- **Integration Tests**: Full request/response cycles
- **Test Files**: Located in `tests/` directory
- **Framework**: Vitest with supertest for HTTP testing

### Running Tests
```bash
# Run all tests
npm test

# Run specific test file
npx vitest tests/messages.nonstream.test.js
```

## Security Features

### Credential Storage
1. **VS Code Secrets API** - Primary storage within VS Code
2. **Python keyring** - Cross-platform system keychain integration
3. **Encrypted File Storage** - Fallback when keyring unavailable
4. **Environment Variables** - For CLI usage and development

### API Key Management
- Smart resolution with provider-specific fallbacks
- Context-aware key selection per provider
- Secure transmission with HTTPS-only communication

## Development Workflow

### Local Development Setup
1. **Core Proxy**: `npm start` to run proxy server
2. **Extension**: `cd extensions/claude-throne && npm run watch` for auto-compilation
3. **Backend**: `cd backends/python/ct_secretsd && ct-secretsd --dev`

### Testing Workflow
1. Run unit tests: `npm test`
2. Test proxy manually: `bash scripts/smoke.sh`
3. Verify extension functionality in VS Code

### Packaging Workflow
1. Update versions: `bash scripts/package-vsix.sh`
2. Test packaged extension locally
3. Distribute via VS Code marketplace

## Important Notes

### Provider Detection Logic
- Automatic detection from base URLs
- Custom provider fallback for unknown endpoints
- Anthropic-native endpoints bypass proxy for direct connection

### Model Selection
- Three-model mode for reasoning, completion, and value optimization
- Automatic model selection based on request context
- Fallback logic for missing model specifications

### Claude Code Integration
- Automatic configuration of `.claude/settings.json`
- Workspace vs global scope control
- Clean reversion when stopping proxy

### Error Handling
- Comprehensive error categorization
- Debug endpoint for request inspection
- Graceful degradation and fallback mechanisms

## Troubleshooting

### Common Issues
- **Port conflicts**: Change `claudeThrone.proxy.port` setting
- **API key issues**: Verify keys in VS Code secrets or environment variables
- **Model loading failures**: Check provider status and network connectivity
- **Extension not loading**: Restart VS Code and check extension logs

### Debug Mode
Enable debug mode in extension settings or via `DEBUG=1` environment variable for detailed logging and request/response inspection.

## Contributing

When making changes:
1. Follow existing code patterns and architecture
2. Add tests for new functionality
3. Update documentation in relevant files
4. Test across all three components (proxy, extension, backend)
5. Use the packaging script for version management

This architecture provides a robust, secure, and user-friendly solution for universal AI model routing with extensibility for future enhancements and provider support.

## Development Workflow (Constitution-Guided)

### Human Mode Quick Checklist (No Traycer)

Before making any changes:
1. **Read Constitution.md invariants** for the area you'll touch
2. **Identify guarded files** - if touching `webview/main.js`, `PanelViewProvider.ts`, or `AnthropicApply.ts`, extra care required
3. **Check area labels** - determine if your change affects `area:model-selection`, `area:provider`, `area:proxy`, `area:webview`, or `area:config`

After coding changes:
1. **Run tests**: `npm test` must pass
2. **Run VS Code extension tests** if extension code changed
3. **Manual smoke test** (required for guarded areas):
   - Switch providers (OpenRouter ↔ GLM ↔ custom), confirm model list differs per provider
   - Select models, Start/Stop; check settings.json shows active provider models on first start
   - Filter input: type rapidly; confirm no flicker; ensure only one listener bound
4. **Validate invariants**: verify all Constitution.md invariants still hold

Before creating PR:
1. **Add/update tests** if you changed any guarded file
2. **Update schemas** if message/config contracts changed
3. **Apply area labels** to your PR (`area:model-selection | area:provider | area:proxy | area:webview | area:config`)
4. **Document invariant impacts** in PR description
5. **Include smoke test results** (logs/screenshots)

### Common Pitfalls (From Recent Incidents)

❌ **Never use 'coding' as a storage key**
- Always use 'completion' as the canonical storage key
- 'coding' is read-only alias for display purposes only

❌ **Never render models from stale payloads**
- Always check `payload.provider === state.provider` before rendering
- Use sequence tokens to validate request/response matching
- Ignore late responses that don't match current state

❌ **Never apply without hydrating globals first**
- Before any apply operation, hydrate `reasoningModel`, `completionModel`, `valueModel` from active provider
- Use fallback hydration when legacy globals are missing
- Ensure atomic operations: both legacy globals and provider selections saved together

❌ **Never bind duplicate event listeners**
- Always remove existing listeners before adding new ones
- Check cleanup in component unmount and provider changes
- Use throttling/debouncing for filter inputs to prevent excessive re-renders

### Test Scaffold Examples

#### Provider-Aware handleModelsLoaded Test (Template: tests/webview-race-protection.test.js)
```javascript
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { JSDOM } from 'jsdom'

// This template mirrors the production logic in webview/main.js.
// Note: handleModelsLoaded(payload) takes a single parameter; it uses internal state.

describe('Provider-aware model loading', () => {
  let window, document, mockVscode, state

  beforeEach(() => {
    // jsdom + VS Code API mock (mirrors tests/webview-race-protection.test.js)
    const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>')
    window = dom.window
    document = window.document
    global.window = window
    global.document = document

    mockVscode = { postMessage: vi.fn(), getState: vi.fn(() => ({})), setState: vi.fn() }
    global.acquireVsCodeApi = () => mockVscode

    // Minimal state used by handleModelsLoaded
    state = {
      provider: 'openrouter',
      currentRequestToken: 'token-1',
      models: [],
      modelsCache: {}
    }

    // Test-scoped version using the production semantics (single-arg signature)
    function handleModelsLoaded(payload) {
      if (!payload || !Array.isArray(payload.models) || payload.models.length === 0) return
      const provider = payload.provider || state.provider
      const responseToken = payload.token

      // Token validation – ignore late responses
      if (responseToken && state.currentRequestToken && responseToken !== state.currentRequestToken) return

      // Cache by provider
      state.modelsCache[provider] = payload.models

      // Only render when current provider matches
      if (provider !== state.provider) return

      state.models = payload.models
    }

    // Expose to test scope
    global._handleModelsLoaded = handleModelsLoaded
  })

  it('accepts matching provider and token', () => {
    const payload = { provider: 'openrouter', models: [{ id: 'or/model-1' }], token: 'token-1' }
    global._handleModelsLoaded(payload)
    expect(Array.isArray(state.models)).toBe(true)
    expect(state.models).toHaveLength(1)
    expect(state.modelsCache.openrouter).toHaveLength(1)
  })

  it('ignores cross-provider responses but caches them', () => {
    const payload = { provider: 'glm', models: [{ id: 'glm/model-1' }], token: 'token-1' }
    global._handleModelsLoaded(payload)
    expect(state.models).toHaveLength(0)
    expect(state.modelsCache.glm).toHaveLength(1)
  })

  it('ignores late response by token mismatch', () => {
    const payload = { provider: 'openrouter', models: [{ id: 'or/model-2' }], token: 'token-2' }
    global._handleModelsLoaded(payload)
    expect(state.models).toHaveLength(0)
    expect(state.modelsCache.openrouter).toBeUndefined()
  })
})
```

#### Start/Stop Hydration Test (Template: tests/start-stop-hydration.test.js)
```javascript
import { describe, it, expect, vi } from 'vitest'

// Template: create this file if it doesn't exist. Focus is on hydrating legacy
// globals (reasoningModel, completionModel, valueModel) from the active provider
// before applying settings.

describe('Start/Stop hydration', () => {
  it('hydrates globals from active provider before apply', async () => {
    const mockSettings = { get: vi.fn(), update: vi.fn() }
    const mockGlobalState = {
      get: vi.fn().mockReturnValue({
        modelSelectionsByProvider: {
          openrouter: {
            reasoning: 'claude-3.5-sonnet',
            completion: 'claude-3.5-haiku',
            value: 'claude-3-opus'
          }
        }
      }),
      update: vi.fn()
    }

    // Pseudocode: call your startProxy/start flow here and assert updates
    // const result = await startProxy('openrouter', mockSettings, mockGlobalState)
    // expect(mockSettings.update).toHaveBeenCalledWith('reasoningModel', 'claude-3.5-sonnet', expect.anything())
    // expect(mockSettings.update).toHaveBeenCalledWith('completionModel', 'claude-3.5-haiku', expect.anything())
    // expect(mockSettings.update).toHaveBeenCalledWith('valueModel', 'claude-3-opus', expect.anything())
  })
})
```

Notes:
- These are templates; align file names with existing tests or add new ones.
- The handleModelsLoaded(payload) signature matches webview/main.js usage.
- Setup (JSDOM + acquireVsCodeApi) mirrors tests/webview-race-protection.test.js.
### Debug Mode and Troubleshooting

Enable comprehensive debug logging:
```bash
# Extension debug
"claudeThrone.proxy.debug": true

# Proxy server debug  
DEBUG=1 npm start

# Combined debug (extension + proxy)
DEBUG=1 code --enable-proposed-api=vscode.vscode-test-resolver
```

Common debug locations:
- Extension Developer Console (Help → Toggle Developer Tools)
- Proxy server logs (stdout when DEBUG=1)
- VS Code workspace settings (.vscode/settings.json)
- Claude Code settings (.claude/settings.json)

### PR Template for Guarded Areas

Use this template when submitting PRs that touch Constitution-guarded areas:

```markdown
## Changes
- [ ] webview/main.js
- [ ] PanelViewProvider.ts  
- [ ] AnthropicApply.ts

## Constitution Compliance
**Invariants touched:**
- [ ] Provider map structure (`{ reasoning, completion, value }`)
- [ ] Start/Stop hydration sequence  
- [ ] Model loading rules (token validation, provider matching)
- [ ] Event listener discipline
- [ ] Configuration persistence

**Schema updated:**
- [ ] yes (link: schemas/messages.ts or schemas/config.ts)
- [ ] no

**Tests added/updated:**
- [ ] unit (provider isolation, token validation, key normalization)
- [ ] integration (Start/Stop hydration, settings.json reflection)
- [ ] contract (message/config schemas)

**Area labels applied:**
`area:model-selection | area:provider | area:proxy | area:webview | area:config`

## Manual Smoke Test Results
[Attach logs or screenshots showing:]
- Provider switching behavior
- Model selection persistence
- Settings.json content after Start/Stop
- Filter input performance (no flicker)

## Test Coverage
All tests pass: `npm test`
Extension tests pass: [test command]
Manual verification: [steps and results]
```

This workflow ensures Constitution compliance while maintaining development velocity through clear guardrails and validation steps.
