# Claude Throne v1.4.14 - Fix Model Persistence Across Sessions

## Summary
This release fixes a critical bug where saved model selections were cleared every time the proxy stopped, requiring users to manually re-select models before each proxy start.

## Issue: Models Not Persisting Across Proxy Stop/Start Cycles

### Problem
After v1.4.13, the validation fix correctly warned users when models weren't configured, but this revealed another issue:

**User Experience:**
1. User selects models from list → Saved to VS Code config ✅
2. User clicks "Start Proxy" → Models applied, proxy works ✅  
3. User clicks "Stop Proxy" → **Models cleared from config** ❌
4. User clicks "Start Proxy" again → Validation warning: "No models selected" ❌
5. User forced to re-select models manually every session ❌

**Expected Behavior:**
Models should persist across sessions. Select once, use forever (until manually changed).

### Root Cause

**File**: `extensions/claude-throne/src/extension.ts` (lines 203-207 in v1.4.13)

The `revertApply` command was clearing user's saved model preferences:

```typescript
// Clear reasoning and completion models in configuration at both Workspace and Global scopes
await cfg.update('reasoningModel', '', vscode.ConfigurationTarget.Workspace);
await cfg.update('completionModel', '', vscode.ConfigurationTarget.Workspace);
await cfg.update('reasoningModel', '', vscode.ConfigurationTarget.Global);
await cfg.update('completionModel', '', vscode.ConfigurationTarget.Global);
```

This code was executed every time the proxy stopped (when `autoApply` is enabled), wiping out the user's model selections.

### Why This Happened

The original intent was to "clean up" all Claude Throne settings when reverting to Anthropic defaults. However, this conflated two separate concepts:

