# Claude‑Throne PRD and Task List

## 1. Overview
- Problem: Current anthropic-proxy skips auth for custom providers and requires complex env setup. No GUI, weak multi-provider ergonomics.
- Goal: Fix proxy auth/key resolution, add provider-aware headers, validate configuration up front, and deliver a VS Code extension with secure credential storage and model routing UX.
- Audience: Developers using Claude Code or Anthropic-style clients who want to route to OpenAI-compatible providers (OpenRouter, OpenAI, Together, Groq, or custom).

## 2. Objectives
- Fix custom provider API key handling and always send proper Authorization headers.
- Provide smart API key resolution driven by `ANTHROPIC_PROXY_BASE_URL` and provider hints.
- Maintain correct Anthropic-style streaming semantics (event order and payload shape).
- Ship a VS Code extension with GUI configuration, secure key storage, and proxy lifecycle management.
- Ensure robust tests for non-streaming and streaming paths, tools, and error conditions.

## 3. Scope
- In scope: Node proxy enhancements; configuration validation; provider-aware headers; tests; VS Code extension; Python backend for secure keyring storage and proxy orchestration; basic model suggestions; Hive branding.
- Out of scope: Non–OpenAI-compatible APIs; advanced telemetry/analytics; custom protocol transports; non-desktop editors.

## 4. Users & Stories
- As a dev, I can set a custom OpenAI-compatible base URL and the proxy authenticates correctly using the right key.
- As a dev, I can start the proxy from a VS Code UI with a selected provider, models, and port.
- As a dev, my API keys are stored securely and never logged; the UI can retrieve them for use without exposing plaintext.
- As a dev, streaming behaves identically to Anthropic expectations (`message_start`, `content_block_*`, `message_stop`).
- As a dev, I can quickly test multiple providers with a script and see useful validation errors if misconfigured.

## 5. Functional Requirements
- Proxy Server
  - Accepts Anthropic-style `POST /v1/messages` and relays to OpenAI-compatible `/v1/chat/completions`.
  - Always includes `Authorization: Bearer <key>` when a key is resolved (including custom providers).
  - Smart key resolver selects key based on URL/provider with fallbacks:
    - If custom URL: prefer `CUSTOM_API_KEY` or `API_KEY`; else provider-specific (OPENAI_API_KEY, TOGETHER_API_KEY, GROQ_API_KEY); fallback to `OPENROUTER_API_KEY`.
    - Default OpenRouter when no custom URL provided.
  - Provider-specific headers for OpenRouter (`HTTP-Referer`, `X-Title`).
  - Correct mapping of finish reasons (`tool_calls`→`tool_use`, `stop`→`end_turn`, `length`→`max_tokens`).
  - Streaming over SSE with correct event order (`message_start`, `ping`, `content_block_start`, `content_block_delta`, `content_block_stop`, `message_delta`, `message_stop`).
  - Tool calls: map to OpenAI `tool_calls` in request and back to Anthropic `tool_use`/`tool_result` in responses.
  - Config via env; `DEBUG=1` enables verbose logs; avoid logging secrets.

### Research Checkpoints (Context7 / Git‑MCP)
- Context7: Fastify v5 SSE patterns, Node 18 Web Streams, `eventsource-parser` usage, OpenAI Chat Completions tool_calls shape, Anthropic Messages event semantics.
- Git‑MCP: Fetch latest OpenRouter docs (headers, rate limits), OpenAI API examples for streaming/tool calls, Together/Groq compatibility notes. Use `git-mcp__fetch_generic_url_content` for official docs pages.

- VS Code Extension
  - Config panel for provider selection, custom URL, reasoning/execution models, port, debug, auto-start, popular model presets.
  - Start/stop proxy; show running status and last error.
  - Secure key storage via Python `keyring` (Keychain/DPAPI/libsecret) and retrieval for proxy env.
  - Basic model intelligence: curated suggestions/pairings; optional availability check.

### Research Checkpoints (Context7 / Git‑MCP)
- Context7: VS Code extension APIs (commands, webviews, SecretStorage vs. external keyring), React + Vite webview setup, Python `keyring` API and FastAPI patterns.
- Git‑MCP: Example VS Code extensions with webview + backend orchestration; `python-keyring` repo docs for backend specifics.

