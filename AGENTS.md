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

## Security & Configuration Tips
- Never commit secrets. Use env vars; prefer local `.env` but don’t commit it.
- Default backend is `openrouter.ai`; if `ANTHROPIC_PROXY_BASE_URL` is set, `OPENROUTER_API_KEY` isn’t required.
- Avoid logging request bodies with secrets; keep `DEBUG` off in production.

## Agent-Specific Notes
- Endpoint: `POST /v1/messages` (Anthropic-style) → relays to OpenAI-compatible `/chat/completions`.
- Streaming uses SSE; verify event order: `message_start`, `content_block_*`, `message_stop`.
 - Memory: Persistent via the core-memory MCP tool; follow `MemorySystem.md` to search memory first and store key decisions after tasks.

## Planning & Docs
- Read `MemorySystem.md` first; it defines agent rules, priorities, and guardrails for this repo.
- Before non-trivial work, read `docs/Claude-Throne-PRD.md` and `Claude-Throne-Prompt.md`.
- Maintain a live plan with the `update_plan` tool (one in-progress step at a time).

## External MCP Knowledge Tools
- Context7 (RAG docs search): Use whenever working with a library, framework, SDK, or API you’re not explicitly familiar with.
  - Resolve first, then fetch: `context7__resolve-library-id` → `context7__get-library-docs`.
  - Prefer exact matches, high trust score, and high snippet coverage; set a focused `topic` when helpful (e.g., `hooks`, `routing`, `streaming`).
  - If multiple plausible matches exist, request clarification or proceed with the best match and note assumptions in the plan.
- Git‑MCP (live GitHub docs/code): Use to pull up‑to‑date documentation or code from public GitHub repositories.
  - Prefer documentation first; only pull code when necessary to answer implementation questions.
  - For repos with dedicated doc helpers (e.g., `davila7/docs`), use `git-mcp__fetch_docs_documentation` and `git-mcp__search_docs_documentation`.
  - For other URLs or assets, use `git-mcp__fetch_generic_url_content` with the canonical link (README, docs pages, or raw content).
- Workflow policy: Before implementing unfamiliar features, consult Context7; when integrating with OSS projects, fetch the latest repo docs via Git‑MCP. Capture key learnings and decisions in core‑memory after tasks.
