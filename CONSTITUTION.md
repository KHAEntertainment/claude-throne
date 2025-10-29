# CONSTITUTION.md

Source of truth for Claude-Throne architecture invariants and CI-enforced rules.

## Core Invariants (Must Never Break)

### 1. Provider Map Structure
```typescript
interface ProviderMap {
  reasoning: string;    // Primary reasoning model
  completion: string;  // Canonical completion model (primary storage key)
  value: string;       // Value-focused model
}
// Note: 'coding' is read-only alias for 'completion' - never use for storage
```

### 2. Start/Stop Hydration Sequence
- **Before Apply**: Always hydrate legacy globals (`reasoningModel`, `completionModel`, `valueModel`) from the active provider's map
- **Never Apply Stale Globals**: If globals don't match current provider, hydrate first
- **Atomic Operations**: Apply operation must include both legacy globals and provider-specific selections

### 3. Model Loading Rules
- **Cache Key**: Always cache models by `payload.provider`
- **Render Condition**: Only render when `payload.provider === state.provider` AND request token matches current request
- **Late Response Protection**: Late responses must not re-render or overwrite state
- **Token Validation**: Every model loading response must include sequence token for validation

### 4. Event Listener Discipline
- **No Duplicates**: Never bind duplicate event listeners
- **Cleanup Required**: Always remove listeners when component unmounts or provider changes
- **Throttle Input**: Filter input must be throttled/debounced to prevent excessive re-renders

### 5. Configuration Persistence
- **postConfig Contract**: Must include legacy keys + `modelSelectionsByProvider`
- **saveModels Contract**: Must include `providerId` field
- **Key Normalization**: Storage keys must use 'completion' (never 'coding')

## Contracts & Schemas

### Message Schema Location & Versioning

**Schema Files**:
- `extensions/claude-throne/src/schemas/messages.ts` - All webview ↔ extension message schemas
- `extensions/claude-throne/src/schemas/config.ts` - Configuration and provider map schemas

**Current Schema Version**: 1.0.0 (established 2025-10-28)

