# MCP Config Converter (JSON → Codex TOML)

This quick Python tool converts common MCP server JSON snippets (as seen in various MCP setup guides) into Codex CLI/GUI `config.toml` blocks. It assumes remote HTTP servers use `mcp-remote` and injects PATH/HOME cache env so GUIs can reliably spawn Node CLIs.

## Usage

- Save your JSON (either the whole object or just the `mcpServers` block) to a file, e.g. `mcp.json`.
- Run the converter and paste the output into `~/.codex/config.toml` under the existing content.

Examples:

```bash
# From file → stdout
python3 - <<'PY'
import sys, json, os

def _toml_quote(s: str) -> str:
    return '"' + s.replace('\\', r'\\').replace('"', r'\"') + '"'

def _to_inline_table(d: dict) -> str:
    parts = []
    for k, v in d.items():
        if isinstance(v, bool):
            vv = 'true' if v else 'false'
        elif isinstance(v, (int, float)):
            vv = str(v)
        elif v is None:
            continue
        else:
            vv = _toml_quote(str(v))
        parts.append(f"{k} = {vv}")
    return "{ " + ", ".join(parts) + " }"

def convert_mcp_json_to_toml(json_obj: dict, *,
    include_defaults: bool = True,
    use_npx: bool = True,
    npx_path: str = "/opt/homebrew/bin/npx",
    global_mcp_remote: str = "/opt/homebrew/bin/mcp-remote",
    default_path: str = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin",
    default_home: str | None = None,
    default_cache_home: str | None = None,
) -> str:
    """Convert an MCP JSON mapping to Codex TOML server blocks.

    Supports either top-level `mcpServers` or a direct mapping of servers.
    For entries with a `url`, uses `mcp-remote`. Any `headers` are mapped to env.
    If `command`/`args` are present, they are passed through as-is.
    """
    if default_home is None:
        default_home = os.path.expanduser('~')
    if default_cache_home is None:
        default_cache_home = os.path.join(default_home, 'Library', 'Caches')

    servers = json_obj.get('mcpServers', json_obj)
    lines: list[str] = []

    for name, spec in servers.items():
        if not isinstance(spec, dict):
            raise ValueError(f"Server '{name}' spec must be an object")

        lines.append(f"[mcp_servers.{name}]")

        # Determine command/args
        if 'command' in spec:
            command = str(spec['command'])
            args = [str(a) for a in spec.get('args', [])]
        elif 'url' in spec:
            url = str(spec['url'])
            if use_npx:
                command = npx_path
                args = ['-y', 'mcp-remote', url]
            else:
                command = global_mcp_remote
                args = [url]
        else:
            raise ValueError(f"Server '{name}' missing 'url' or 'command'")

        lines.append(f"command = {_toml_quote(command)}")
        arg_str = ", ".join(_toml_quote(a) for a in args)
        lines.append(f"args = [{arg_str}]")

        # Build env (defaults + headers + explicit env)
        env = {}
        if include_defaults:
            env['PATH'] = default_path
            env['HOME'] = default_home
            env['XDG_CACHE_HOME'] = default_cache_home

        headers = spec.get('headers') or {}
        if not isinstance(headers, dict):
            raise ValueError(f"Server '{name}': 'headers' must be an object if provided")
        env.update({k: str(v) for k, v in headers.items()})

        extra_env = spec.get('env') or {}
        if not isinstance(extra_env, dict):
            raise ValueError(f"Server '{name}': 'env' must be an object if provided")
        env.update({k: str(v) for k, v in extra_env.items()})

        if env:
            lines.append(f"env = {_to_inline_table(env)}")

        lines.append("")

    return "\n".join(lines).strip() + "\n"

def main():
    import argparse
    p = argparse.ArgumentParser(description="Convert MCP JSON → Codex TOML")
    p.add_argument('json_file', nargs='?', help='Path to JSON file (or stdin if omitted)')
    p.add_argument('--no-default-env', action='store_true', help='Do not inject PATH/HOME/XDG_CACHE_HOME')
    p.add_argument('--use-global', action='store_true', help='Use global mcp-remote instead of npx')
    p.add_argument('--npx-path', default='/opt/homebrew/bin/npx')
    p.add_argument('--global-mcp-remote', default='/opt/homebrew/bin/mcp-remote')
    args = p.parse_args()

    data = sys.stdin.read() if not args.json_file else open(args.json_file, 'r').read()
    obj = json.loads(data)
    toml = convert_mcp_json_to_toml(
        obj,
        include_defaults=not args.no_default_env,
        use_npx=not args.use_global,
        npx_path=args.npx_path,
        global_mcp_remote=args.global_mcp_remote,
    )
    sys.stdout.write(toml)

if __name__ == '__main__':
    main()
PY
< mcp.json
```

Or save the script to a file:

```bash
cat > tools/convert_mcp_json_to_toml.py <<'PY'
# (paste the same Python code here)
PY
python3 tools/convert_mcp_json_to_toml.py mcp.json > /tmp/mcp.toml
```

Flags:

- `--no-default-env`: Skip injecting PATH/HOME/XDG cache.
- `--use-global`: Use a globally installed `mcp-remote` instead of `npx`.
- `--npx-path`: Override the absolute `npx` path.
- `--global-mcp-remote`: Override global `mcp-remote` binary path.

## Example

Input JSON:

```json
{
  "mcpServers": {
    "context7": {
      "url": "https://mcp.context7.com/mcp",
      "headers": {
        "CONTEXT7_API_KEY": "YOUR_API_KEY"
      }
    }
  }
}
```

Output TOML:

```toml
[mcp_servers.context7]
command = "/opt/homebrew/bin/npx"
args = ["-y", "mcp-remote", "https://mcp.context7.com/mcp"]
env = { PATH = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin", HOME = "/Users/bbrenner", XDG_CACHE_HOME = "/Users/bbrenner/Library/Caches", CONTEXT7_API_KEY = "YOUR_API_KEY" }
```

To use a globally installed `mcp-remote` (no NPX):

```toml
[mcp_servers.context7]
command = "/opt/homebrew/bin/mcp-remote"
args = ["https://mcp.context7.com/mcp"]
env = { PATH = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin", HOME = "/Users/bbrenner", XDG_CACHE_HOME = "/Users/bbrenner/Library/Caches", CONTEXT7_API_KEY = "YOUR_API_KEY" }
```

## Notes

- The injected PATH/HOME values match this machine (Homebrew on Apple Silicon). Adjust if needed.
- Any `headers` from the JSON become environment variables in the TOML.
- If your JSON already specifies `command`/`args`, the converter preserves them and still injects env.
- For corporate networks (e.g., Cloudflare WARP), add `HTTPS_PROXY`, `NO_PROXY`, or `NODE_EXTRA_CA_CERTS` under `env` if required.

## Before and After Examples

```json input
{
  "mcpServers": {
    "context7": {
      "url": "https://mcp.context7.com/mcp",
      "headers": {
        "CONTEXT7_API_KEY": "YOUR_API_KEY"
      }
    }
  }
}
```

```toml Output (NPX + PATH/HOME/XDG cache)
[mcp_servers.context7]
command = "/opt/homebrew/bin/npx"
args = ["-y", "mcp-remote", "https://mcp.context7.com/mcp"]
env = { PATH = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin", HOME = "/Users/bbrenner", XDG_CACHE_HOME = "/Users/bbrenner/Library/Caches", CONTEXT7_API_KEY = "YOUR_API_KEY" }
```