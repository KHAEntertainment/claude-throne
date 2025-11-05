# Thronekeeper - GitHub Copilot Instructions

## Project Overview

Thronekeeper is a universal AI model routing proxy for Claude Code and other Anthropic-compatible clients. It provides intelligent routing to OpenAI-compatible providers while maintaining the Anthropic-style API surface.

**Key Components:**
- **Core Proxy Server** (`index.js`): Fastify-based server that routes Anthropic API requests to OpenAI-compatible providers
- **VS Code Extension** (`extensions/claude-throne/`): Modern React webview for configuration and management
- **Python Backend** (`backends/python/ct_secretsd/`): Optional secure credential storage service
- **Transformer System** (`transformers.js`, `transformers/`): Model-specific request/response adaptations

## Architecture & Design Principles

### Provider System
- **Multi-Provider Support**: OpenRouter, OpenAI, Together AI, Deepseek, GLM, and custom endpoints
- **Anthropic-Native Direct Connect**: Deepseek and GLM bypass the proxy and connect directly
- **Smart Provider Detection**: Automatic endpoint kind inference with override support via `CUSTOM_ENDPOINT_OVERRIDES`
- **Three-Model Mode**: Separate reasoning, completion, and value models for optimal performance

### Transformer Pipeline
The transformer system adapts requests and responses for model-specific requirements:
- **Request Pipeline**: Applied in specified order (modifies tools, max_tokens, etc.)
- **Response Pipeline**: Applied in reverse order (processes reasoning, tool calls, etc.)
- **Built-in Transformers**: `tooluse`, `enhancetool`, `reasoning`, `maxtoken`
- **Configuration**: Per-model rules in `models-capabilities.json` with regex pattern matching

### Guarded Areas (Constitution Enforced)
These areas have strict invariants defined in `CONSTITUTION.md`:
- `area:model-selection` - Model selection UI, combos, hydration
- `area:provider` - Provider configuration, detection, switching
- `area:proxy` - Proxy server, routing, transformation
- `area:webview` - Webview UI, rendering, state management
- `area:config` - VS Code settings, persistence, migration

**Before changing guarded files**, you MUST:
1. Read `CONSTITUTION.md` invariants for the specific area
2. Validate message/config contracts against schemas in `extensions/claude-throne/src/schemas/`
3. Verify provider map structure: `{ reasoning, completion, value }`
4. Ensure no duplicate event listeners
5. Test Start/Stop hydration sequence

## Development Workflow

### Project Structure
- **Entry Point**: `index.js` (ESM) - Exposes Fastify server and CLI (`anthropic-proxy`)
- **No `src/` directory**: Keep modules in root
- **Configuration**: Environment variables only (no config files)
- **Tests**: Located in `tests/` directory

### Build, Test, and Run Commands
```bash
# Run locally
npm start
# or with API key
OPENROUTER_API_KEY=... PORT=3000 npm start

# Run tests
npm test  # Vitest with single worker for consistency

# Run single test
npx vitest run tests/messages.stream.test.js

# Enable debug logs
DEBUG=1 npm start

# Smoke test (non-streaming)
curl -s http://localhost:3000/v1/messages \
  -H 'Content-Type: application/json' \
  -d '{"messages":[{"role":"user","content":"Say hi"}],"stream":false}'
```

### Testing Guidelines
- **Framework**: Vitest with supertest for HTTP integration tests
- **Location**: Place tests in `tests/` directory
- **Naming**: `<feature>.test.js` grouped by functionality
- **Minimum Coverage**: Exercise `/v1/messages` for `stream: true/false`, tool calls, and error paths
- **Run Command**: `npm test` (uses single worker for consistency)

### Code Style & Conventions
- **Language**: Node.js ESM - prefer `import`/`export`, `const`/`let`, async/await
- **Indentation**: 2 spaces
- **Functions**: Keep small and concise
- **Environment Variables**: UPPER_SNAKE_CASE (e.g., `OPENROUTER_API_KEY`, `ANTHROPIC_PROXY_BASE_URL`)
- **Logging**: Use Fastify's logger; gate verbose output behind `DEBUG` flag
- **Error Handling**: Use try/catch with async/await; return proper HTTP status codes
- **No Linting**: No lint/format enforcement currently configured

### Commit & PR Guidelines
- **Commits**: Use imperative subject (e.g., "proxy: map finish reasons")
- **Branch Names**: `feat/<scope>`, `fix/<scope>`, `chore/<scope>`
- **PRs**: Include summary, rationale, logs/screenshots, steps to reproduce, env var changes, and linked issues
- **Keep PRs Small**: Focus on single concern or feature

## Key Documentation References

### Required Reading
- **`AGENTS.md`**: Complete repository guidelines, work tracking with Beads, planning discipline, execution checklists
- **`CONSTITUTION.md`**: Invariants and requirements for guarded areas - MUST read before modifying guarded files
- **`README.md`**: User-facing documentation, features, installation, usage examples
- **`docs/Claude-Throne-PRD.md`**: Product requirements and design decisions (for non-trivial work)

