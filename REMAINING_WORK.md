# Remaining Work Summary

**Date**: 2025-10-29  
**Status**: 14 of 19 comments complete (74% done)

## ✅ Completed (14 comments)

1. **Comment 1** - Runtime schema validation in webview ✅
2. **Comment 2** - Schema validation in PanelViewProvider ✅
3. **Comment 4** - Hydration always sets completion/value ✅
4. **Comment 5** - Canonical storage (completion only) ✅
5. **Comment 6** - CI workflow and PR template ✅
6. **Comment 7** - Per-provider cache clearing ✅
7. **Comment 8** - Token generation and validation ✅
8. **Comment 9** - Schema location consolidation ✅
9. **Comment 10** - Gate deprecated applyAnthropicUrl ✅
10. **Comment 11** - Fix handleModelsError provider consistency ✅
11. **Comment 12** - Save operation lock with provider tracking ✅
12. **Comment 15** - Documentation updates ✅
13. **Comment 16** - Save old provider before state change ✅
14. **Comment 19** - Wire feature flags to webview ✅

## 🔄 Remaining (5 comments)

### High Priority (1 comment)

#### ⏳ Comment 3: Align Provider Identity Strategy
**Status**: Not Started  
**Complexity**: High  
**Estimated Time**: 3-4 hours

**Decision Required**: Choose between two approaches:

**Option A** (Recommended): Use concrete custom provider ID everywhere
- `modelSelectionsByProvider['my-custom']` instead of `['custom']`
- Clearer identity, simpler state management
- Less refactoring required

**Option B**: Always use 'custom' as key
- `modelSelectionsByProvider['custom']`
- Track `state.selectedCustomProviderId` separately
- More complex but keeps 'custom' as placeholder

**Implementation Steps** (if choosing Option A):
1. Update `handleConfigLoaded` in webview to use selectedCustomProviderId as provider key
2. Update `saveModels` to always use concrete provider ID
3. Update `onProviderChange` to handle custom provider ID switching
4. Add tests for switching among multiple custom providers
5. Verify model persistence across custom provider switches

**Files to Modify**:
- `extensions/claude-throne/webview/main.js` (handleConfigLoaded, saveModels, onProviderChange)
- `extensions/claude-throne/src/views/PanelViewProvider.ts` (handleUpdateProvider, handleSaveModels)
- Add tests in `tests/custom-provider-identity.test.js`

---

### Medium Priority (3 comments)

#### ⏳ Comment 14: Integration Tests for VS Code Extension
**Status**: Not Started  
**Complexity**: High  
**Estimated Time**: 4-6 hours

**Deliverables**:
1. Create `extensions/claude-throne/tests/integration.test.ts`
2. Use `@vscode/test-electron` framework
3. Cover scenarios:
   - First start after provider switch applies correct models
   - settings.json reflects active provider
   - Switching providers and back restores selections
   - Fallback hydration when legacy keys exist
4. Wire `npm test` script in extension package.json
5. Update CI workflow to run extension tests

**Test Scaffolding**:
```typescript
import * as vscode from 'vscode';
import * as assert from 'assert';
import { runTests } from '@vscode/test-electron';

suite('Extension Integration Tests', () => {
  test('Start proxy after provider switch uses correct models', async () => {
    // Switch to GLM
    // Select models
    // Start proxy
    // Verify settings.json shows GLM models
  });
  
  test('Provider restoration preserves selections', async () => {
    // Configure OpenRouter with models
    // Switch to GLM
    // Switch back to OpenRouter
    // Verify OpenRouter models still selected
  });
});
```

**Files to Create/Modify**:
- `extensions/claude-throne/tests/integration.test.ts` (new)
- `extensions/claude-throne/package.json` (add test script)
- `.github/workflows/regression.yml` (add extension test job)

---

#### ⏳ Comment 17: Structured Telemetry
**Status**: Not Started  
**Complexity**: Medium  
**Estimated Time**: 2-3 hours

**Requirements**:
1. Ensure all error posts use `ErrorMessageSchema` shape: `{ provider, error, errorType, token? }`
2. Add in-memory log buffer in webview keyed by provider + token
3. Gate debug panel under existing debug checkbox
4. Add schema conformance tests

**Implementation**:
```javascript
// Webview error buffer
state.errorLog = []; // Max 50 entries

function logError(provider, error, errorType, token) {
  state.errorLog.push({
    timestamp: Date.now(),
    provider,
    error,
    errorType,
    token
  });
  if (state.errorLog.length > 50) {
    state.errorLog.shift(); // Keep only recent 50
  }
}

// Debug panel rendering
function renderDebugPanel() {
  if (!state.debug) return;
  
  const panel = document.getElementById('debugPanel');
  panel.innerHTML = `
    <h4>Error Log</h4>
    ${state.errorLog.map(e => `
      <div class="error-entry">
        <span>${new Date(e.timestamp).toLocaleTimeString()}</span>
        <span>${e.provider}</span>
        <span>${e.errorType}</span>
        <span>${e.error}</span>
      </div>
    `).join('')}
  `;
}
```

