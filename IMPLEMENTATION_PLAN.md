# Implementation Plan: Guardrails & Anti-Regression for Provider/Model Selection

## Overview

This plan implements comprehensive guardrails to prevent regressions in Claude Throne's provider/model selection, proxy start/stop, and model list UI functionality. Recent issues have demonstrated critical gaps in state management, message contracts, event handling, and test coverage that allowed cross-provider contamination, race conditions, and configuration mismatches.

The implementation is structured into 6 phases that build upon each other, each independently testable and providing incremental value. The approach prioritizes fail-safe contracts and validation early, then progressively hardens critical flows with defensive code, proper sequencing, and comprehensive test coverage.

**Total Estimated Effort**: 8-12 days

**Risk Assessment**: Medium - Touching critical user-facing code with existing bugs, but phased approach allows for safe rollback at each milestone.

---

## Phases

### Phase 1: Message Schema & Contract Foundation

**Scope**:
- Create TypeScript schema files for all webview ↔ extension messages
- Implement Zod-based runtime validation for message contracts
- Add fail-closed validation that rejects malformed messages
- Create shared type definitions used by both webview and extension
- Update CONSTITUTION.md with schema versioning policy

**Out of Scope**:
- Migration of existing code to use schemas (that's Phase 2+)
- Configuration payload schemas (covered in Phase 4)
- CI enforcement (covered in Phase 6)

**Dependencies**:
- None (foundation phase)

**Acceptance Criteria**:
- [ ] Schema files exist: `extensions/claude-throne/src/schemas/messages.ts` and `config.ts`
- [ ] All message types documented with Zod schemas
- [ ] Validator functions created that throw on invalid messages
- [ ] Contract tests verify schema validation rejects invalid payloads
- [ ] Documentation in CONSTITUTION.md for schema versioning

**Testing Strategy**:
```typescript
// Contract test example
describe('Message Schema Validation', () => {
  it('rejects modelsLoaded without provider field', () => {
    expect(() => validateModelsLoadedMessage({ 
      models: [], 
      // missing provider
    })).toThrow()
  })
  
  it('rejects modelsLoaded with wrong token type', () => {
    expect(() => validateModelsLoadedMessage({
      provider: 'openrouter',
      models: [],
      token: 123 // should be string
    })).toThrow()
  })
})
```

**Implementation Notes**:
- Use Zod for schemas (already in VS Code ecosystem)
- Add sequence token field to all model-loading messages
- Include backward compatibility checks for optional fields
- Log rejected messages with detailed error info when DEBUG=true

**Estimated Effort**: 1-2 days

**Risk Level**: Low - Read-only schema creation with no behavioral changes yet

---

### Phase 2: Provider-Aware Model Loading & Race Protection

**Scope**:
- Add request token generation and validation to model loading
- Implement provider validation in `handleModelsLoaded` (webview)
- Add late response protection (ignore if `payload.provider !== state.provider`)
- Cache models by `payload.provider` key
- Apply message schema validation to model loading flows

**Out of Scope**:
- Other message types (focus only on model loading)
- Provider switching logic changes
- Configuration persistence

**Dependencies**:
- Phase 1: Message schemas must exist

**Acceptance Criteria**:
- [ ] `requestModels` message includes incrementing sequence token
- [ ] `handleModelsLoaded` validates `payload.token` matches expected token
- [ ] Late responses (wrong provider or old token) are ignored and logged
- [ ] `state.modelsCache` keyed by provider, not just single cache
- [ ] Unit tests prove provider isolation and token validation

**Testing Strategy**:
```javascript
// Unit test with jsdom
test('handleModelsLoaded ignores late response from different provider', () => {
  const state = { provider: 'glm', requestToken: 'token-2' }
  const setState = vi.fn()
  
  // Simulate late OpenRouter response
  const latePayload = {
    provider: 'openrouter',
    models: [...],
    token: 'token-1'
  }
  
  handleModelsLoaded(latePayload, setState, state)
  
  // Should not update state
  expect(setState).not.toHaveBeenCalled()
})
```

**Implementation Notes**:
- Use simple incrementing counter for tokens (no need for UUIDs)
- Store current request token in `state.requestToken`
- Add explicit log messages when ignoring late responses (DEBUG mode)
- Clear stale cache entries when switching providers

**Estimated Effort**: 2-3 days

**Risk Level**: Medium - Changes critical rendering logic, but testable and incremental

---

### Phase 3: Key Normalization & Storage Standardization

**Scope**:
- Standardize on `completion` as canonical key for coding model storage
- Add read fallback: `completion || coding` for backward compatibility
- Update all write operations to use only `completion` key
- Add deprecation warnings when `coding` key is encountered (DEBUG mode)
- Update `saveModels` and `handleSaveModels` to enforce `completion` key

**Out of Scope**:
- Removal of `coding` key completely (keep read fallback indefinitely)
- Migration of existing user configs (happens naturally on next save)

**Dependencies**:
- Phase 1: Config schema must define canonical keys

**Acceptance Criteria**:
- [ ] All storage operations write to `modelSelectionsByProvider[provider].completion`
- [ ] Read operations check `completion || coding` for backward compatibility
- [ ] Webview state uses `codingModel` variable but saves to `completion` key
- [ ] Unit tests verify `coding` → `completion` normalization
- [ ] Deprecation log emitted when reading from legacy `coding` key

**Testing Strategy**:
```javascript
test('normalizes legacy coding key to completion on read', () => {
  const config = {
    modelSelectionsByProvider: {
      openrouter: {
        reasoning: 'model-a',
        coding: 'model-b', // legacy key
        value: 'model-c'
      }
    }
  }
  
  const normalized = normalizeProviderMap(config.modelSelectionsByProvider.openrouter)
  
  expect(normalized.completion).toBe('model-b')
  expect(normalized.coding).toBeUndefined() // not in output
})
```

**Implementation Notes**:
- Update CONSTITUTION.md to document `coding` as deprecated alias
- Keep `coding` field in TypeScript types with JSDoc `@deprecated` tag
- Add comment blocks in code explaining normalization (Comments 1, 2, 3 already exist)

**Estimated Effort**: 1-2 days

**Risk Level**: Low - Backward compatible, user configs auto-migrate on save

---

### Phase 4: Deterministic Start/Stop with Pre-Apply Hydration

**Scope**:
- Add pre-apply hydration in `handleStartProxy` before proxy starts
- Read from `modelSelectionsByProvider[runtimeProvider]` first
- Hydrate global keys (`reasoningModel`, `completionModel`, `valueModel`) with provider-specific values
- Update `postConfig` to always include legacy keys + provider map
- Ensure atomic save operations (both global and provider-scoped saved together)

**Out of Scope**:
- Changes to proxy start logic itself
- AnthropicApply modifications (deprecated path)

**Dependencies**:
- Phase 3: Key normalization must be complete

**Acceptance Criteria**:
- [ ] `handleStartProxy` reads models from provider-specific config first
- [ ] Global keys hydrated with current provider's models before `applyToClaudeCode`
- [ ] Integration test: first start after provider switch uses correct models
- [ ] Integration test: settings.json reflects active provider's models on first start
- [ ] Logs show hydration sequence with before/after values

**Testing Strategy**:
```typescript
// VS Code integration test
test('first start after provider switch applies correct models', async () => {
  // Setup: provider 'glm' with specific models selected
  await cfg.update('modelSelectionsByProvider', {
    glm: {
      reasoning: 'glm-4-plus',
      completion: 'glm-4-air',
      value: 'glm-4-flash'
    }
  })
  
  await cfg.update('provider', 'glm')
  
  // Start proxy
  await vscode.commands.executeCommand('claudeThrone.startProxy')
  
  // Verify settings.json has GLM models
  const claudeSettings = readClaudeSettings()
  expect(claudeSettings.ANTHROPIC_MODEL).toBe('glm-4-plus')
  expect(claudeSettings.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe('glm-4-air')
})
```

**Implementation Notes**:
- Add `hydrateGlobalKeysFromProvider(providerId)` helper function
- Log hydration with clear "BEFORE" and "AFTER" values (DEBUG mode)
- Add warning if provider-specific config is empty but global keys exist (stale state)
- Verify config writes complete before calling `applyToClaudeCode`

**Estimated Effort**: 2-3 days

**Risk Level**: High - Touches critical proxy start flow, requires careful integration testing

---

### Phase 5: Event Listener Discipline & UI Optimization

**Scope**:
- Fix duplicate event listener bindings in `renderModelList`
- Add debouncing to filter input (300ms delay)
- Remove listeners before re-attaching in `renderModelList`
- Add render cycle guards (prevent redundant renders in same tick)
- Optimize `updateSelectedModelsDisplay` to avoid unnecessary DOM updates

**Out of Scope**:
- Complete webview UI refactor
- React/framework migration

**Dependencies**:
- Phase 2: Model loading must be stable before optimizing render

**Acceptance Criteria**:
- [ ] No duplicate click listeners on model buttons
- [ ] Filter input debounced (typing rapidly doesn't cause flicker)
- [ ] Unit test: spy on `addEventListener` to verify single binding
- [ ] Manual test: rapidly type in filter, verify no flicker or lag
- [ ] Manual test: hover over models, verify no layout shift or multiple bindings

**Testing Strategy**:
```javascript
// Unit test with spy
test('renderModelList does not attach duplicate listeners', () => {
  const container = document.createElement('div')
  const addEventListenerSpy = vi.spyOn(container, 'addEventListener')
  
  // Render twice
  renderModelList(container, models, state)
  renderModelList(container, models, state)
  
  // Should have removed old listeners, only one set attached
  const clickListeners = addEventListenerSpy.mock.calls.filter(
    call => call[0] === 'click'
  )
  
  // Expect only buttons from second render, not duplicates
  expect(clickListeners.length).toBe(models.length)
})
```

**Implementation Notes**:
- Use `AbortController` for listener cleanup (modern pattern)
- Store controller in state and abort before re-render
- Add `lodash.debounce` or custom debounce for filter input
- Document listener discipline in CONSTITUTION.md

**Estimated Effort**: 1-2 days

**Risk Level**: Low - UI optimization, low risk of breaking functionality

---

### Phase 6: Test Suite & CI Infrastructure

**Scope**:
- Create comprehensive unit tests for all critical webview functions
- Add VS Code extension integration tests for start/stop/switching flows
- Create contract tests for all message types
- Setup GitHub Actions CI workflow
- Add PR labeling rules and CI gates for guarded files
- Document test patterns and guidelines in CLAUDE.md

**Out of Scope**:
- Performance testing or load testing
- End-to-end browser automation tests

**Dependencies**:
- Phases 1-5: All guardrails must be implemented to test

**Acceptance Criteria**:
- [ ] Unit tests cover: `handleModelsLoaded`, `onProviderChange`, `setModelFromList`, `renderModelList`
- [ ] Integration tests cover: start/stop flow, provider switching, model persistence
- [ ] Contract tests cover: all message schemas, config payloads
- [ ] CI workflow file: `.github/workflows/regression.yml` exists
- [ ] CI runs on PRs touching guarded files (webview/main.js, PanelViewProvider.ts)
- [ ] PR template includes Constitution compliance checklist
- [ ] All tests pass in CI

**Testing Strategy**:

**Unit Tests** (`tests/webview-unit.test.js`):
```javascript
describe('Webview Unit Tests', () => {
  describe('handleModelsLoaded', () => {
    it('respects provider and sequence token')
    it('ignores late responses from wrong provider')
    it('updates cache keyed by provider')
  })
  
  describe('onProviderChange', () => {
    it('saves old provider models before switching')
    it('clears old provider cache')
    it('restores new provider models from state')
  })
  
  describe('setModelFromList', () => {
    it('saves to completion key, not coding key')
    it('includes providerId in saveModels message')
  })
  
  describe('Event Listeners', () => {
    it('does not attach duplicate listeners on re-render')
    it('debounces filter input to prevent flicker')
  })
})
```

**Integration Tests** (`extensions/claude-throne/tests/integration.test.ts`):
```typescript
describe('Start/Stop Integration', () => {
  it('first start after provider switch applies correct models')
  it('settings.json reflects active provider models')
  it('switching providers back and forth restores selections')
  it('fallback hydration triggers when legacy keys exist but provider map is empty')
})

describe('Provider Switching', () => {
  it('switching from OpenRouter to GLM clears OpenRouter cache')
  it('GLM model list not contaminated by OpenRouter models')
  it('model selections persist across extension reload')
})
```

**Contract Tests** (`tests/contract.test.js`):
```javascript
describe('Message Contracts', () => {
  it('modelsLoaded message includes required fields')
  it('saveModels message includes providerId')
  it('config payload includes legacy keys + modelSelectionsByProvider')
  it('invalid messages are rejected and logged')
})
```

**CI Workflow** (`.github/workflows/regression.yml`):
```yaml
name: Regression Tests

on:
  pull_request:
    paths:
      - 'extensions/claude-throne/webview/main.js'
      - 'extensions/claude-throne/src/views/PanelViewProvider.ts'
      - 'extensions/claude-throne/src/services/AnthropicApply.ts'

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm install
      - run: npm test
      - run: cd extensions/claude-throne && npm install && npm test
      
  label-check:
    runs-on: ubuntu-latest
    steps:
      - name: Check PR labels
        run: |
          # Require area:* labels on PRs touching guarded files
          # Fail if no area label present
```

**Implementation Notes**:
- Use Vitest for unit tests (already in project)
- Use `@vscode/test-electron` for integration tests
- Mock VS Code APIs with test doubles
- Add `npm run test:ci` script that runs all tests sequentially
- Document test patterns in CLAUDE.md with examples

**Estimated Effort**: 3-4 days

**Risk Level**: Low - Test infrastructure doesn't change production code, only validates it

---

## Dependencies Map

```
Phase 1 (Schemas)
    ↓
Phase 2 (Model Loading) ← Phase 3 (Key Normalization)
    ↓                          ↓
Phase 4 (Start/Stop)
    ↓
Phase 5 (UI Optimization)
    ↓
Phase 6 (Tests & CI)
```

**Parallel Work Opportunities**:
- Phase 2 and Phase 3 can be worked on in parallel after Phase 1
- Phase 5 can begin once Phase 2 is stable (doesn't depend on 3 or 4)

---

## Overall Testing Strategy

**Unit Testing**:
- All webview logic functions isolated with jsdom
- Mock VS Code APIs with test doubles
- Focus on state transitions and message validation
- Use spies to verify event listener behavior

**Integration Testing**:
- Use `@vscode/test-electron` for real extension environment
- Test start/stop flow with actual config reads/writes
- Verify settings.json and .claude/settings.json changes
- Test provider switching end-to-end

**Contract Testing**:
- Validate all messages against Zod schemas
- Test schema evolution (backward compatibility)
- Ensure invalid messages fail closed (rejected, not silently ignored)

**Manual Testing Checklist**:
- [ ] Switch providers: OpenRouter → GLM → custom → back to OpenRouter
- [ ] Verify model list differs per provider, no stale entries
- [ ] Select models for each provider, switch between them
- [ ] Start proxy, verify settings.json shows active provider's models on first start
- [ ] Stop proxy, verify revert works correctly
- [ ] Type rapidly in filter input, verify no flicker or duplicate re-renders
- [ ] Open DevTools, verify no duplicate event listener warnings
- [ ] Enable DEBUG mode, verify hydration and validation logs appear

---

## Rollback Plan

**Per-Phase Rollback**:
Each phase is independently releasable. If critical issues arise:

1. **Phase 1**: No rollback needed (schema files don't affect runtime)
2. **Phase 2**: Revert model loading changes, fall back to pre-token validation (lose race protection but maintain functionality)
3. **Phase 3**: Revert key normalization, use `coding` key directly (backward compatible)
4. **Phase 4**: Revert hydration logic, rely on legacy global keys only (may cause stale provider issue but proxy still starts)
5. **Phase 5**: Revert listener fixes, accept duplicate bindings temporarily
6. **Phase 6**: No rollback needed (tests don't affect production)

**Emergency Rollback**:
```bash
# Revert to last known good commit
git revert HEAD~N  # N = number of commits since start of phase

# Or use feature flag to disable validation
DEBUG_SKIP_VALIDATION=1 npm start
```

**Feature Flags**:
- `ENABLE_SCHEMA_VALIDATION` - Toggle message schema validation
- `ENABLE_TOKEN_VALIDATION` - Toggle request token checking
- `ENABLE_KEY_NORMALIZATION` - Toggle completion key enforcement
- `ENABLE_PRE_APPLY_HYDRATION` - Toggle start/stop hydration logic

Flags stored in VS Code settings: `claudeThrone.featureFlags.*`

---

## Best Practices for This Implementation

- [x] Start with read-only changes and analysis (Phase 1: schemas only)
- [x] Maintain backward compatibility during migration (Phase 3: keep `coding` read fallback)
- [x] Use feature flags for gradual rollout (flags documented above)
- [x] Test at phase boundaries, not just at the end (each phase has acceptance tests)
- [x] Document learnings and update plan as needed (Notes section below)
- [x] Commit frequently with descriptive messages (per-phase commits)
- [x] Create phase-specific PRs for review (one PR per phase recommended)
- [x] Update CONSTITUTION.md as invariants are codified (especially Phase 1, 2, 4)
- [x] Add inline comments explaining guardrails (Comment 1, 2, 3 pattern)

---

## Progress Tracking

- [x] **Phase 1: Message Schema & Contract Foundation** (Completed: 2025-10-28)
- [x] **Phase 2: Provider-Aware Model Loading & Race Protection** (Completed: 2025-10-28)
- [ ] Phase 3: Key Normalization & Storage Standardization
- [ ] Phase 4: Deterministic Start/Stop with Pre-Apply Hydration
- [ ] Phase 5: Event Listener Discipline & UI Optimization
- [ ] Phase 6: Test Suite & CI Infrastructure

---

## Notes & Learnings

### Phase 1 Completion Notes (2025-10-28)

**What was implemented**:
- Created `src/schemas/messages.ts` with Zod schemas for all webview ↔ extension messages
- Created `src/schemas/config.ts` with configuration schemas and validation helpers
- Added 26 contract tests in `tests/contract.test.js` (all passing)
- Installed Zod in both main project and extension
- Updated CONSTITUTION.md with schema versioning policy (Semver: 1.0.0)

**Key Design Decisions**:
1. Used Zod for runtime validation (already in VS Code ecosystem)
2. Added sequence token field to model loading messages (for Phase 2 race protection)
3. Made `coding` key optional with `@deprecated` annotation for Phase 3 compatibility
4. Created helper functions for normalization and fallback detection
5. Implemented both strict and safe validation modes with feature flag support

**Contract Test Coverage**:
- ModelsLoaded message validation (provider and token fields)
- SaveModels message validation (providerId requirement)
- Config payload validation (provider map + legacy keys)
- Provider map structure validation (completion key enforcement)
- ModelsSaved confirmation validation
- Request/response token matching
- Key normalization (coding → completion)
- Fallback hydration detection
- Configuration invariant checks

**Challenges Resolved**:
- Fixed Zod record schema syntax (needed explicit key type: `z.record(z.string(), schema)`)
- Ensured backward compatibility with legacy `coding` key while enforcing `completion` as canonical

**Next Steps for Phase 2**:
- Integrate schemas into actual webview and extension code
- Add token generation and validation to model loading flow
- Implement provider validation in `handleModelsLoaded`

### Phase 2 Completion Notes (2025-10-28)

**What was implemented**:
- Added `requestTokenCounter` and `currentRequestToken` to webview state
- Updated `loadModels()` to generate incrementing sequence tokens (`token-1`, `token-2`, etc.)
- Modified `handleModelsLoaded()` to validate both provider and token before rendering
- Updated `PanelViewProvider.handleListModels()` to accept and pass through tokens
- Added token field to all model loading messages (request and response)
- Created 13 unit tests in `tests/webview-race-protection.test.js` (all passing)

**Validation Logic**:
1. **Token Validation**: Late responses with mismatched tokens are ignored
2. **Provider Validation**: Cross-provider responses (e.g., OpenRouter response when on GLM) are rejected
3. **Cache Isolation**: Models cached by provider key to prevent contamination
4. **Logging**: Clear console logs show which responses are accepted vs ignored

**Test Coverage**:
- Request token generation (incrementing sequence)
- Token validation (matching vs mismatched tokens)
- Provider validation (same provider vs cross-provider)
- Provider-scoped caching
- Race condition scenarios (rapid provider switching, slow network)
- Full request/response cycle integration

**Code Changes**:
- `extensions/claude-throne/webview/main.js`: Added token generation and validation
- `extensions/claude-throne/src/views/PanelViewProvider.ts`: Added token pass-through
- `tests/webview-race-protection.test.js`: 13 new tests

**Results**:
- ✅ 13/13 race protection tests passing
- ✅ 26/26 contract tests passing
- ✅ All proxy integration tests passing
- ✅ No regressions in existing functionality

**Key Benefits**:
1. **Prevents stale data**: Late responses from network delays won't overwrite current UI
2. **Prevents cross-contamination**: Switching from OpenRouter to GLM won't show OpenRouter models
3. **Improves reliability**: Users can rapidly switch providers without UI glitches
4. **Backward compatible**: Token validation is optional (works without tokens too)

**Debug Example**:
```
[loadModels] Requesting models for provider: glm, token: token-2
[handleModelsLoaded] Received 50 models for provider: glm, token: token-2, currentRequestToken: token-2
[handleModelsLoaded] ✓ Validation passed - rendering 50 models for current provider: glm

// Later - late response arrives
[handleModelsLoaded] Received 400 models for provider: openrouter, token: token-1, currentRequestToken: token-2
[handleModelsLoaded] IGNORING late response - token mismatch (expected: token-2, got: token-1)
```

**Next Steps for Phase 3**:
- Standardize on `completion` key throughout codebase
- Add read fallback for legacy `coding` key
- Update all write operations to use canonical key
- Add deprecation warnings in DEBUG mode

### Pre-Implementation Analysis

**Existing Comments in Code**:
The codebase already has awareness comments (Comment 1, 2, 3, 6) that indicate:
- Comment 1: "Standardize on 'completion' key"
- Comment 2: "Add legacy model keys to payload"
- Comment 3: "Normalize terminology - use 'completion' internally"
- Comment 4: "Include providerId in saveModels message"
- Comment 6: "Add targeted logs around save round-trip"

These comments provide good scaffolding for Phase 3 (key normalization) and should be retained and expanded.

**Current Test Coverage**:
- Proxy tests exist in `/tests/*.test.js` (using Vitest)
- Extension tests exist in `/extensions/claude-throne/tests/PanelViewProvider.test.ts`
- Good foundation, but missing webview unit tests and integration tests for start/stop flow
- No contract tests or CI workflow yet

**Risk Mitigation**:
The highest risk phase is Phase 4 (Start/Stop hydration) because it touches proxy startup logic. Mitigation strategies:
1. Implement feature flag to disable hydration if issues arise
2. Add extensive logging to debug hydration sequence
3. Create integration test that validates settings.json before production release
4. Test with all three combinations: OpenRouter, native providers (GLM/Deepseek), and custom providers

[Add notes here as phases are completed]

---

**Created**: 2025-10-28  
**Last Updated**: 2025-10-28  
**Status**: Planning Complete - Ready for Phase 1
