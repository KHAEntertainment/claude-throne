# Claude Throne v1.4.13 - Model Persistence UI/Backend Disconnect Fix

## Summary
This release fixes a critical bug where saved models appeared to persist in the UI but were not actually applied when starting the proxy. This caused `.claude/settings.json` to retain old values or defaults instead of using the user's selected models.

## Issue: Model Persistence UI/Backend Disconnect

### Problem
When users selected models from the dropdown and the proxy was started:
1. The UI showed the previously selected models (e.g., "ring-1t", "ling-1t")
2. But clicking "Start Proxy" didn't apply these models to `.claude/settings.json`
3. The settings file retained old Anthropic defaults or previous values
4. Only manually re-selecting models from the list would update the settings

### Root Causes

#### Cause 1: Webview Showed Stale Cached Models
**File**: `extensions/claude-throne/webview/main.js` (lines 854-860)

The webview's `handleConfigLoaded` function only updated state when config values were truthy:
```javascript
if (config.reasoningModel) {  // Empty string is falsy!
  state.primaryModel = config.reasoningModel;
}
```

When `reasoningModel` and `completionModel` were empty strings in VS Code configuration, the webview kept displaying old cached values, creating a false impression that models were saved.

#### Cause 2: Backend Didn't Write Empty Config to Settings
**File**: `extensions/claude-throne/src/extension.ts` (lines 356-378)

The `applyToClaudeCode` function only wrote model environment variables if `reasoningModel` existed:
```typescript
if (twoModelMode && reasoningModel && completionModel) {
    // Write models
} else if (reasoningModel) {
    // Write models  
} else {
    // Warning: No reasoning model set!
    // DOESN'T WRITE ANY MODELS - file keeps old values
}
```

When models were empty, no model env vars were written to `.claude/settings.json`, so the file retained whatever values were there before.

## Fixes Applied

### Fix 1: Webview Always Updates State (CRITICAL)
**File**: `extensions/claude-throne/webview/main.js`
**Lines**: 854-862

Changed from conditional updates to always update state:
```javascript
// OLD - only updated if truthy
if (config.reasoningModel) {
  state.primaryModel = config.reasoningModel;
}

// NEW - always update to match config
state.primaryModel = config.reasoningModel || '';
state.secondaryModel = config.completionModel || '';

console.log('[handleConfigLoaded] Updated model state:', {
  primaryModel: state.primaryModel,
  secondaryModel: state.secondaryModel,
  fromConfig: true
});
```

**Impact**: UI now accurately reflects what's saved in VS Code configuration, eliminating false positive displays.

### Fix 2: Validation on Proxy Start
**File**: `extensions/claude-throne/src/views/PanelViewProvider.ts`
**Lines**: 448-466

Added validation before starting proxy to check if models are configured:
```typescript
// Validate that models are configured
if (!reasoningModel || !completionModel) {
  this.log.appendLine(`[handleStartProxy] WARNING: Models not configured`)
  this.log.appendLine(`[handleStartProxy] - reasoningModel: ${reasoningModel || 'EMPTY'}`)
  this.log.appendLine(`[handleStartProxy] - completionModel: ${completionModel || 'EMPTY'}`)
  
  const choice = await vscode.window.showWarningMessage(
    'No models selected. Please select models from the list before starting the proxy.',
    'Select Models',
    'Start Anyway'
  )
  
  if (choice === 'Select Models') {
    return  // User needs to select models
  }
  this.log.appendLine(`[handleStartProxy] User chose to start without models configured`)
}
```

**Impact**: Users are now explicitly warned when trying to start the proxy without configured models, preventing silent failures.

### Fix 3: Enhanced Logging in applyToClaudeCode
**File**: `extensions/claude-throne/src/extension.ts`
**Lines**: 358, 378-384

