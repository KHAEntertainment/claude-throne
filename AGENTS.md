# Repository Guidelines

## Project Structure & Module Organization
- Entry point: `index.js` (ESM). Exposes a Fastify server and CLI (`anthropic-proxy`).
- No `src/` directory; keep modules in root. Configuration is via environment variables only.
- Tests live in `tests/` when present. No assets folder.

## Work Tracking with Beads

We use Beads (`bd`) for all work and task tracking. Before starting work:

1. **Find ready work**: Run `bd ready --json` to see unblocked tasks
2. **Claim your task**: `bd update <id> --status in_progress --json`
3. **Discover new issues**: Create them with `bd create` and link with `bd dep add`
4. **Complete work**: `bd close <id> --reason "Implemented" --json`
5. **Always export**: `bd export -o .beads/issues.jsonl` before committing

**Key Rules:**
- Always use `--json` flag for programmatic output
- Use `bd` for task tracking, NOT Markdown TODO lists
- Track dependencies with `bd dep add <new-id> <parent-id> --type blocks/discovered-from`
- Run `bd quickstart` if you need help

**Quick Setup (if not initialized):**
```bash
bd init --prefix coding-agent
```

## Planning Discipline (Constitution Enforced)

### Context Search First
Before any change to guarded areas (`area:model-selection`, `area:provider`, `area:proxy`, `area:webview`, `area:config`):
1. Run context search for relevant decisions and patterns
2. Read CONSTITUTION.md invariants for the specific area
3. Cite relevant invariants in your plan

### Schema Validation
- Validate message/config contracts against schemas in `extensions/claude-throne/src/schemas/`
- Check payload completeness for webview ↔ extension communication
- Verify provider map structure: `{ reasoning, completion, value }`

### Test Requirements
- Propose test deltas for any invariant changes
- Include unit tests for provider isolation, token validation, key normalization
- Add integration tests for Start/Stop hydration and settings.json reflection
- Ensure contract tests for message schemas

### Area Labels and PR Planning
- Apply appropriate area labels: `area:model-selection | area:provider | area:proxy | area:webview | area:config`
- Reference Constitution.md invariants in PR description
- Document which invariants are touched by the change

### Memory and Persistence
- Record key decisions (schema changes, invariant modifications) to core memory
- Link decisions to PR/Bead ID for traceability
- Note any backward compatibility requirements

## Build, Test, and Development Commands
- Run locally: `npm start` or `node index.js`
- With API key: `OPENROUTER_API_KEY=... PORT=3000 npm start`
- CLI (installed or via npx): `OPENROUTER_API_KEY=... npx anthropic-proxy`
- Run tests: `npm test` (Vitest with single worker)
- Run single test: `npx vitest run tests/messages.stream.test.js`
- Smoke test (non‑streaming):
  ```bash
  curl -s http://localhost:3000/v1/messages \
    -H 'Content-Type: application/json' \
    -d '{"messages":[{"role":"user","content":"Say hi"}],"stream":false}'
  ```
- Enable debug logs: `DEBUG=1 npm start`

## Execution Checklist (Agent and Human)

> **Note**: If a checklist item is not applicable to your change, document why in the PR description (e.g., "N/A: Documentation-only change").

### Pre-Code Validation
- [ ] Read Constitution.md invariants for target area
- [ ] Run context search for relevant decisions
- [ ] Validate schemas for affected message/config contracts
- [ ] Identify test requirements and coverage gaps

### Implementation Checks
- [ ] Provider map uses canonical keys: `{ reasoning, completion, value }`
- [ ] Storage operations use 'completion' key (never 'coding')
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

### Pre-PR Validation
- [ ] Add/update tests for guarded file changes
- [ ] Update schemas if contracts changed
- [ ] Apply appropriate area labels
- [ ] Document invariant impacts in PR description
- [ ] Link to core memory decisions

## Coding Style & Naming Conventions
- Language: Node.js ESM; prefer `import`/`export`, `const`/`let`, async/await.
- Indentation: 2 spaces; keep functions small and lines concise.
- Env vars: UPPER_SNAKE_CASE (e.g., `OPENROUTER_API_KEY`, `ANTHROPIC_PROXY_BASE_URL`).
- Logging: use Fastify's logger; gate verbose output behind `DEBUG`.
- Error handling: use try/catch with async/await; return proper HTTP status codes.
- No lint/format enforcement currently configured.

## Testing Guidelines
- Use Vitest with supertest for HTTP integration tests.
- Place tests in `tests/`; name as `<feature>.test.js` grouped by functionality.
- Minimum coverage: exercise `/v1/messages` for `stream: true/false`, tool calls, and error paths.
- Run tests: `npm test` (uses Vitest with single worker for consistency)
- Run single test: `npx vitest run tests/<specific-test>.js`

