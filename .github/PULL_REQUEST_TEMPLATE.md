## Summary

- What does this change do and why?
- Include any relevant logs, screenshots, or links.

## Checklist

- [ ] Reviewed `MemorySystem.md` and followed repository rules
- [ ] Changes follow Streaming/SSE event order (`message_start` → `content_block_*` → `message_stop`)
- [ ] No secrets committed; configuration via environment variables
- [ ] Verified `/v1/messages` for `stream: true/false` as applicable
- [ ] Updated docs if behavior or env vars changed (`AGENTS.md`, PRD)

## Verification Steps

```bash
# Local run
DEBUG=1 OPENROUTER_API_KEY=... PORT=3000 npm start

# Smoke test (non-streaming)
curl -s http://localhost:3000/v1/messages \
  -H 'Content-Type: application/json' \
  -d '{"messages":[{"role":"user","content":"Say hi"}],"stream":false}'
```

## Related Issues

- Fixes #
- Related to #

