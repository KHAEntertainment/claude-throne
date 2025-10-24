# Claude-Throne Architecture

## Overview

Claude-Throne is a sophisticated AI model routing system that provides universal access to multiple AI providers through a unified Anthropic-compatible API. The system consists of three main components working together seamlessly.

## System Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Claude Code   │───▶│  Claude-Throne   │───▶│ AI Providers    │
│   (or other     │    │    Proxy         │    │ (OpenRouter,    │
│   Anthropic     │    │   (index.js)     │    │ OpenAI, etc.)   │
│   clients)      │    └──────────────────┘    └─────────────────┘
└─────────────────┘             │                      ▲
         ▲                      │                      │
         │                      ▼                      │
         │              ┌──────────────────┐           │
         │              │  VS Code         │           │
         │              │  Extension       │           │
         │              │  (TypeScript +   │           │
         └──────────────│  React Webview)  │───────────┘
                        └──────────────────┘
                                 │
                                 ▼
                        ┌──────────────────┐
                        │  Python Backend  │
                        │  (ct_secretsd)   │
                        │  - Key Storage   │
                        │  - Provider Mgmt │
                        └──────────────────┘
```

## Core Components

### 1. Proxy Server (`index.js`)

**Technology:** Node.js ESM, Fastify  
**Purpose:** Translates Anthropic API requests to OpenAI-compatible format  
**Key Features:**
- Smart provider detection from base URLs
- Intelligent API key resolution with fallbacks
- Model selection logic (reasoning vs execution models)
- Streaming SSE support with proper event ordering
- Debug endpoint for request inspection
- Comprehensive error handling

**Request Flow:**
1. Receive Anthropic-style `/v1/messages` request
2. Detect provider from base URL or configuration
3. Resolve appropriate API key using provider-specific logic
4. Transform request to OpenAI-compatible format
5. Forward to provider with proper headers
6. Transform response back to Anthropic format
7. Stream using SSE if requested

### 2. VS Code Extension

**Technology:** TypeScript, React, Webview API  
**Purpose:** Provide graphical interface for configuration and management  
**Key Features:**
- Modern React webview with real-time model loading
- Multi-provider configuration (OpenRouter, OpenAI, Together, Grok, Custom)
- Secure credential storage via VS Code secrets API
- Two-model mode support (separate reasoning/execution models)
- Model search, filtering, and custom combinations
- Proxy lifecycle management
- Claude Code configuration integration

**Extension Structure:**
```
extensions/claude-throne/
├── src/
│   ├── extension.ts              # Main extension entry point
│   ├── services/
│   │   ├── Secrets.ts           # VS Code secrets integration
│   │   ├── ProxyManager.ts      # Proxy process management
│   │   └── Models.ts            # Model data and provider info
│   └── views/
│       └── PanelViewProvider.ts # Webview controller
├── webview/
│   ├── main.js                  # React application bundle
│   └── main.css                 # Hive theme styling
└── bundled/proxy/               # Packaged proxy server
```

### 3. Python Backend (`ct_secretsd`)

**Technology:** FastAPI, Uvicorn, keyring  
**Purpose:** Enhanced security and cross-platform credential management  
**Key Features:**
- Cross-platform secure key storage using system keyring
- Provider adapters for different AI services
- Encrypted file storage fallback
- RESTful API for credential management
- Proxy process control and monitoring
- Health checks and provider validation

**Backend Structure:**
```
backends/python/ct_secretsd/
├── ct_secretsd/
│   ├── app.py                   # FastAPI application
│   ├── providers.py             # Provider adapters
│   ├── storage.py               # Secure storage implementation
│   ├── proxy_controller.py      # Proxy lifecycle management
│   └── main.py                  # CLI entry point
└── pyproject.toml               # Python package configuration
```

## Configuration System

### Hierarchy of Configuration Sources
1. **VS Code Extension Settings** (Primary user interface)
2. **Environment Variables** (CLI usage, CI/CD)
3. **Python Backend** (Enhanced security when available)
4. **Default Values** (Fallback for development)

### Provider Configuration
Each provider has specific configuration:
- **OpenRouter**: `OPENROUTER_API_KEY`, optional site URL/app title headers
- **OpenAI**: `OPENAI_API_KEY`, standard OpenAI endpoints
- **Together AI**: `TOGETHER_API_KEY`, OSS model endpoints
- **Grok**: `XAI_API_KEY` (also accepts `GROK_API_KEY`)
- **Custom**: `CUSTOM_API_KEY` + `ANTHROPIC_PROXY_BASE_URL`

### Model Selection Logic
- **Single Model Mode**: Use specified model for all requests
- **Two-Model Mode**: 
  - Reasoning requests (`thinking: true`) → `REASONING_MODEL`
  - Execution requests → `COMPLETION_MODEL`
  - Fallback to default if not specified

## Security Architecture

### Credential Storage
1. **VS Code Secrets API**: Primary storage within VS Code
2. **Python keyring**: Cross-platform system keychain integration
3. **Encrypted File Storage**: Fallback when keyring unavailable
4. **Environment Variables**: For CLI usage and development

### API Key Management
- **Smart Resolution**: Context-aware key selection per provider
- **Provider Detection**: Automatic identification from endpoint URLs
- **Fallback Logic**: Multiple fallback paths for key resolution
- **Secure Transmission**: HTTPS-only communication with providers

## Integration Points

### Claude Code Integration
- **Automatic Configuration**: Updates `.claude/settings.json` with proxy URL
- **Model Settings**: Configures default models for different Claude modes
- **Scope Control**: Workspace vs global configuration scope
- **Clean Reversion**: Proper cleanup when stopping proxy

### Provider Integration
- **OpenRouter**: Full feature support with proper headers and free model handling
- **OpenAI**: Standard OpenAI API compatibility
- **Together AI**: OSS model provider integration
- **Grok**: xAI's Grok model access
- **Custom**: Any OpenAI-compatible endpoint

## Error Handling & Debugging

### Debug Endpoint (`/v1/debug/echo`)
- Request inspection without API calls
- Model selection logic visualization
- Header display with key redaction
- Configuration status checking
- Transformation debugging

### Error Categories
- **Configuration Errors**: Missing keys, invalid URLs
- **Provider Errors**: Rate limits, model availability, API errors
- **Transformation Errors**: Request/response format issues
- **Network Errors**: Connectivity, timeouts, DNS issues

## Performance Considerations

### Streaming Implementation
- Server-Sent Events (SSE) for real-time streaming
- Proper event order: `message_start` → `content_block_*` → `message_stop`
- Immediate flushing for responsive experience
- Backpressure handling for large responses

### Model Loading
- Caching of provider model lists
- Lazy loading of webview content
- Efficient filtering and search
- Background refresh of model availability

## Testing Architecture

### Test Categories
1. **Unit Tests**: Core logic functions (key resolution, provider detection)
2. **Integration Tests**: Full request/response cycles
3. **Extension Tests**: VS Code extension functionality
4. **Backend Tests**: Python service endpoints
5. **End-to-End Tests**: Complete user workflows

### Test Coverage
- All proxy endpoints with streaming/non-streaming
- Model selection logic and edge cases
- Provider-specific configurations
- Error handling and recovery
- Extension UI interactions

## Development Workflow

### Local Development
```bash
# Core proxy development
npm start
npm test

