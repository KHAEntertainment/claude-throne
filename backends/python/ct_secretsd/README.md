# Claude-Throne Secrets Daemon (ct-secretsd)

Secure local service that stores provider API keys using the OS keychain (Keychain/DPAPI/libsecret) and provides lightweight connectivity tests. This is used by the Claude-Throne VS Code extension to manage credentials without writing secrets to disk or logs.

## Features
- Stores API keys securely via `keyring`
- Localhost-only FastAPI server requiring a bearer token
- Never logs secrets; redacts Authorization headers
- Provider adapters for OpenRouter, OpenAI, Together AI, Groq, and custom OpenAI-compatible endpoints

## Endpoints
- GET /health (no auth)
- GET /secrets/providers (auth) — lists providers with hasKey flags
- PUT /secrets/provider/{providerId} (auth) — store API key
- DELETE /secrets/provider/{providerId} (auth) — delete API key
- POST /test/provider/{providerId} (auth) — validate connectivity using stored key

## Local Development

Prereqs: Python 3.9+

Install editable:

```
python -m venv .venv
source .venv/bin/activate  # or .venv\Scripts\activate on Windows
pip install -e .[dev]
```

Run the daemon (random port, auto-generated token):

```
ct-secretsd --dev
```

Or explicitly via module:

```
python -m ct_secretsd --dev
```

Sample with explicit token and JSON logs disabled:

```
ct-secretsd --auth-token YOUR_TOKEN --text-logs
```

Note: The service binds to 127.0.0.1 only by design.

## Security Notes
- Secrets are stored in OS keyring when available; fallback to encrypted files in ~/.claude-throne only if keyring is unavailable.
- Authorization: Bearer token is required on all endpoints except /health.
- No request bodies with secrets are logged.

## License
MIT (see LICENSE)

