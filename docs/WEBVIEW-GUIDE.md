# Claude-Throne Webview User Guide

## Overview

The Claude-Throne VS Code extension provides a modern React webview panel for configuring and managing your AI model routing. This guide covers all features and functionality of the webview interface.

**Schema Reference** (Comment 15): For message contracts and configuration schemas, see:
- `extensions/claude-throne/src/schemas/messages.ts` - Message schemas
- `extensions/claude-throne/src/schemas/config.ts` - Configuration schemas
- `CONSTITUTION.md` - Invariants and contracts

## Accessing the Webview

### Methods to Open the Panel
1. **Menu Bar**: View → Claude Throne (Panel)
2. **Command Palette**: `Ctrl+Shift+P` → "Claude Throne: Open Panel"
3. **Activity Bar**: Click the Claude Throne icon (if pinned)
4. **Status Bar**: Click the Claude Throne status indicator (when active)

## Main Interface Components

### 1. Provider Selection
**Location**: Top of the panel  
**Purpose**: Choose your AI provider and configure connection details

**Available Providers**:
- 🌐 **OpenRouter** (400+ models) - Get API key: openrouter.ai/keys
- 🤖 **OpenAI** (GPT-4, o1) - Get API key: platform.openai.com/api-keys
- ⚡ **Together AI** (Fast OSS) - Get API key: api.together.xyz/settings/api-keys
- 🚀 **Grok** (Ultra-fast) - Get API key: console.groq.com/keys
- 🔧 **Custom Provider** - Any OpenAI-compatible endpoint

**Custom Provider Configuration**:
When "Custom Provider" is selected, an additional field appears:
- **Custom API Base URL**: Enter the full endpoint URL (e.g., `https://api.example.com/v1`)

### 2. API Key Management
**Location**: Below provider selection  
**Purpose**: Securely store and manage API keys

**Features**:
- **Secure Storage**: Uses VS Code's built-in secrets API
- **Provider-Specific**: Each provider has its own secure storage
- **Show/Hide Toggle**: Click the eye icon to reveal/hide the key
- **Auto-Detection**: Extension detects if a key is already stored

**API Key Buttons**:
- **Add/Update API Key**: Store or replace the current key
- **Key Status Indicator**: Shows if a key is configured (✅) or missing (❌)

### 3. Model Configuration

#### Two-Model Mode
**Location**: Toggle switch in model section  
**Purpose**: Use different models for reasoning vs execution

**When Disabled**: Single model handles all requests  
**When Enabled**: Separate models for:
- **Reasoning Model**: Complex analysis, thinking tasks
- **Execution Model**: Fast completion, code generation

#### Model Selection
**Primary Model Dropdown**: Main model for most operations  
**Secondary Model Dropdown**: Appears when two-model mode is enabled

**Features**:
- **Real-time Loading**: Fetches latest models from provider
- **Search Functionality**: Type to filter models
- **Model Information**: Shows context window and capabilities
- **Recent Selections**: Quick access to recently used models

### 4. Model List and Search
**Location**: Below configuration forms  
**Purpose**: Browse and select from available models

**Features**:
- **Live Search**: Type to filter models in real-time
- **Provider Filtering**: Shows only models for selected provider
- **Model Details**: Context window, pricing, capabilities
- **Quick Select**: Click any model to set as primary or secondary

**Model Card Information**:
- Model name and provider
- Context window size
- Cost tier (Free, Budget, Premium)
- Special capabilities (coding, reasoning, etc.)

### 5. Proxy Controls
**Location**: Bottom of the panel  
**Purpose**: Start, stop, and monitor the proxy server

**Control Buttons**:
- **Start Your AI Throne**: Launch the proxy with current configuration
- **Stop Proxy**: Gracefully stop the running proxy
- **Status Indicator**: Shows current proxy state

**Status Information**:
- **Proxy Status**: Running/Stopped with color coding
- **Port Information**: Shows configured port (default: 3000)
- **Provider Connection**: Displays active provider and model
- **Error Messages**: Clear error reporting for troubleshooting

## Advanced Features

### Custom Model Combinations
**Purpose**: Save and reuse your favorite model pairings

**How to Use**:
1. Configure your preferred reasoning and execution models
2. Click "Save Combination" (appears when two models are selected)
3. Enter a name for your combination
4. Access saved combinations from the dropdown

### Popular Model Pairings
**Purpose**: Quick access to recommended model combinations