# Extension development
cd extensions/claude-throne
npm run watch  # Auto-compilation
npm run package  # Build VSIX

# Python backend development
cd backends/python/ct_secretsd
pip install -e .
ct-secretsd --dev
```

### Build Process
1. **Proxy Bundle**: Package Node.js proxy for extension distribution
2. **Extension Compile**: TypeScript compilation and React bundling
3. **VSIX Package**: Complete extension package for marketplace
4. **Python Wheel**: Backend package for distribution

## Future Enhancements

### Planned Features
- **Model Availability Checking**: Real-time model status validation
- **Usage Analytics**: Cost tracking and usage statistics
- **Model Intelligence**: Smart model recommendations based on context
- **Additional Providers**: Support for more AI providers
- **Advanced Security**: Enhanced credential protection features

### Scalability Considerations
- **Connection Pooling**: Reuse HTTP connections for better performance
- **Caching Strategy**: Enhanced caching for models and responses
- **Load Balancing**: Multiple backend instances for high availability
- **Monitoring**: Comprehensive metrics and alerting

## Deployment Architecture

### Distribution Channels
1. **VS Code Marketplace**: Primary extension distribution
2. **npm Registry**: CLI tool distribution (`anthropic-proxy`)
3. **PyPI**: Python backend distribution (`ct-secretsd`)
4. **GitHub Releases**: Direct download and archives

### Installation Options
- **Extension Only**: VS Code extension with bundled proxy
- **Full Installation**: Extension + Python backend for enhanced security
- **CLI Only**: Standalone proxy server for development/CI
- **Source Installation**: Development from source code

This architecture provides a robust, secure, and user-friendly solution for universal AI model routing, with extensibility for future enhancements and provider support.