## 6. Non‑Functional Requirements
- Security: No secrets in logs; keys stored via OS keychain; HTTPS to providers; redact errors.
- Reliability: Graceful error mapping from provider to client; SSE robustness; timeouts with clear error.
- Compatibility: Node 18+ (global fetch / Web Streams); macOS/Windows/Linux; VS Code latest LTS.
- Performance: Minimal overhead; stream with low latency; avoid blocking operations on hot paths.

### Research Checkpoints
- Context7: Timeout/retry patterns in Fetch/Undici, Fastify error handling best practices, SSE back‑pressure handling.
- Git‑MCP: Provider‑specific limits/timeouts from official docs (OpenRouter, OpenAI, Together, Groq).

## 7. Architecture
- Node Fastify proxy (`index.js`) with a new `key-resolver.js` module to determine API key and provider.
- VS Code Extension (TypeScript) provides GUI; spawns Python FastAPI backend for secure key management and proxy orchestration.
- Python backend calls `npx anthropic-proxy` (or local CLI) with env composed from stored credentials and config.

### Research Checkpoints
- Context7: Process management patterns (Node child_process vs. execa), cross‑platform spawning from Python, FastAPI subprocess supervision.
- Git‑MCP: Reference implementations in OSS extensions/backends that manage local CLIs.

## 8. API & Event Semantics
- Request mapping: Anthropic-style messages → OpenAI-compatible `messages` and `tools` fields.
- Streaming: Maintain Anthropic event order; include `thinking_delta` when present; finalize with `message_delta` and `message_stop`.
- Error mapping: Pass provider `status` to client; body includes provider error string; redact keys.

### Research Checkpoints
- Context7: Anthropic Messages spec details for streaming and tool use; OpenAI Chat Completions streaming and function/tool call semantics.
- Git‑MCP: Pull latest examples from SDK repos (openai-node, community clients) to confirm field names and finish reason mappings.

## 9. Configuration
- Core env vars:
  - `ANTHROPIC_PROXY_BASE_URL` (custom provider URL, optional).
  - `OPENROUTER_API_KEY`, `OPENAI_API_KEY`, `TOGETHER_API_KEY`, `GROQ_API_KEY`, `CUSTOM_API_KEY`, `API_KEY`.
  - `REASONING_MODEL`, `COMPLETION_MODEL`, `PORT`, `DEBUG`.
- Resolution order: `CUSTOM_API_KEY`→`API_KEY`→provider-specific→`OPENROUTER_API_KEY`.

## 10. Dependencies & References
- Node: `fastify@^5.2.1` (present), Node 18+.
- Dev/Test: `vitest`, `supertest`, optional `eventsource-parser` for SSE assertions.
- VS Code: `yo` + `generator-code`, `@types/vscode`, `vsce`, React + Vite for webview.
- Python: `fastapi`, `uvicorn`, `keyring`, `psutil`, `pydantic` (or stdlib dataclasses), `requests`.
- Provider Docs: OpenRouter, OpenAI, Together AI, Groq; Anthropic Messages streaming semantics.
- MCP Knowledge Tools:
  - Context7 for up‑to‑date library/framework/API documentation and example usage.
  - Git‑MCP for pulling the latest public‑GitHub documentation or code when needed.

### Research Checkpoints
- Context7: Validate API surfaces for Fastify v5, VS Code extension API changes, Python keyring API.
- Git‑MCP: Track live provider docs changes; verify any breaking notes in SDK READMEs.

## 16. MCP Tools & Research Workflow
- Context7 (RAG docs search)
  - Resolve library ID: use `context7__resolve-library-id` with the package/repo name.
  - Fetch focused docs: call `context7__get-library-docs` with the resolved ID; set `topic` (e.g., `streaming`, `SSE`, `routing`) to limit scope.
  - Apply when: clarifying Fastify API nuances, SSE streaming patterns, VS Code extension APIs, or Python `keyring`/FastAPI usage.
  - Ambiguity: if multiple good matches, note the chosen ID and rationale in the plan.
- Git‑MCP (live GitHub docs/code)
  - Documentation first: retrieve README/guide pages from source repos using `git-mcp__fetch_generic_url_content`.
  - Repository docs: where supported (e.g., `davila7/docs`), use `git-mcp__fetch_docs_documentation` and `git-mcp__search_docs_documentation`.
  - Code only when necessary: pull specific files/snippets to answer concrete implementation questions (e.g., streaming examples), citing the path/commit when possible.
  - Apply when: reviewing provider‑specific examples, confirming event semantics, or validating adapter patterns.