**Featured Pairings**:
- **The Free Genius Combo**: DeepSeek reasoning + Qwen coding
- **Gemini Lightning**: 2M token context with fast execution
- **Premium Powerhouse**: OpenAI o1 reasoning + GPT-4o execution

### Claude Code Integration
**Automatic Configuration**: When enabled, the extension automatically updates your Claude Code configuration

**Settings Applied**:
- `ANTHROPIC_BASE_URL`: Points to your local proxy
- `ANTHROPIC_MODEL`: Sets your preferred model
- Scope: Workspace or global (configurable in extension settings)

## Troubleshooting

### Common Issues and Solutions

#### 1. "No API Key Found" Error
**Cause**: No API key stored for selected provider  
**Solution**: Click "Add/Update API Key" and enter your key

#### 2. "Failed to Load Models" Error
**Cause**: Network issue or invalid API key  
**Solution**: 
- Check your internet connection
- Verify API key is valid
- Try refreshing the model list

#### 3. "Proxy Failed to Start" Error
**Cause**: Port already in use or configuration issue  
**Solution**:
- Check if another process is using port 3000
- Try a different port in extension settings
- Review configuration for errors

#### 4. Models Not Appearing
**Cause**: Provider API changes or rate limiting  
**Solution**:
- Wait a few minutes and try again
- Check if provider is experiencing issues
- Try manually entering model name

### Debug Mode
**Enable in Extension Settings**: Set `claudeThrone.proxy.debug` to `true`

**Debug Information Available**:
- Detailed request/response logs
- Model selection logic
- Provider communication details
- Error stack traces

## Keyboard Shortcuts

### Webview Shortcuts
- **Ctrl/Cmd + F**: Focus search box
- **Escape**: Close dropdowns/modals
- **Enter**: Confirm selections
- **Tab**: Navigate between form fields

### Extension Commands
- **Ctrl/Cmd + Shift + P**: Open command palette
- Type "Claude Throne" to see all available commands

## Settings Reference

### Extension Settings
Access via: File → Preferences → Settings → Extensions → Claude Throne

**Core Settings**:
- `claudeThrone.proxy.port`: Proxy server port (default: 3000)
- `claudeThrone.proxy.debug`: Enable debug logging
- `claudeThrone.autoApply`: Auto-configure Claude Code
- `claudeThrone.twoModelMode`: Enable two-model mode by default

**Advanced Settings**:
- `claudeThrone.applyScope`: Workspace vs global configuration
- `claudeThrone.customEndpointKind`: Endpoint type detection
- `claudeThrone.reasoningModel`: Default reasoning model
- `claudeThrone.completionModel`: Default completion model

## Best Practices

### 1. API Key Security
- Use the extension's secure storage instead of environment variables
- Never share API keys or commit them to version control
- Regularly rotate API keys for security

### 2. Model Selection
- Start with free models to test configurations
- Use two-model mode for optimal performance
- Consider context window size for your use case
- Check model availability and pricing

### 3. Performance Optimization
- Use models appropriate for your task complexity
- Enable debug mode only when troubleshooting
- Restart proxy periodically for long-running sessions

### 4. Configuration Management
- Save frequently used model combinations
- Use workspace-specific settings for different projects
- Document custom provider configurations for team sharing

## Getting Help

### Resources
- **Extension Documentation**: Complete API reference
- **Troubleshooting Guide**: Common issues and solutions
- **GitHub Issues**: Report bugs and request features
- **Community Forum**: User discussions and tips

### Support Channels
- **GitHub Issues**: https://github.com/KHAEntertainment/claude-throne/issues
- **Discord Community**: Join for real-time help
- **Documentation**: Check docs folder for detailed guides

This webview provides a comprehensive interface for managing your AI model routing needs, with features designed for both beginners and advanced users. The intuitive interface makes it easy to configure providers, manage credentials, and optimize your AI workflow.

---

## Technical Reference (Comment 15)

### Message Contracts and Race Protection

The webview communicates with the extension via strongly-typed message schemas. All messages are validated against Zod schemas located in `extensions/claude-throne/src/schemas/messages.ts`.

#### Token-Based Race Protection (Comment 8)

**Problem**: When users rapidly switch providers or refresh model lists, multiple async requests can complete out-of-order, causing stale data to render.

**Solution**: Sequence token validation ensures only the most recent response is rendered.

