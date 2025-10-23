# Version Tracking for Next Build

## Current Version: 1.5.0

**Status:** Has received **3 same-day fixes** (all labeled v1.5.0)

### Commits under v1.5.0:
1. `4f452f5` - Initial XML tool calling implementation
2. `d864abb` - Fix #1: Rewrite XML parser (character-by-character)
3. `39c48b6` - Fix #2: Conditional XML injection (model-aware)

All packaged as `claude-throne-1.5.0.vsix`

---

## ⚠️ NEXT BUILD MUST BE: v1.5.1

### Reason:
- Same-day fixes are acceptable under one version for internal testing
- But we've now built/packaged 3 times with "v1.5.0"
- Next change (any change) should bump to v1.5.1

### Files to Update for v1.5.1:
1. `extensions/claude-throne/package.json` - Change `"version": "1.5.0"` → `"version": "1.5.1"`
2. Create `FIXES-v1.5.1.md` (or rename if appropriate)
3. Update commit message to reference v1.5.1

### When to Use Each Version Bump:

**Patch (x.x.X):** Bug fixes, no new features
- Example: v1.5.0 → v1.5.1
- Use for: Fixing blank outputs, parsing errors, logging improvements

**Minor (x.X.x):** New features, backward compatible
- Example: v1.5.1 → v1.6.0
- Use for: Adding new tool support, new models, new capabilities

**Major (X.x.x):** Breaking changes
- Example: v1.6.0 → v2.0.0
- Use for: API changes, removing features, incompatible updates

---

## Checklist for Next Build:

- [ ] Update `package.json` version field
- [ ] Create/update FIXES documentation with new version number
- [ ] Update commit message with correct version
- [ ] Tag git commit with version: `git tag v1.5.1`
- [ ] Update README if needed
- [ ] Clear old .vsix files to avoid confusion

---

## Note to Future Builds:

The current v1.5.0 package is **stable and tested** with all 3 fixes included:
- Character-by-character XML parsing ✅
- Conditional XML injection ✅
- Model-aware tool mode selection ✅

Next version (v1.5.1 or higher) should start fresh with proper version tracking.
