## Description

<!-- Provide a clear and concise description of your changes -->

## Type of Change

- [ ] Bug fix (non-breaking change which fixes an issue)
- [ ] New feature (non-breaking change which adds functionality)
- [ ] Breaking change (fix or feature that would cause existing functionality to not work as expected)
- [ ] Refactoring (no functional changes)
- [ ] Documentation update
- [ ] Test coverage improvement

## Constitution Compliance

### Guarded Files Changed

- [ ] `webview/main.js`
- [ ] `PanelViewProvider.ts`
- [ ] `AnthropicApply.ts`
- [ ] None (skip to next section)

### Invariants Touched

<!-- Check all that apply -->

- [ ] Provider map structure (`{ reasoning, completion, value }`)
- [ ] Start/Stop hydration sequence
- [ ] Model loading rules (token validation, provider matching)
- [ ] Event listener discipline
- [ ] Configuration persistence
- [ ] None

### Schema Updates

- [ ] Yes - updated schemas at `extensions/claude-throne/src/schemas/`
  - [ ] `messages.ts`
  - [ ] `config.ts`
- [ ] No

### Tests Added/Updated

- [ ] Unit tests (provider isolation, token validation, key normalization)
- [ ] Integration tests (Start/Stop hydration, settings.json reflection)
- [ ] Contract tests (message/config schemas)
- [ ] Manual smoke test results included below
- [ ] No tests needed (documentation/comments only)

## Area Labels

<!-- Apply appropriate labels to your PR -->

**Required:** Choose at least one area:

- `area:model-selection` - Model selection UI, combos, hydration
- `area:provider` - Provider configuration, detection, switching
- `area:proxy` - Proxy server, routing, transformation
- `area:webview` - Webview UI, rendering, state management
- `area:config` - VS Code settings, persistence, migration

## Manual Smoke Test Results

<!-- For changes to guarded areas, provide manual testing evidence -->

### Provider Switching Behavior

```
<!-- Example:
1. Started with OpenRouter, selected sonnet + haiku
2. Switched to GLM, model list refreshed correctly
3. Switched back to OpenRouter, selections persisted
-->
```

### Model Selection Persistence

```
<!-- Example:
1. Selected models for OpenRouter
2. Started proxy
3. Verified settings.json shows correct models
4. Stopped proxy, verified revert
-->
```

### Settings.json Content After Start/Stop

```json
<!-- Paste relevant settings.json excerpt showing:
- anthropic.customHeaders
- reasoningModel, completionModel, valueModel
-->
```

### Filter Input Performance

```
<!-- If webview changes:
- Typed rapidly in search box
- Confirmed: no flicker, smooth filtering
- Confirmed: no duplicate event listeners (check console)
-->
```

## Test Coverage

- [ ] `npm test` passes
- [ ] Extension tests pass (`cd extensions/claude-throne && npm test`)
- [ ] Manual verification completed (for guarded areas)
- [ ] Smoke test passes (`bash scripts/smoke.sh`)

## Checklist

- [ ] My code follows the style guidelines of this project
- [ ] I have performed a self-review of my code
- [ ] I have commented my code, particularly in hard-to-understand areas
- [ ] I have made corresponding changes to the documentation
- [ ] My changes generate no new warnings
- [ ] I have added tests that prove my fix is effective or that my feature works
- [ ] New and existing unit tests pass locally with my changes
- [ ] Any dependent changes have been merged and published

## Related Issues

<!-- Link related issues: Fixes #123, Relates to #456 -->

## Additional Context

<!-- Add any other context, screenshots, or information about the PR here -->

---

**Constitution Reference**: See `CONSTITUTION.md` for invariants and guarded area requirements.
**Coding Guidelines**: See `CLAUDE.md` for development workflows and testing requirements.