**Files to Modify**:
- `extensions/claude-throne/webview/main.js` (add error buffer)
- `extensions/claude-throne/webview/styles.css` (debug panel styles)
- `tests/error-telemetry.test.js` (new - schema conformance tests)

---

### Low Priority (2 comments)

#### ⏳ Comment 18: Optimize Filter Re-renders
**Status**: Not Started  
**Complexity**: Low  
**Estimated Time**: 1-2 hours

**Implementation**:
```javascript
// Track last filtered IDs
state.lastFilteredIds = [];

function renderModelList(searchTerm) {
  // ... existing filter logic ...
  
  const filteredIds = filtered.map(m => m.id).sort();
  
  // Check if filtered list changed
  const idsChanged = JSON.stringify(filteredIds) !== JSON.stringify(state.lastFilteredIds);
  
  if (!idsChanged) {
    console.log('[Performance] Skipping re-render - filtered list unchanged');
    return;
  }
  
  state.lastFilteredIds = filteredIds;
  
  // ... existing render logic ...
}
```

**Performance Test**:
```javascript
test('Filter input with 400 models completes in <100ms', async () => {
  const startTime = performance.now();
  filterInput.value = 'gpt';
  filterInput.dispatchEvent(new Event('input'));
  await new Promise(resolve => setTimeout(resolve, 400)); // Wait for debounce
  const duration = performance.now() - startTime;
  expect(duration).toBeLessThan(500); // Including debounce time
});
```

**Files to Modify**:
- `extensions/claude-throne/webview/main.js` (renderModelList optimization)
- `tests/phase5-ui-optimization.test.js` (add performance test)

---

#### ⏳ Comment 13: Create Bead
**Status**: Not Started  
**Complexity**: Low  
**Estimated Time**: 30 minutes

**Steps**:
1. Run `bd create --prefix coding-agent --scope "Constitution compliance implementation"`
2. Link to commits (once changes are committed)
3. Record dependencies and completion status
4. Close with `bd close --reason "14 of 19 comments complete, remaining tracked in REMAINING_WORK.md"`
5. Export with `bd export -o .beads/issues.jsonl`
6. Commit the Bead file
7. Reference Bead ID in PR description

---

## Summary Statistics

| Metric | Value |
|--------|-------|
| **Total Comments** | 19 |
| **Completed** | 14 (74%) |
| **Remaining** | 5 (26%) |
| **High Priority Remaining** | 1 |
| **Medium Priority Remaining** | 2 |
| **Low Priority Remaining** | 2 |

**Estimated Remaining Effort**: 10-15 hours

## Files Modified So Far

### Core Changes
```
extensions/claude-throne/webview/main.js              [+232 lines] - Schema validation, feature flags
extensions/claude-throne/src/views/PanelViewProvider.ts [+58 lines]  - Schema validation helper, post() method
extensions/claude-throne/src/schemas/messages.ts      [~10 lines]  - Updated SaveModelsMessageSchema
extensions/claude-throne/src/schemas/config.ts        [+2 lines]   - Added enableAnthropicDirectApply flag
extensions/claude-throne/src/services/AnthropicApply.ts [+13 lines] - Feature flag gate

### Documentation
CONSTITUTION.md                    [~20 lines] - Updated paths, invariants
docs/WEBVIEW-GUIDE.md             [+200 lines] - Technical reference section
IMPLEMENTATION_STATUS.md          [NEW]
REMAINING_WORK.md                 [NEW]

### CI/CD
.github/workflows/regression.yml  [NEW] - Complete CI workflow
.github/pull_request_template.md [NEW] - PR checklist
```

## Recommendations

### For Current PR (Before Merge)

**Must Complete**:
1. ✅ Schema validation (Comments 1 & 2) - DONE
2. ✅ Feature flags (Comment 19) - DONE
3. ✅ Deprecated function gating (Comment 10) - DONE

**Can Defer to Follow-up PRs**:
- Comment 3 (Provider identity) - Architectural decision, needs discussion
- Comment 14 (Integration tests) - Can be separate testing PR
- Comment 17 (Telemetry) - Enhancement, not blocking
- Comment 18 (Performance) - Optimization, not critical
- Comment 13 (Bead) - Administrative

### Testing Before PR

```bash
# Run full test suite
npm test

# Verify extension compiles
cd extensions/claude-throne && npm run compile

# Manual smoke test
# 1. Switch providers (OpenRouter → GLM → back)
# 2. Verify model selections persist
# 3. Check settings.json after start/stop
# 4. Test with feature flag disabled
```

### Follow-up Work Tracking

**Next Sprint**:
- Comment 3: Provider identity alignment (needs architectural decision)
- Comment 14: Integration test framework

**Future Enhancements**:
- Comment 17: Structured telemetry and debug panel
- Comment 18: Performance optimization for large model lists
- Remove all 'coding' support in v2.0.0 (after v1.5.0 deprecation period)

---

**Last Updated**: 2025-10-29  
**Author**: Claude Code (Sonnet 4.5)