- Governance
  - Incorporate Context7/Git‑MCP lookups as explicit plan steps before implementing unfamiliar features.
  - Record key decisions and references in core‑memory after completing a task (see `MemorySystem.md`).


## 11. Milestones & Tasks

### Week 1 — Core Proxy Enhancement
- [ ] Implement key resolver module (`getApiKey`, `getProviderFromUrl`, `validateConfiguration`).
- [ ] Import resolver in `index.js`; fail fast on invalid config.
- [ ] Always set `Authorization` header; add OpenRouter headers when applicable.
- [ ] Strengthen error handling and finish-reason mapping.
- [ ] Add tests: non-streaming, streaming, tool calls, error paths, missing key, provider headers.
- [ ] Add `scripts/test-providers.sh` to smoke test OpenRouter and a custom provider.
- [ ] Update `README.md` for new env behavior and examples.
- [ ] Package metadata: add The Hive branding while preserving CLI name.

Research Checklist
- [ ] Context7: Fastify SSE and `eventsource-parser` patterns for streaming.
- [ ] Context7: OpenAI tool_calls schema and finish reasons.
- [ ] Git‑MCP: Fetch latest OpenRouter headers guidance and limits.

Acceptance Criteria
- [x] Custom provider requests include `Authorization: Bearer <key>`.
- [x] `/v1/messages` works with `stream: false` and `true` and correct event order.
- [ ] Tool call mapping verified both directions.
- [x] Clear validation error when no usable key is found.

### Week 2 — VS Code Extension Foundation
- [ ] Scaffold extension (TypeScript) and basic React webview.
- [ ] Python FastAPI backend with routes: start/stop proxy, status, store/get credentials, list model suggestions.
- [ ] ProxyManager wires backend to spawn `npx anthropic-proxy` with env.
- [ ] CredentialManager stores/retrieves provider keys via `keyring`.
- [ ] Manual E2E: Start proxy from extension and send a test request.

Research Checklist
- [ ] Context7: VS Code webview/command APIs; SecretStorage vs. external key managers.
- [ ] Context7: Python `keyring` usage across macOS/Windows/Linux.
- [ ] Git‑MCP: Example extensions orchestrating local CLIs or servers.

Acceptance Criteria
- [ ] Proxy starts/stops from UI; status reflects process state.
- [ ] Keys stored/retrieved without being written to disk in plaintext.

### Week 3 — UI Development
- [ ] Build ConfigForm with provider selection and custom URL.
- [ ] Implement ModelSelector with autocomplete and provider presets.
- [ ] PopularModels widget powered by curated pairings JSON.
- [ ] Apply Hive theme and icons.
- [ ] Add status indicator and basic error surface.

Research Checklist
- [ ] Context7: VS Code UI patterns in webviews; form messaging bridge.
- [ ] Git‑MCP: Pull example model pickers or config UIs from OSS extensions.

Acceptance Criteria
- [ ] User can configure provider, keys, models, port, debug from UI and launch proxy.
- [ ] Popular pairings can one-click set reasoning/execution models.

### Week 4 — Advanced Features & Polish
- [ ] Model intelligence and suggestions (cost/context strengths).
- [ ] Real-time provider/model availability ping.
- [ ] Cost estimation and simple usage counters.
- [ ] Auto-configuration hints for Claude Code (`ANTHROPIC_BASE_URL`).
- [ ] Documentation and comprehensive examples.

Research Checklist
- [ ] Context7: Cost estimation strategies and common fields returned by providers.
- [ ] Git‑MCP: Provider‑specific availability endpoints or example pingers.

Acceptance Criteria
- [ ] Model picker highlights recommended options; availability errors are clear.
- [ ] Docs updated with provider-specific guidance and troubleshooting.

## 11. Current Status (Week 1 — Proxy Enhancements)

Completed
- Provider-aware key resolution added (`key-resolver.js`) and integrated into proxy.
- Always send `Authorization: Bearer <key>` for all providers when a key is resolved.
- OpenRouter headers (`HTTP-Referer`, `X-Title`) included when base URL is OpenRouter.
- Finish reason mapping updated to include `content_filter`.
- Tool mapping corrected: assistant `tool_use` → OpenAI `tool_calls`; `tool_result` → `role: "tool"` with `tool_call_id`.
- Early config validation returns 400 when no usable key is found.
- Smoke script added (`scripts/smoke.sh`) and README usage updated.

