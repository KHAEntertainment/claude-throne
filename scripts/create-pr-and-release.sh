#!/bin/bash
set -e

cd "$(dirname "$0")/.."

# Get current branch
BRANCH=$(git rev-parse --abbrev-ref HEAD)
echo "Current branch: $BRANCH"

# Commit version bump if not already committed
if git diff --quiet extensions/claude-throne/package.json; then
    echo "Version bump already committed"
else
    echo "Committing version bump..."
    git add extensions/claude-throne/package.json
    git commit -m "chore: bump version to 1.5.45"
fi

# Force push branch
echo "Force pushing branch to origin..."
git push origin "$BRANCH" --force

# Create PR
echo "Creating pull request..."
gh pr create \
    --base main \
    --head "$BRANCH" \
    --title "feat: Schema alignment, sequence token consistency, and model-fetch timeout cap (v1.5.45)" \
    --body "## Summary

This PR implements three critical improvements to ensure schema consistency, proper race condition handling, and improved timeout behavior for model fetching.

## Changes

### Comment 1: Root-level schemas aligned with extension schemas
- **Updated \`ErrorMessageSchema\`** to require structured payload (removed union with plain string)
- **Updated \`SaveModelsMessageSchema\`** to require \`completion\` instead of legacy \`coding\` key
- **Updated tests** in \`tests/contract.test.js\` to match new schema requirements

### Comment 2: Sequence token included consistently on cached model responses
- **Updated \`handleListModels()\`** to use \`sequenceToken\` instead of \`requestToken\` in:
  - Cache response path
  - Custom-provider short-circuit paths (empty URL and Anthropic endpoint)
- **Updated \`postModels()\`** to generate and include latest sequence token
- **Updated \`handleUpdateProvider()\`** to include sequence token when sending immediate empty lists after provider switch

### Comment 3: Total model-fetch duration capped
- **Added overall budget tracking** (50 seconds, adjustable 45-60s) in \`Models.ts\`
- **Modified \`fetchModelsWithRetry()\`** to:
  - Track start time and elapsed duration
  - Check budget before each retry attempt
  - Abort additional attempts when budget exceeded
  - Surface explicit \`timeout\` classification when budget exhausted
- **Updated error handling** in \`PanelViewProvider.ts\` to recognize and preserve \`timeout\` classification from \`Models.ts\`

## Testing

- All schema changes validated against extension schemas
- Sequence token validation ensures race condition protection
- Timeout budget prevents indefinite waits on repeated timeouts

## Version

Bumped to **v1.5.45** for release."

# Create release
echo "Creating GitHub release..."
gh release create v1.5.45 \
    --title "v1.5.45 - Schema Alignment & Timeout Improvements" \
    --notes "## Changes

- **Schema Alignment**: Root-level schemas now match extension schemas (structured error payloads, completion key requirement)
- **Sequence Token Consistency**: All cached model responses include sequence tokens for proper race condition protection
- **Timeout Cap**: Model fetching now has a 50-second overall budget with explicit timeout classification

## Files Changed
- \`src/schemas/messages.ts\` - Schema alignment
- \`extensions/claude-throne/src/schemas/messages.ts\` - Extension schema updates
- \`extensions/claude-throne/src/services/Models.ts\` - Timeout budget implementation
- \`extensions/claude-throne/src/views/PanelViewProvider.ts\` - Sequence token consistency
- \`tests/contract.test.js\` - Updated test expectations" \
    extensions/claude-throne/claude-throne-1.5.45.vsix

echo "✅ PR and release created successfully!"

