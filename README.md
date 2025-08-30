# Claude Throne

Claude Throne is a fork and evolution of the excellent anthropic-proxy. It keeps the Anthropic-style API surface while routing to OpenAI-compatible providers (OpenRouter by default), and focuses on improved auth, provider ergonomics, and developer experience.

See the project goals and roadmap in docs/Claude-Throne-PRD.md.

## VS Code Extension (Planned)
- GUI to configure provider, keys, models, and port
- Secure credential storage (OS keychain) and proxy lifecycle controls
- Targets seamless Claude Code setup with proper headers and streaming semantics
For details, see docs/Claude-Throne-PRD.md.

## Usage

With this command, you can start the proxy server with your OpenRouter API key on port 3000:

```bash
OPENROUTER_API_KEY=your-api-key npx anthropic-proxy
```

Environment variables:

- `OPENROUTER_API_KEY`: Your OpenRouter API key (required when using OpenRouter)
- `ANTHROPIC_PROXY_BASE_URL`: Custom base URL for the transformed OpenAI-format message (default: `openrouter.ai`)
- `PORT`: The port the proxy server should listen on (default: 3000)
- `REASONING_MODEL`: The reasoning model to use (default: `google/gemini-2.0-pro-exp-02-05:free`)
- `COMPLETION_MODEL`: The completion model to use (default: `google/gemini-2.0-pro-exp-02-05:free`)
- `DEBUG`: Set to `1` to enable debug logging

Note: When `ANTHROPIC_PROXY_BASE_URL` is set to a custom URL, the `OPENROUTER_API_KEY` is not required.

## Claude Code

To use the proxy server as a backend for Claude Code, you have to set the `ANTHROPIC_BASE_URL` to the URL of the proxy server:

```bash
ANTHROPIC_BASE_URL=http://0.0.0.0:3000 claude
```

## Attribution
- Upstream project: anthropic-proxy by Max Nowack (https://github.com/maxnowack/anthropic-proxy)
- This fork: maintained by KHA Entertainment (https://github.com/KHAEntertainment/claude-throne)

## License
MIT. Original work © 2025 Max Nowack. Fork changes © their respective authors.

## Contributions
Contributions are welcome. Please open issues and/or Pull Requests. We’ll do a full docs pass once the MVP lands.