In Progress
- HTTP integration tests for `/v1/messages` covering stream true/false, event order, tool round-trips, and error paths.

Notes
- Unit tests added for key resolver (provider detection, key precedence, OpenRouter headers).
- Streaming event order implemented per PRD; verification will be covered by integration tests.
 - Provider selection is per proxy process (v1). No mid‑session provider switching.

## 12. Risks & Mitigations
- SSE differences across providers → Normalize event order; integration tests with parser.
- Keyring platform quirks → Provide fallback instructions; clear error messaging.
- Node version mismatch → Validate on start; document requirement (Node 18+).
- Provider limits/errors → Bubble up status; retry guidance; rate-limit friendly defaults.

## 13. Testing Strategy
- Automated: Vitest + supertest for HTTP; stream tests assert Anthropic event order and finalization; tool call round-trips.
- Manual: `scripts/test-providers.sh` for OpenRouter + custom provider; curl-based smoke tests from README.

### Research Checkpoints
- Context7: Vitest + supertest best practices for SSE; parsing and asserting event streams.
- Git‑MCP: Look up OSS tests for streaming assertions (e.g., eventsource-parser usage) as references.

## 14. Rollout
- Soft launch to The Hive community; gather feedback.
- Publish docs and quickstart.
- Prepare VS Code Marketplace listing.

## 15. Open Questions
- Place `key-resolver.js` at project root (aligns with current no-`src/` guideline) vs. `src/`? Proposed: project root.
- Keep CLI name `anthropic-proxy` for compatibility vs. alias `claude-throne`? Proposed: keep CLI, add alias later.
- Exact Anthropic streaming event fidelity expectations (e.g., thinking deltas). Confirm against real clients.
## 16. Roadmap

### Per‑Request Provider Routing (Mid‑Session Switching)
- Goal: Allow changing upstream provider per request (or per conversation) without restarting the proxy.
- Status: Out of scope for v1; planned enhancement.

Proposed Approach
- Configuration:
  - Add optional request override via headers, e.g. `X-Proxy-Base-URL` or `X-Proxy-Provider`, and `X-Proxy-Key-Alias` (no raw keys in request).
  - Maintain a server‑side key registry (env or secure store) mapping aliases → provider keys.
- Routing:
  - Resolve provider + key per request; apply provider‑specific headers (e.g., OpenRouter `HTTP-Referer`, `X-Title`).
  - Replay full conversation history to the selected provider; ensure tool_call id continuity and schema normalization.
- Security & Guardrails:
  - Do not accept raw API keys over HTTP; only accept known aliases.
  - Redact logs; preserve current DEBUG gating; enforce allowed provider allowlist.
- Observability:
  - Add provider label to logs and metrics for each request; surface in extension UI.

Future Acceptance Criteria
- [ ] Per‑request header overrides route traffic to the intended provider and authenticate using registered key alias.
- [ ] Streaming semantics preserved across provider switches within the same conversation (event order unchanged).
- [ ] Tool call mapping continues to function across providers; ids remain consistent for downstream clients.

Risks & Mitigations
- Provider schema quirks → Keep strict normalization layer and integration tests.
- Key management UX → Use alias registry + extension UI, not raw secrets in requests.
- Increased complexity → Keep default mode as single‑provider per process; make per‑request switching opt‑in.
- ### Integrated Terminal: Start Claude Code
- Goal: Provide a VS Code command to open an integrated terminal preloaded with proxy env and optionally run a Claude CLI.
- Status: Post‑MVP convenience feature.

Proposed Approach
- Add command: “Claude Throne: Open Terminal for Proxy”
- Preload env: `ANTHROPIC_BASE_URL=http://localhost:<port>` and other optional vars (e.g., `DEBUG=1`).
- Optionally run a user‑defined command (e.g., `claude` or a project script), then keep terminal interactive for normal use.
- Surface the currently running proxy status (port, provider) and offer a one‑click copy of the env var.

Acceptance Criteria
- [ ] Command opens an integrated terminal with correct env set and remains interactive.
- [ ] Optional auto‑run command executes and hands control back to the user.
