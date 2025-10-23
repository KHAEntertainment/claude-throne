# Claude Throne v1.4.16 - Fix Settings Not Being Applied on Proxy Start

## Summary
This release fixes a critical bug where proxy settings were not being applied to `.claude/settings.json` when starting the proxy, causing Claude Code to bypass the proxy entirely and try to connect directly to Anthropic's API.

## The Bug

**Symptom**: "Unable to connect to API due to poor internet connection" with retries

**Root Cause**: The `applyToClaudeCode` command was only being called when `autoApply` was `true`. Most users don't have this setting enabled, so their proxy settings were NEVER applied.

## What Was Happening

### Before Fix (v1.4.13-v1.4.15):

1. User clicks "Start Proxy"
2. Extension starts proxy process on port 3616
3. Extension checks `autoApply` setting (defaults to `false`)
4. Since `autoApply` is `false`, **settings are NOT applied**
5. `.claude/settings.json` remains:
```json
{
  "ANTHROPIC_BASE_URL": "https://api.anthropic.com",
  "ANTHROPIC_MODEL": "claude-sonnet-4-0",
  ...
}
```
6. Claude Code tries to use Anthropic API directly
7. Fails because user doesn't have Anthropic API key
8. Error: "Unable to connect to API due to poor internet connection"

### After Fix (v1.4.16):

1. User clicks "Start Proxy"  
2. Extension starts proxy process on port 3616
3. Extension **ALWAYS applies settings** (regardless of `autoApply`)
4. `.claude/settings.json` gets updated:
```json
{
  "ANTHROPIC_BASE_URL": "http://127.0.0.1:3616",
  "ANTHROPIC_MODEL": "inclusionai/ring-1t",
  "ANTHROPIC_DEFAULT_OPUS_MODEL": "inclusionai/ring-1t",
  "ANTHROPIC_DEFAULT_SONNET_MODEL": "inclusionai/ling-1t",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL": "inclusionai/ling-1t"
}
```
5. Claude Code sends requests to proxy
6. Proxy forwards to OpenRouter with correct models
7. ✅ Success

## The Misunderstanding

**What `autoApply` should mean**:
- Should settings auto-revert to Anthropic when proxy stops?

**What we mistakenly made it mean**:
- Should settings be applied when proxy starts? (WRONG!)

The confusion was that we thought `autoApply` controlled both directions (apply on start AND revert on stop), but it should only control the revert behavior.

## The Fix

**File**: `extensions/claude-throne/src/views/PanelViewProvider.ts` (lines 490-495)

**Before**:
```typescript
// Auto-apply to Claude Code if enabled
const autoApply = cfg.get<boolean>('autoApply', false)
if (autoApply) {
  // Wait for proxy to be ready
  await new Promise(resolve => setTimeout(resolve, 1000))
  await vscode.commands.executeCommand('claudeThrone.applyToClaudeCode')
}
```

**After**:
```typescript
// ALWAYS apply settings to Claude Code when proxy starts
// (The autoApply flag only controls whether we revert on stop)
this.log.appendLine(`[handleStartProxy] Applying proxy settings to Claude Code...`)
// Wait for proxy to be ready
await new Promise(resolve => setTimeout(resolve, 1000))
await vscode.commands.executeCommand('claudeThrone.applyToClaudeCode')
```

## What `autoApply` Now Controls

**`autoApply: false` (default)**:
- ✅ Settings applied when proxy starts
- ❌ Settings NOT reverted when proxy stops (manual cleanup needed)

**`autoApply: true`**:
- ✅ Settings applied when proxy starts
- ✅ Settings automatically reverted when proxy stops

Most users should leave `autoApply` at the default (`false`) and manually run "Claude Throne: Revert Apply" when needed.

## Why This Took So Long to Find

The confusion came from the version timeline:

- **v1.4.13**: Worked IF you manually re-selected models before starting
  - Selecting models triggered `saveModels` which applied settings
  - So it worked, but required manual re-selection every time

- **v1.4.14**: Fixed model persistence but broke functionality
  - Models now persisted (good)
  - But settings stopped being applied because no manual re-selection (bad)
  - `autoApply` was `false`, so `applyToClaudeCode` never ran

- **v1.4.15**: Removed timeouts (correct) but didn't fix apply issue
  - Still had the same problem - settings not being applied
  - Same "Unable to connect" error

- **v1.4.16**: Fixed the apply issue
  - Settings now applied on every proxy start
  - Should work correctly

## Expected Behavior After Fix

1. User selects models once (saved to VS Code config)
2. User clicks "Start Proxy"
3. Settings automatically applied to `.claude/settings.json`
4. Requests work through proxy
5. User clicks "Stop Proxy"
6. Settings remain (unless `autoApply: true`)
7. User clicks "Start Proxy" again
8. Settings automatically re-applied
9. Everything works

## Testing Instructions

1. **Install v1.4.16**:
```bash
code --install-extension extensions/claude-throne/claude-throne-1.4.16.vsix
```

2. **Verify settings are empty** (if proxy is stopped):
```bash
cat .claude/settings.json
# Should show Anthropic defaults or be missing
```

3. **Start proxy from extension**

4. **Check settings were applied**:
```bash
cat .claude/settings.json
# Should now show:
# - ANTHROPIC_BASE_URL: http://127.0.0.1:3616
# - Your selected OpenRouter models
```

5. **Test a request**:
Ask Claude Code a question - should work through proxy now!

## Breaking Changes

None - this is a bug fix that makes things work as originally intended.

## Migration Notes

### For Users on v1.4.13-v1.4.15:
- No action needed
- Proxy will now work without manual model re-selection
- Settings will be applied automatically on start

### If You Had `autoApply: true`:
- Behavior unchanged - settings still auto-applied and auto-reverted
- This fix helps users who had `autoApply: false` or unset

## Files Modified

1. `extensions/claude-throne/src/views/PanelViewProvider.ts` - Always apply settings on start
2. `extensions/claude-throne/package.json` - Version bump to 1.4.16

## Version History

- v1.4.13: Worked with manual model re-selection
- v1.4.14: Fixed model persistence but broke apply
- v1.4.15: Removed timeouts (correct but didn't fix apply)
- v1.4.16: **Fixed settings apply** (this release)

## Related Issues

This fix works together with:
- v1.4.14: Model persistence fix
- v1.4.15: Timeout removal for reasoning models

All three are needed for full functionality.

## Installation

```bash
code --install-extension extensions/claude-throne/claude-throne-1.4.16.vsix
```

Your proxy should now work without the "Unable to connect" errors! 🎉