**Implementation**:
```javascript
// Webview (main.js)
state.requestTokenCounter++;  // Increment before each request
const requestToken = `token-${state.requestTokenCounter}`;
state.currentRequestToken = requestToken;

vscode.postMessage({
  type: 'requestModels',
  provider: state.provider,
  token: requestToken  // Include in request
});

// Response handler validates token
function handleModelsLoaded(payload) {
  const responseToken = payload.token;
  
  // Ignore late responses with mismatched tokens
  if (responseToken !== state.currentRequestToken) {
    console.log('[IGNORED] Late response with old token');
    return;
  }
  
  // Only render if provider also matches
  if (payload.provider !== state.provider) {
    return;
  }
  
  // Safe to render - this is the current request
  state.models = payload.models;
  renderModelList();
}
```

**Test Coverage**:
- `tests/webview-race-protection.test.js` - Validates token mismatch rejection
- Integration tests ensure provider + token matching prevents stale renders

#### Provider Key Normalization (Comment 5)

**Migration Note**: The 'coding' key is **deprecated** as of v1.4.5. All storage now uses the canonical 'completion' key.

**Backward Compatibility**:
- **Read**: `completion || coding` - falls back to legacy key if needed
- **Write**: Only writes 'completion' - migration deletes 'coding' on save
- **Deprecation Warning**: Logged in DEBUG mode when legacy key is used

**Provider Map Structure**:
```typescript
interface ProviderMap {
  reasoning: string;   // Primary reasoning model
  completion: string;  // Canonical coding/completion model (NEW)
  value: string;       // Value-focused model
  
  // DEPRECATED - read-only fallback
  coding?: string;     // Only for backward compat, never written
}
```

**Migration Path**:
1. On first save after upgrade, extension automatically migrates 'coding' → 'completion'
2. Legacy 'coding' keys are deleted from configuration
3. Read operations still support fallback for configs not yet migrated
4. v2.0 will remove all 'coding' support completely

### Per-Provider Caching (Comment 7)

**Cache Behavior**:
- Models are cached by provider key: `state.modelsCache[provider]`
- Provider switch only clears the *old* provider's cache, not the entire cache
- Cache TTL: 5 minutes (reused if fresh)

**Benefits**:
- Faster provider switching (no reload if cached)
- Reduces API calls when toggling between providers
- Preserves model lists for all recently-used providers

**Example**:
```javascript
// User on OpenRouter, models cached
state.modelsCache = {
  openrouter: [/* 400 models */]
};

// Switch to GLM
delete state.modelsCache['openrouter'];  // Clear old provider only
state.provider = 'glm';
loadModels();  // Fetches GLM models

state.modelsCache = {
  openrouter: [/* preserved */],
  glm: [/* newly loaded */]
};
```

### Save Operation Lock (Comment 12)

**Problem**: Config updates can trigger unnecessary model reloads during save round-trip, causing UI flicker.

**Solution**: Provider-tracked lock prevents reloads for the provider being saved.

**Implementation**:
```javascript
// Before save
state.inSaveOperation = true;
state.inSaveProvider = state.provider;

vscode.postMessage({
  type: 'saveModels',
  providerId: state.provider,
  // ...models
});

// On save confirmation
function handleModelsSaved(payload) {
  // Only clear lock if this is the provider we saved
  if (payload.providerId === state.inSaveProvider) {
    state.inSaveOperation = false;
    state.inSaveProvider = null;
  }
}

// Model reload guard
if (state.inSaveOperation) {
  console.log('Skipping reload - save in progress');
  return;
}
```

**Why Provider Tracking Matters**:
- Quick provider switches during save would clear lock prematurely
- Lock must persist until the *correct* provider's save confirms
- Prevents race where provider A's save clears lock for provider B's ongoing save

### Event Listener Discipline

**Invariant**: No duplicate event listeners allowed.

**Rules**:
1. **Cleanup on Provider Change**: Remove old listeners before switching providers
2. **Debounce Filter Input**: 300ms debounce prevents excessive re-renders
3. **Single Listener Binding**: Check existing listeners before `addEventListener`

**Anti-Pattern**:
```javascript
// WRONG - binds duplicate listeners on each provider change
providerSelect.addEventListener('change', onProviderChange);
```

**Correct Pattern**:
```javascript
// RIGHT - bind once during setupEventListeners()
function setupEventListeners() {
  providerSelect?.addEventListener('change', onProviderChange);
}

// Called only once during init
document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  // ...
});
```

**Test Coverage**:
- Unit tests spy on `addEventListener` call count
- Smoke tests verify no console errors about duplicate listeners

---

*For complete technical specifications, see `CONSTITUTION.md` and schema files in `extensions/claude-throne/src/schemas/`.*