### Task Tracking with Beads
This project uses Beads (`bd`) for work tracking:
```bash
# Find ready work
bd ready --json

# Claim a task
bd update <id> --status in_progress --json

# Create new issue
bd create

# Link dependencies
bd dep add <new-id> <parent-id> --type blocks/discovered-from

# Complete work
bd close <id> --reason "Implemented" --json

# Always export before committing
bd export -o .beads/issues.jsonl
```

**Important**: Use `bd` for task tracking, NOT Markdown TODO lists. Always use `--json` flag for programmatic output.

## Security & Best Practices

### Security Guidelines
- **Never commit secrets**: Use environment variables; prefer local `.env` but don't commit it
- **No request body logging**: Avoid logging request bodies with secrets; keep `DEBUG` off in production
- **Provider-specific auth**: Default backend is `openrouter.ai`; if `ANTHROPIC_PROXY_BASE_URL` is set, `OPENROUTER_API_KEY` isn't required
- **Secure credential storage**: VS Code extension integrates with SecretStorage API and optional Python backend

### Configuration Tips
- **Endpoint Overrides**: Use `CUSTOM_ENDPOINT_OVERRIDES` for per-URL configuration when automatic detection is insufficient
  ```json
  {
    "https://api.example.com": "openai",
    "https://custom-anthropic.com": "anthropic"
  }
  ```
- **VS Code Setting**: `claudeThrone.customEndpointOverrides` serializes to `CUSTOM_ENDPOINT_OVERRIDES` env var

## Working with Guarded Areas

When modifying files in guarded areas, follow this checklist:

### Pre-Code Validation
- [ ] Read Constitution.md invariants for target area
- [ ] Run context search for relevant decisions
- [ ] Validate schemas for affected message/config contracts
- [ ] Identify test requirements and coverage gaps

### Implementation Checks
- [ ] Provider map uses canonical keys: `{ reasoning, completion, value }`
- [ ] Storage operations use 'completion' key (Note: 'coding' was deprecated in favor of 'completion')
- [ ] Model loading includes sequence token validation
- [ ] Event listeners are not duplicated (check cleanup)
- [ ] Filter input is throttled/debounced

### Testing Requirements
- [ ] Unit tests pass: `npm test`
- [ ] VS Code extension tests pass
- [ ] Provider switch isolation verified
- [ ] Start/Stop hydration works correctly
- [ ] Settings.json reflects active provider
- [ ] No duplicate event listeners (log/devtool audit)

### Manual Smoke Test
- [ ] Switch providers (OpenRouter ↔ GLM ↔ custom)
- [ ] Confirm model list differs per provider
- [ ] Select models, Start/Stop proxy
- [ ] Verify settings.json shows active provider models
- [ ] Test filter input rapid typing (no flicker)

## Common Tasks & Patterns

### Adding a New Transformer
1. Create transformer file in `transformers/` directory
2. Export request and response handlers
3. Add configuration to `models-capabilities.json`
4. Add tests in `tests/transformers.test.js`
5. Document in README.md transformer section

### Adding Provider Support
1. Update provider detection in `key-resolver.js`
2. Add provider-specific auth handling
3. Update VS Code extension UI in `extensions/claude-throne/`
4. Add tests for provider isolation
5. Update documentation

### Debugging Tips
- Enable debug logging: `DEBUG=1 npm start`
- Use `/v1/debug/echo` endpoint for request inspection
- Check transformer application in logs
- Verify provider detection with `inferEndpointKind()`
- Test with curl for non-streaming requests

## API & Endpoints

### Main Endpoints
- `POST /v1/messages` - Anthropic-style messages endpoint (relays to OpenAI-compatible `/chat/completions`)
- `POST /v1/debug/echo` - Debug endpoint for request inspection

### Streaming
- Uses Server-Sent Events (SSE)
- Verify event order: `message_start`, `content_block_*`, `message_stop`
- Test both streaming and non-streaming modes

## Additional Resources

### External MCP Knowledge Tools
- **Context7**: RAG docs search for libraries/frameworks/SDKs
  - Use `context7__resolve-library-id` → `context7__get-library-docs`
- **Git-MCP**: Pull up-to-date documentation from GitHub repositories
  - Use `git-mcp__fetch_docs_documentation` and `git-mcp__search_docs_documentation`

### Contribution Guidelines
- Do not commit VSIX files (build artifacts)
- Do not commit large binaries (>1MB)
- CI pipeline will reject PRs with `.vsix` files or large binaries
- Always run tests before committing
- Update documentation for user-facing changes

## Questions & Support

For questions or issues:
1. Check existing documentation in `docs/` directory
2. Review `AGENTS.md` for workflow guidance
3. Check `CONSTITUTION.md` for guarded area requirements
4. Open an issue on [GitHub repository](https://github.com/KHAEntertainment/thronekeeper)
