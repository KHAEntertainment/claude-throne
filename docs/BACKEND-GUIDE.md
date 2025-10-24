# Claude-Throne Python Backend Guide

## Overview

The `ct_secretsd` (Claude-Throne Secrets Daemon) is a Python FastAPI backend that provides enhanced security and cross-platform credential management for Claude-Throne. This service acts as a secure credential store and proxy management system.

## Architecture

### Core Components
```
ct_secretsd/
├── app.py                   # FastAPI application and endpoints
├── providers.py             # Provider adapter implementations
├── storage.py               # Secure storage backends
├── proxy_controller.py      # Proxy lifecycle management
├── main.py                  # CLI interface and entry point
└── __init__.py              # Package initialization
```

### Technology Stack
- **FastAPI**: Modern Python web framework for APIs
- **Uvicorn**: ASGI server for production deployment
- **keyring**: Cross-platform secure credential storage
- **cryptography**: Encryption for file-based storage
- **pydantic**: Data validation and settings management
- **httpx**: Async HTTP client for provider communication

## Installation and Setup

### Development Installation
```bash
cd backends/python/ct_secretsd
pip install -e .
```

### Production Installation
```bash
pip install ct-secretsd
```

### Development Mode
```bash
ct-secretsd --dev
# or
python -m ct_secretsd --dev
```

### Production Mode
```bash
ct-secretsd --host 0.0.0.0 --port 8123
```

## Configuration

### Environment Variables
- `CT_SECRETSD_HOST`: Server host (default: 127.0.0.1)
- `CT_SECRETSD_PORT`: Server port (default: 8123)
- `CT_SECRETSD_LOG_LEVEL`: Logging level (default: INFO)
- `CT_SECRETSD_DEBUG`: Enable debug mode (default: false)

### Configuration File
Create `config.yaml` for advanced configuration:
```yaml
host: "127.0.0.1"
port: 8123
debug: false
log_level: "INFO"
storage:
  backend: "keyring"  # or "file"
  file_path: "~/.ct_secretsd/encrypted.json"
providers:
  timeout: 30
  retry_attempts: 3
```

## API Endpoints

### Health Check
```http
GET /health
```

**Response:**
```json
{
  "status": "ok",
  "version": "0.1.0",
  "timestamp": 1640995200.0
}
```

### Provider Management

#### List Providers
```http
GET /providers
```

**Response:**
```json
{
  "providers": [
    {
      "id": "openrouter",
      "name": "OpenRouter",
      "base_url": "https://openrouter.ai/api",
      "has_key": true,
      "last_tested": 1640995200.0
    }
  ]
}
```

#### Test Provider
```http
POST /providers/{provider_id}/test
```

**Body:**
```json
{
  "api_key": "sk-or-..."
}
```

### Credential Management

#### Store API Key
```http
POST /credentials/{provider_id}
```

**Body:**
```json
{
  "api_key": "sk-or-...",
  "metadata": {
    "description": "OpenRouter API key",
    "created_by": "claude-throne"
  }
}
```

#### Retrieve API Key
```http
GET /credentials/{provider_id}
```

**Response:**
```json
{
  "api_key": "sk-or-...",
  "metadata": {
    "description": "OpenRouter API key",
    "created_by": "claude-throne",
    "created_at": 1640995200.0
  }
}
```

#### Delete API Key
```http
DELETE /credentials/{provider_id}
```

### Proxy Management

#### Start Proxy
```http
POST /proxy/start
```

**Body:**
```json
{
  "provider": "openrouter",
  "port": 3000,
  "reasoning_model": "deepseek/deepseek-chat-v3.1:free",
  "completion_model": "qwen/qwen3-coder:free",
  "debug": false
}
```

#### Stop Proxy
```http
POST /proxy/stop
```

#### Get Proxy Status
```http
GET /proxy/status
```

**Response:**
```json
{
  "running": true,
  "pid": 12345,
  "port": 3000,
  "provider": "openrouter",
  "uptime": 3600,
  "memory_usage": 52428800
}
```

## Storage Backends

### Keyring Backend (Default)
Uses the system's native keychain:
- **macOS**: Keychain
- **Windows**: Windows Credential Manager
- **Linux**: libsecret or GNOME Keyring

**Advantages**:
- Native security integration
- Automatic locking/unlocking with system
- Biometric authentication support

### File-Based Backend
Encrypted JSON file storage as fallback:
```python
# Storage configuration
storage_config = {
    "backend": "file",
    "file_path": "~/.ct_secretsd/encrypted.json",
    "encryption_key": "derived_from_system_key"
}
```

**Features**:
- AES-256 encryption
- Key derivation from system secrets
- Automatic key rotation support

## Provider Adapters

### Supported Providers
- **OpenRouter**: 400+ models with smart routing
- **OpenAI**: GPT-4, GPT-4o, o1 models
- **Together AI**: Open source models
- **Grok**: xAI's Grok models
- **Custom**: Any OpenAI-compatible endpoint

