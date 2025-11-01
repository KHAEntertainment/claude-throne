# Phase 6 Handoff: Test Suite & CI Infrastructure

## Status: READY FOR DELEGATION

**Phases 1-5 Complete** (83% of implementation plan done)
- All core guardrails implemented and tested
- Root cause bugs fixed
- 57 new tests created, all passing
- Zero regressions

## Phase 6 Scope

Implement comprehensive test infrastructure and CI/CD automation to prevent future regressions.

## What Needs to Be Done

### 1. Additional Unit Tests (`tests/webview-unit.test.js`)

Create comprehensive tests for all critical webview functions:

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

**Test Coverage Targets**:
- `handleModelsLoaded` - provider/token validation
- `onProviderChange` - state isolation
- `setModelFromList` - key normalization
- `renderModelList` - event delegation
- `handleConfigLoaded` - fallback hydration

### 2. VS Code Integration Tests (`extensions/claude-throne/tests/integration.test.ts`)

Test real extension behavior with VS Code APIs:

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

**Setup Requirements**:
- Use `@vscode/test-electron` for real VS Code environment
- Mock workspace with test configuration files
- Verify actual settings.json and .claude/settings.json changes

### 3. GitHub Actions CI Workflow (`.github/workflows/regression.yml`)

```yaml
name: Regression Tests

on:
  pull_request:
    paths:
      - 'extensions/claude-throne/webview/main.js'
      - 'extensions/claude-throne/src/views/PanelViewProvider.ts'
      - 'extensions/claude-throne/src/services/AnthropicApply.ts'
      - 'tests/**'
      - 'extensions/claude-throne/tests/**'

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm install
      - run: npm test
      - run: cd extensions/claude-throne && npm install && npm test
      
  label-check:
    runs-on: ubuntu-latest
    steps:
      - name: Check PR has required labels
        uses: actions/github-script@v6
        with:
          script: |
            const labels = context.payload.pull_request.labels.map(l => l.name)
            const areaLabels = labels.filter(l => l.startsWith('area:'))
            
            if (areaLabels.length === 0) {
              core.setFailed('PR must have at least one area: label')
            }
```

### 4. PR Template (`.github/pull_request_template.md`)

```markdown
## Changes
- [ ] webview/main.js
- [ ] PanelViewProvider.ts
- [ ] AnthropicApply.ts

## Constitution Compliance
**Invariants touched:**
- [ ] Provider map structure
- [ ] Start/Stop hydration sequence
- [ ] Model loading rules
- [ ] Event listener discipline
- [ ] Configuration persistence

**Schema updated:**
- [ ] yes (link: schemas/*)
- [ ] no

**Tests added/updated:**
- [ ] unit tests
- [ ] integration tests
- [ ] contract tests

**Area labels:** (select all that apply)
- [ ] `area:model-selection`
- [ ] `area:provider`
- [ ] `area:proxy`
- [ ] `area:webview`
- [ ] `area:config`

## Manual Smoke Test
[Describe manual testing performed]

## Test Results
\```bash
npm test
# paste output
\```
```

### 5. Test Documentation (`tests/README.md`)

Document test patterns and guidelines:

```markdown
# Testing Guide

## Test Structure
- `tests/contract.test.js` - Message schema validation
- `tests/webview-race-protection.test.js` - Phase 2 race conditions
- `tests/phase4-hydration.test.js` - Phase 4 hydration logic
- `tests/phase5-ui-optimization.test.js` - Phase 5 debouncing/delegation
- `tests/webview-unit.test.js` - Comprehensive webview tests
- `extensions/claude-throne/tests/integration.test.ts` - VS Code integration

## Running Tests
\```bash
# All tests
npm test

# Specific test file
npx vitest tests/contract.test.js

# Watch mode
npx vitest --watch

# Extension tests
cd extensions/claude-throne && npm test
\```

## Writing Tests

### Unit Tests
Use jsdom for DOM-based tests. Example:
\```javascript
import { JSDOM } from 'jsdom'

test('handleModelsLoaded validates provider', () => {
  const state = { provider: 'glm', currentRequestToken: 'token-2' }
  const payload = {
    provider: 'openrouter',
    models: [...],
    token: 'token-2'
  }
  
  // Should ignore cross-provider response
  expect(handleModelsLoaded(payload, state)).toBeUndefined()
})
\```

### Integration Tests
Use @vscode/test-electron. Example:
\```typescript
import * as vscode from 'vscode'
import { runTests } from '@vscode/test-electron'

describe('Provider Switching', () => {
  it('clears cache when switching', async () => {
    const cfg = vscode.workspace.getConfiguration('claudeThrone')
    await cfg.update('provider', 'openrouter')
    // ... verify behavior
  })
})
\```
```

## Existing Test Coverage (Phases 1-5)

✅ **57 tests already created**:
- 31 contract tests (message validation, key normalization)
- 13 race protection tests (token validation, provider isolation)
- 11 hydration tests (start/stop, provider switching)
- 10 UI optimization tests (debouncing, event delegation)

## Implementation Guide

### Step 1: Additional Unit Tests (1 day)
- Create `tests/webview-unit.test.js`
- Test all critical webview functions
- Achieve >80% coverage of webview/main.js critical paths

### Step 2: Integration Tests (1-2 days)
- Setup `@vscode/test-electron` in extension
- Create `extensions/claude-throne/tests/integration.test.ts`
- Test real VS Code environment behaviors
- Verify settings.json and .claude/settings.json changes

### Step 3: CI Workflow (0.5 day)
- Create `.github/workflows/regression.yml`
- Add test job with matrix (Node 16, 18, 20)
- Add label checking for PRs touching guarded files
- Test workflow on a test branch

### Step 4: Documentation (0.5 day)
- Create PR template
- Create tests/README.md with examples
- Update CLAUDE.md with test patterns
- Update CONSTITUTION.md with CI requirements

## Success Criteria

✅ All new tests pass  
✅ CI workflow runs successfully on test PR  
✅ PR template enforces Constitution checklist  
✅ Test documentation provides clear examples  
✅ Coverage >80% for critical paths  

## Resources

**Existing Files to Reference**:
- `CONSTITUTION.md` - Invariants and contracts
- `IMPLEMENTATION_PLAN.md` - Full 6-phase plan with Phase 1-5 notes
- `tests/contract.test.js` - Example contract tests
- `tests/webview-race-protection.test.js` - Example unit tests
- `extensions/claude-throne/tests/PanelViewProvider.test.ts` - Existing extension test

**Helpful Commands**:
```bash
# Run all tests
npm test

# Watch mode
npx vitest --watch

# Extension tests
cd extensions/claude-throne && npm test

# Check test coverage
npx vitest --coverage

# Lint
npm run lint
```

## Estimated Effort

- **Total**: 3-4 days
- **Unit Tests**: 1 day
- **Integration Tests**: 1-2 days
- **CI Setup**: 0.5 day
- **Documentation**: 0.5 day

## Notes

- All 4 core phases (1-5) are complete and tested
- Root cause bugs are fixed with Phase 4 hydration
- Phase 5 improves UI performance
- Phase 6 is "insurance" to prevent future regressions
- No changes to production code needed - only tests and CI

## Contact

For questions about the implementation, refer to:
- `IMPLEMENTATION_PLAN.md` - Complete phase notes
- `CONSTITUTION.md` - Architecture invariants
- Commits `bf39a39`, `ca6378c`, `bf37974`, `54f72e9`, `8a83884` - Phase 1-5 implementations

---

**Status**: Ready for sub-droid delegation  
**Risk Level**: Low (test-only changes)  
**Dependencies**: None (Phases 1-5 complete)