1. **Runtime settings** (what's in `.claude/settings.json` for Claude Code CLI) - SHOULD revert
2. **User preferences** (what models the user wants Claude Throne to use) - SHOULD persist

The bug treated user preferences as runtime settings, clearing them on every revert.

## The Fix

### Change Made
**File**: `extensions/claude-throne/src/extension.ts` (lines 204-207)

**REMOVED:**
```typescript
// Clear reasoning and completion models in configuration at both Workspace and Global scopes
await cfg.update('reasoningModel', '', vscode.ConfigurationTarget.Workspace);
await cfg.update('completionModel', '', vscode.ConfigurationTarget.Workspace);
await cfg.update('reasoningModel', '', vscode.ConfigurationTarget.Global);
await cfg.update('completionModel', '', vscode.ConfigurationTarget.Global);
```

**REPLACED WITH:**
```typescript
// NOTE: We do NOT clear reasoningModel/completionModel here anymore
// User's saved model preferences should persist across proxy stop/start cycles
// Only .claude/settings.json is reverted to Anthropic defaults for Claude Code CLI
```

### Why This Fix Works

**What `revertApply` Now Does:**
- ✅ Reverts `.claude/settings.json` to Anthropic defaults (for Claude Code CLI)
- ✅ Reverts VS Code extension settings (baseUrl) to Anthropic
- ✅ Reverts terminal environment variables to Anthropic
- ✅ **Preserves user's saved model preferences** (new behavior)

**User preferences persist independently** of whether the proxy is running or not, which is the expected behavior for configuration settings.

## Impact

### User Experience - Before (v1.4.13)
```
Select models → Start proxy → Works ✅
Stop proxy → Models cleared ❌
Start proxy → "No models selected" warning ❌
Re-select models manually → Start proxy → Works ✅
Stop proxy → Models cleared again ❌
[Infinite loop of re-selection]
```

### User Experience - After (v1.4.14)
```
Select models → Start proxy → Works ✅
Stop proxy → Models preserved ✅
Start proxy → Works automatically ✅
Stop proxy → Models still preserved ✅
[Models persist forever until manually changed]
```

### Configuration Behavior

**Before stopping proxy:**
`.vscode/settings.json`:
```json
{
  "claudeThrone.reasoningModel": "qwen/qwen3-vl-32b-instruct",
  "claudeThrone.completionModel": "ibm-granite/granite-4.0-h-micro"
}
```

`.claude/settings.json`:
```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "http://127.0.0.1:3616",
    "ANTHROPIC_MODEL": "qwen/qwen3-vl-32b-instruct",
    "ANTHROPIC_DEFAULT_OPUS_MODEL": "qwen/qwen3-vl-32b-instruct",
    "ANTHROPIC_DEFAULT_SONNET_MODEL": "ibm-granite/granite-4.0-h-micro",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "ibm-granite/granite-4.0-h-micro"
  }
}
```

**After stopping proxy (v1.4.13 - BAD):**
`.vscode/settings.json`:
```json
{
  "claudeThrone.reasoningModel": "",  // ← CLEARED!
  "claudeThrone.completionModel": ""  // ← CLEARED!
}
```

`.claude/settings.json`:
```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "https://api.anthropic.com",
    "ANTHROPIC_MODEL": "claude-sonnet-4-0",
    "ANTHROPIC_DEFAULT_OPUS_MODEL": "claude-opus-4-0",
    "ANTHROPIC_DEFAULT_SONNET_MODEL": "claude-sonnet-4-0",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "claude-3-5-haiku-latest"
  }
}
```

**After stopping proxy (v1.4.14 - GOOD):**
`.vscode/settings.json`:
```json
{
  "claudeThrone.reasoningModel": "qwen/qwen3-vl-32b-instruct",  // ← PRESERVED!
  "claudeThrone.completionModel": "ibm-granite/granite-4.0-h-micro"  // ← PRESERVED!
}
```

`.claude/settings.json`:
```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "https://api.anthropic.com",
    "ANTHROPIC_MODEL": "claude-sonnet-4-0",
    "ANTHROPIC_DEFAULT_OPUS_MODEL": "claude-opus-4-0",
    "ANTHROPIC_DEFAULT_SONNET_MODEL": "claude-sonnet-4-0",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "claude-3-5-haiku-latest"
  }
}
```

**When starting proxy again (v1.4.14):**
The preserved models from `.vscode/settings.json` are automatically applied to `.claude/settings.json` without requiring re-selection.

## Testing Performed
1. ✅ TypeScript compilation verified
2. ✅ Extension compiled successfully  
3. ✅ VSIX package created (650KB)
4. ✅ Verified model clearing code removed from compiled output

## Testing Instructions

To verify the fix works:

1. **Install v1.4.14:**
   ```bash
   code --install-extension extensions/claude-throne/claude-throne-1.4.14.vsix
   ```

2. **Test model persistence:**
   - Open Claude Throne panel
   - Select primary and secondary models from the list
   - Click "Start Proxy" → verify proxy starts without warning
   - Click "Stop Proxy"
   - **Check `.vscode/settings.json`** → models should still be there
   - Click "Start Proxy" again → should start without warning, models automatically applied
   - No manual re-selection needed!

3. **Verify revert still works:**
   - With proxy running, check `.claude/settings.json` has your selected models
   - Stop proxy
   - Check `.claude/settings.json` now has Anthropic defaults
   - This is correct - Claude Code CLI gets Anthropic defaults when proxy is stopped

## Breaking Changes
None - this is a bug fix that makes the extension work as users expected.

## Migration Notes

### For Users Upgrading from v1.4.13
If your models are currently empty (because v1.4.13 cleared them):
1. Select models from the list once
2. They will now persist across all future sessions

### For New Users
Just select models once, they'll persist forever (until you manually change them).

## Files Modified
1. `extensions/claude-throne/src/extension.ts` - Removed model clearing from revertApply
2. `extensions/claude-throne/package.json` - Version bump to 1.4.14

## Version History
- v1.4.12: Fixed model loading and request latency
- v1.4.13: Fixed UI/backend disconnect, added validation
- v1.4.14: Fixed model persistence across sessions (this release)

## Related Context

This completes the model persistence fix trilogy:
1. **v1.4.12**: Models weren't being loaded from config on startup
2. **v1.4.13**: UI showed stale cached models, added validation
3. **v1.4.14**: Models were being cleared on proxy stop (this fix)

Now models truly persist as expected! 🎉

## Technical Details

### What Gets Cleared vs. Preserved

**Cleared on proxy stop (runtime state):**
- `.claude/settings.json` environment variables
- VS Code extension settings (Anthropic/Claude baseUrl)  
- Terminal environment variables

**Preserved on proxy stop (user preferences):**
- `claudeThrone.reasoningModel` in VS Code config
- `claudeThrone.completionModel` in VS Code config
- `claudeThrone.twoModelMode` setting
- `claudeThrone.provider` setting
- All other Claude Throne configuration

This separation ensures runtime state is properly cleaned up while user preferences persist as expected for any configuration system.

## Installation
```bash
code --install-extension extensions/claude-throne/claude-throne-1.4.14.vsix
```