**Schema Versioning Policy**:
- **Patch** (1.0.X): Add optional fields, fix validation bugs, documentation updates
- **Minor** (1.X.0): Add new message types, deprecate (but don't remove) fields
- **Major** (X.0.0): Remove deprecated fields, change required fields, breaking changes

**Backward Compatibility Rules**:
1. Never remove fields without major version bump
2. Mark deprecated fields with `@deprecated` JSDoc and `.optional()` in schema
3. Add deprecation warnings in DEBUG mode when legacy fields are used
4. Maintain read fallbacks for deprecated keys (e.g., `completion || coding`)
5. All new required fields must have reasonable defaults

### Webview ↔ Extension Message Schema
```typescript
// Location: extensions/claude-throne/src/schemas/messages.ts
interface WebviewMessage {
  type: 'modelsLoaded' | 'providerChanged' | 'configSaved' | 'error';
  payload: {
    provider?: string;
    models?: ModelInfo[];
    token?: string;  // Sequence token for request validation
    error?: string;
    // Additional fields per message type
  };
}

interface ExtensionMessage {
  type: 'loadModels' | 'saveConfig' | 'startProxy' | 'stopProxy';
  payload: {
    provider?: string;
    modelSelections?: ProviderMap;
    token?: string;
    // Additional fields per message type
  };
}
```

### Configuration Payload Schema
```typescript
// Location: extensions/claude-throne/src/schemas/config.ts
interface ConfigurationPayload {
  provider: string;
  modelSelectionsByProvider: Record<string, ProviderMap>;
  reasoningModel: string;    // Legacy global
  completionModel: string;  // Legacy global
  valueModel: string;       // Legacy global
}
```

**Fail Closed Policy**: Any message or payload that doesn't conform to schemas must be rejected and logged as error. Tests must fail for invalid contracts.

**Validation Modes**:
- **Strict Mode**: Throws ZodError on validation failure (use in tests)
- **Safe Mode**: Returns null and logs error on validation failure (use in production with DEBUG flag)
- **Feature Flag**: `featureFlags.enableSchemaValidation` can disable validation if critical issues arise

## Test Guarantees (CI Must Pass)

### Unit Tests (jsdom)
- **Provider Switch Isolation**: Switching providers clears previous state and loads correct models
- **Tokened Model Loading**: `handleModelsLoaded` validates sequence tokens and ignores late responses
- **Key Normalization**: Storage operations always use 'completion' key, never 'coding'
- **Fallback Hydration**: Triggers `saveModels` exactly once when legacy globals are missing
- **Single Listener Checks**: Verify no duplicate event listeners are bound

### Integration Tests (VS Code Extension)
- **Start/Stop Hydration**: First start after provider switch uses active provider's models
- **Settings.json Reflection**: Applied configuration reflects active provider in settings.json
- **Provider Restoration**: Switching providers and back restores correct model selections
- **Configuration Persistence**: Model selections persist correctly across extension restarts

### Contract Tests
- **Message Validation**: All webview ↔ extension messages conform to schemas
- **Payload Validation**: Configuration payloads include all required fields
- **Provider Map Keys**: Provider maps always contain canonical keys (reasoning, completion, value)

## CI Rules and Labels

### Area Labels (Required for PRs)
- `area:model-selection` - Changes to model selection UI or logic
- `area:provider` - Changes to provider detection or switching
- `area:proxy` - Changes to proxy server configuration or startup
- `area:webview` - Changes to React webview components
- `area:config` - Changes to configuration persistence or loading

### CI Block Rules
- **Guarded Areas**: PRs touching `webview/main.js`, `PanelViewProvider.ts`, or `AnthropicApply.ts` must run matching tests
- **Test Coverage**: New functionality must include corresponding unit/integration tests
- **Schema Validation**: All message/config contracts must pass schema validation
- **Invariant Preservation**: No change may break documented invariants

## Change Policy

### "If You Touch These Files, You Must..."

**Guarded Files:**
- `extensions/claude-throne/webview/main.js`
- `extensions/claude-throne/src/PanelViewProvider.ts`
- `extensions/claude-throne/src/AnthropicApply.ts`

**Required Actions:**
1. Read and understand relevant invariants in Constitution.md
2. Add or update tests for changed functionality
3. Update schemas if contracts change
4. Apply appropriate area labels to PR
5. Manual smoke test of provider switching and model selection
6. Verify no duplicate event listeners
7. Validate configuration persistence

### Schema Updates
- Any change to message/config payloads requires schema version bump
- Update corresponding Zod/TypeScript interfaces
- Add contract tests for new fields
- Document backward compatibility if applicable

## Rollback & Debug Procedures

### Enable Debug Mode
```bash
# Via VS Code Settings
"claudeThrone.proxy.debug": true

# Via Environment Variable
DEBUG=1 npm start

# Via Extension Launch Configuration
Add "--debug" to extension development launch args
```

### Revert to Last Known Good
```bash
# Reset extension settings
code --reset-extension-settings claude-throne

# Clear cached configuration
rm -rf ~/.vscode/extensions/claude-throne-*/user-data/

# Restart VS Code to ensure clean state
```

### Debug Information Collection
- Extension Developer Console logs (Help → Toggle Developer Tools)
- Proxy server logs (when DEBUG=1)
- VS Code workspace settings (.vscode/settings.json)
- Claude Code settings (.claude/settings.json)

## Memory and Persistence

### Key Decision Recording
All architectural decisions, schema changes, or invariant modifications must:
1. Be recorded in core memory with reference to PR/Bead ID
2. Include rationale and impact assessment
3. Link to affected test files and documentation
4. Note any backward compatibility considerations

### Change Tracking
- Maintain CHANGELOG.md with architectural decisions
- Tag invariant changes with `[INVARIANT]` prefix
- Cross-reference schema versions with release notes
- Document any migration requirements

---

**Enforcement**: These rules are enforced by CI checks. Any violation will block merge until resolved. When in doubt, ask for clarification before making changes to guarded areas.