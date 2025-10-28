# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Claude-Throne (formerly Thronekeeper) is a sophisticated AI model routing system that provides universal access to multiple AI providers through a unified Anthropic-compatible API. It's a fork and evolution of anthropic-proxy with enhanced features including a VS Code extension, secure credential management, and multi-provider support.

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
- `REASONING_MODEL`, `COMPLETION_MODEL` - Model selection for two-model mode
- `DEBUG` - Enable debug logging

### VS Code Settings
- `claudeThrone.proxy.port` - Proxy server port (default: 3000)
- `claudeThrone.proxy.debug` - Enable debug logging
- `claudeThrone.autoApply` - Auto-configure Claude Code
- `claudeThrone.twoModelMode` - Enable separate reasoning/execution models
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
- Two-model mode for reasoning vs execution optimization
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