### Provider Configuration
```python
# providers.py example
class OpenRouterProvider(BaseProvider):
    base_url = "https://openrouter.ai/api"
    models_endpoint = "/v1/models"
    chat_endpoint = "/v1/chat/completions"
    
    def get_headers(self, api_key: str) -> Dict[str, str]:
        return {
            "Authorization": f"Bearer {api_key}",
            "HTTP-Referer": "https://github.com/KHAEntertainment/claude-throne",
            "X-Title": "Claude-Throne-Proxy"
        }
```

### Adding New Providers
1. Create provider class inheriting from `BaseProvider`
2. Implement required methods:
   - `get_headers()`: Provider-specific headers
   - `validate_api_key()`: Key validation logic
   - `get_models()`: Model listing
3. Register in provider registry

## Security Features

### Encryption
- **AES-256-GCM**: File storage encryption
- **Key Derivation**: PBKDF2 with salt
- **Secure Random**: Cryptographically secure random data
- **Memory Protection**: Sensitive data cleared from memory

### Authentication
- **Bearer Tokens**: HTTP Bearer token authentication
- **API Key Validation**: Validate keys before storage
- **Rate Limiting**: Prevent brute force attacks
- **CORS**: Configurable cross-origin resource sharing

### Access Control
```python
# Example middleware
@app.middleware("http")
async def security_middleware(request: Request, call_next):
    # Validate API key
    # Check rate limits
    # Log access attempts
    response = await call_next(request)
    return response
```

## Proxy Controller

### Process Management
```python
class ProxyController:
    def __init__(self):
        self.process = None
        self.config = None
    
    async def start_proxy(self, config: ProxyConfig) -> bool:
        """Start proxy with configuration"""
        env_vars = self._build_env_vars(config)
        self.process = await asyncio.create_subprocess_exec(
            "npx", "claude-throne",
            env={**os.environ, **env_vars}
        )
        return True
    
    async def stop_proxy(self) -> bool:
        """Gracefully stop proxy"""
        if self.process:
            self.process.terminate()
            await self.process.wait()
        return True
```

### Configuration Management
- **Environment Variables**: Pass configuration to proxy
- **Process Monitoring**: Track proxy health and status
- **Automatic Restart**: Restart on crashes (configurable)
- **Resource Limits**: Monitor memory and CPU usage

## Development

### Running Tests
```bash
cd backends/python/ct_secretsd
pytest
```

### Code Quality
```bash
# Formatting
black ct_secretsd/

# Import sorting
isort ct_secretsd/

# Type checking
mypy ct_secretsd/
```

### Adding Features
1. Create feature branch
2. Write tests first
3. Implement functionality
4. Update documentation
5. Submit pull request

### Debugging
```bash
# Enable debug logging
ct-secretsd --debug --log-level DEBUG

# Specific module debugging
python -m ct_secretsd --debug-module storage
```

## Deployment

### Docker Deployment
```dockerfile
FROM python:3.11-slim
COPY . /app
WORKDIR /app
RUN pip install -e .
EXPOSE 8123
CMD ["ct-secretsd", "--host", "0.0.0.0"]
```

### Systemd Service
```ini
[Unit]
Description=Claude-Throne Secrets Daemon
After=network.target

[Service]
Type=simple
User=claude-throne
ExecStart=/usr/local/bin/ct-secretsd
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

### Monitoring
- **Health Checks**: `/health` endpoint monitoring
- **Metrics**: Prometheus metrics endpoint (optional)
- **Logging**: Structured JSON logging
- **Alerts**: Integration with monitoring systems

## Troubleshooting

### Common Issues

#### Keyring Access Denied
```bash
# Check keyring backend
python -c "import keyring; print(keyring.get_keyring())"

# Reset permissions (macOS)
security unlock-keychain
```

#### Proxy Process Issues
```bash
# Check process status
ps aux | grep claude-throne

# Check port usage
netstat -tlnp | grep 3000
```

#### Storage Backend Issues
```bash
# Test file storage
ct-secretsd --storage-backend file --test

# Check encryption
python -c "from ct_secretsd.storage import test_encryption; test_encryption()"
```

### Debug Mode
Enable comprehensive debugging:
```bash
ct-secretsd --debug --log-level DEBUG --trace-requests
```

Debug information includes:
- Request/response logging
- Storage operation details
- Provider communication
- Error stack traces

## Best Practices

### 1. Security
- Use system keyring when available
- Regularly rotate API keys
- Enable debug mode only in development
- Monitor access logs

### 2. Performance
- Use connection pooling for HTTP requests
- Implement caching for provider responses
- Monitor memory usage in long-running processes
- Use async/await for I/O operations

### 3. Reliability
- Implement proper error handling
- Use circuit breakers for external APIs
- Add health checks and monitoring
- Plan for graceful degradation

### 4. Maintenance
- Regular security updates
- Monitor dependency vulnerabilities
- Backup encrypted storage files
- Document custom configurations

This backend provides a robust, secure foundation for credential management and proxy control, enhancing the overall security and reliability of the Claude-Throne ecosystem.