## Commit & Pull Request Guidelines
- Commits: imperative subject (e.g., "proxy: map finish reasons").
- Branch names: `feat/<scope>`, `fix/<scope>`, `chore/<scope>`.
- PRs: include summary, rationale, logs/screenshots if relevant, steps to reproduce/verify, env var changes, and linked issues. Keep PRs small and focused.

### PR Template for Guarded Areas
```markdown
**Changed areas:**
- [ ] webview/main.js
- [ ] PanelViewProvider.ts  
- [ ] AnthropicApply.ts

**Invariants touched:**
- [ ] Provider map structure
- [ ] Start/Stop hydration sequence
- [ ] Model loading rules
- [ ] Event listener discipline
- [ ] Configuration persistence

**Schema updated:**
- [ ] yes (link: ____)
- [ ] no

**Tests added/updated:**
- [ ] unit (provider isolation, token validation, key normalization)
- [ ] integration (Start/Stop hydration, settings reflection)
- [ ] contract (message/config schemas)

**Manual smoke results:**
[Attach logs/screenshots]

**Area labels applied:**
area:model-selection | area:provider | area:proxy | area:webview | area:config
```

## Security & Configuration Tips
- Never commit secrets. Use env vars; prefer local `.env` but don't commit it.
- Default backend is `openrouter.ai`; if `ANTHROPIC_PROXY_BASE_URL` is set, `OPENROUTER_API_KEY` isn't required.
- Avoid logging request bodies with secrets; keep `DEBUG` off in production.

## Agent-Specific Notes
- Endpoint: `POST /v1/messages` (Anthropic-style) → relays to OpenAI-compatible `/chat/completions`.
- Streaming uses SSE; verify event order: `message_start`, `content_block_*`, `message_stop`.
 - Memory: Persistent via the core-memory MCP tool; follow `MemorySystem.md` to search memory first and store key decisions after tasks.

## Planning & Docs
- Read `MemorySystem.md` first; it defines agent rules, priorities, and guardrails for this repo.
- Read `CONSTITUTION.md` before any changes to guarded areas
- Before non-trivial work, read `docs/Claude-Throne-PRD.md` and `Claude-Throne-Prompt.md`.
- Maintain a live plan with the `update_plan` tool (one in-progress step at a time).

## External MCP Knowledge Tools
- Context7 (RAG docs search): Use whenever working with a library, framework, SDK, or API you're not explicitly familiar with.
  - Resolve first, then fetch: `context7__resolve-library-id` → `context7__get-library-docs`.
  - Prefer exact matches, high trust score, and high snippet coverage; set a focused `topic` when helpful (e.g., `hooks`, `routing`, `streaming`).
  - If multiple plausible matches exist, request clarification or proceed with the best match and note assumptions in your plan.
- Git‑MCP (live GitHub docs/code): Use to pull up‑to‑date documentation or code from public GitHub repositories.
  - Prefer documentation first; only pull code when necessary to answer implementation questions.
  - For repos with dedicated doc helpers (e.g., `davila7/docs`), use `git-mcp__fetch_docs_documentation` and `git-mcp__search_docs_documentation`.
  - For other URLs or assets, use `git-mcp__fetch_generic_url_content` with the canonical link (README, docs pages, or raw content).
- Workflow policy: Before implementing unfamiliar features, consult Context7; when integrating with OSS projects, fetch the latest repo docs via Git‑MCP. Capture key learnings and decisions in core‑memory after tasks.

## Endpoint-Kind Overrides Configuration

The proxy supports explicit endpoint-kind overrides via the `CUSTOM_ENDPOINT_OVERRIDES` environment variable. This allows per-URL configuration when automatic detection is insufficient.

### Structure

`CUSTOM_ENDPOINT_OVERRIDES` is a JSON string containing a map of base URLs to endpoint kinds:

```json
{
  "https://api.example.com": "openai",
  "https://custom-anthropic.com": "anthropic"
}
```

### Endpoint Kinds

- `"openai"`: OpenAI-compatible endpoint (uses `/chat/completions`, `Authorization: Bearer` header)
- `"anthropic"`: Anthropic-native endpoint (uses `/v1/messages`, `x-api-key` header)

### VS Code Setting

The extension exposes this via `claudeThrone.customEndpointOverrides` setting (object type). When set, the extension serializes it to `CUSTOM_ENDPOINT_OVERRIDES` environment variable when starting the proxy.

**Example VS Code settings.json:**
```json
{
  "claudeThrone.customEndpointOverrides": {
    "https://api.example.com": "openai",
    "https://custom-anthropic.com": "anthropic"
  }
}
```

### Implementation Details

- **Extension → Proxy**: `ProxyManager.ts` reads `customEndpointOverrides` from VS Code config and serializes to `CUSTOM_ENDPOINT_OVERRIDES` env var
- **Proxy**: `index.js` reads `CUSTOM_ENDPOINT_OVERRIDES` and passes to `inferEndpointKind()` in `key-resolver.js`
- **Override Priority**: Explicit overrides take precedence over automatic detection based on provider or URL patterns