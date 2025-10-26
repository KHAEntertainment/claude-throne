# Fixes in v1.5.11

- Proxy now detects Anthropic-native providers (Deepseek, GLM, Anthropic) and forwards requests to `/v1/messages` without transforming payloads into OpenAI format.
- Upstream headers automatically switch between `Authorization` and `x-api-key` based on endpoint kind, including configurable `anthropic-version` and optional beta headers.
- Streaming passthrough for Anthropic SSE keeps event order intact, preventing system prompt leakage and malformed partials.
- CLI health check and startup diagnostics display synced version numbers, provider, endpoint kind, and API key source for easier debugging.
- Model capability map supports provider-aware XML tool injection through `models-capabilities.json` with `FORCE_XML_TOOLS` override.