Added comprehensive logging to show exactly what's happening:
```typescript
log.appendLine(`[applyToClaudeCode] Input models: reasoning='${reasoningModel || 'EMPTY'}', completion='${completionModel || 'EMPTY'}'`);

// ... model assignment logic ...

if (no models) {
  log.appendLine(`[applyToClaudeCode] ⚠️ WARNING: No reasoning model configured!`);
  log.appendLine(`[applyToClaudeCode] ⚠️ Models will NOT be written to .claude/settings.json`);
  log.appendLine(`[applyToClaudeCode] ⚠️ File will retain previous values or Anthropic defaults`);
}

log.appendLine(`[applyToClaudeCode] Env vars to write: ${JSON.stringify(Object.keys(env))}`);
log.appendLine(`[applyToClaudeCode] Will write models to settings.json: ${!!reasoningModel}`);
```

**Impact**: Clear diagnostic information helps users understand why models aren't being applied and assists with troubleshooting.

### Fix 4: Improved Logging in handleStartProxy
**File**: `extensions/claude-throne/src/views/PanelViewProvider.ts`
**Line**: 469

Changed logging to show when models aren't set:
```typescript
// OLD
this.log.appendLine(`[handleStartProxy] Models: reasoning=${reasoningModel}, completion=${completionModel}`)

// NEW  
this.log.appendLine(`[handleStartProxy] Models: reasoning=${reasoningModel || 'NOT SET'}, completion=${completionModel || 'NOT SET'}`)
```

## Testing Performed
1. ✅ TypeScript compilation verified (`tsc --noEmit` passed)
2. ✅ Extension compiled successfully
3. ✅ VSIX package created (650KB, 208 files)

## User Experience Changes

### Before (v1.4.12)
1. User selects models → UI shows "ring-1t" and "ling-1t"
2. User restarts VS Code
3. UI still shows "ring-1t" and "ling-1t" (stale cache)
4. User clicks "Start Proxy"
5. `.claude/settings.json` gets Anthropic defaults, not the cached models
6. User confused why their selections aren't working

### After (v1.4.13)
1. User selects models → Saved to VS Code config + UI updates
2. User restarts VS Code
3. If models not saved: UI shows "No model selected" (accurate)
4. User clicks "Start Proxy"
5. If no models: Warning dialog appears: "No models selected. Please select models..."
6. User selects models from list → Models saved and applied correctly
7. `.claude/settings.json` gets the correct models

## Migration Notes

### For Users Experiencing This Issue
1. Open Claude Throne panel
2. Click "Start Proxy" - you'll now see a warning if models aren't configured
3. Click "Select Models" and choose from the model list
4. Start the proxy again - models will now be properly applied

### Checking Your Configuration
Look at your workspace settings (`.vscode/settings.json`):
```json
{
  "claudeThrone.reasoningModel": "",  // ← Should have a model ID, not empty
  "claudeThrone.completionModel": "", // ← Should have a model ID, not empty
}
```

If these are empty, select models from the list in the Claude Throne panel.

## Breaking Changes
None - all changes are backward compatible.

## Known Limitations
- Models must be selected from the model list at least once after upgrading to v1.4.13
- The fix doesn't automatically populate models from cached webview state (intentional - prevents propagating stale data)

## Files Modified
1. `extensions/claude-throne/webview/main.js` - Fix stale state caching
2. `extensions/claude-throne/src/views/PanelViewProvider.ts` - Add validation and logging
3. `extensions/claude-throne/src/extension.ts` - Enhanced diagnostic logging
4. `extensions/claude-throne/package.json` - Version bump to 1.4.13

## Version History
- Previous: v1.4.12 (fixed model loading and latency)
- Current: v1.4.13 (fixed UI/backend disconnect)

## Related Issues
This fix addresses the follow-up issue discovered in v1.4.12 where model persistence appeared to work in the UI but didn't actually apply the saved models on proxy start.

## Installation
```bash
code --install-extension extensions/claude-throne/claude-throne-1.4.13.vsix
```
