"""
FastAPI application for Claude-Throne Secrets Daemon.
"""

import logging
import time
from typing import Dict, List, Optional

from fastapi import Depends, FastAPI, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel

from .providers import get_provider_registry, ProviderAdapter
from .storage import SecretStorage, get_secret_storage
from .proxy_controller import ProxyController

logger = logging.getLogger(__name__)

# Security
security = HTTPBearer()


class HealthResponse(BaseModel):
    """Health check response."""
    status: str = "ok"
    version: str = "0.1.0"
    timestamp: float


class ProviderStatus(BaseModel):
    """Provider status information."""
    id: str
    name: str
    base_url: str
    has_key: bool
    last_tested: Optional[float] = None


class ProvidersResponse(BaseModel):
    """Providers list response."""
    providers: List[ProviderStatus]


class StoreKeyRequest(BaseModel):
    """Request to store an API key."""
    api_key: str
    metadata: Optional[Dict[str, str]] = None


class TestResult(BaseModel):
    """Provider connectivity test result."""
    success: bool
    error_message: Optional[str] = None
    latency_ms: Optional[float] = None
    provider_status: Optional[str] = None


class ProxyConfig(BaseModel):
    provider: str
    custom_url: Optional[str] = None
    reasoning_model: Optional[str] = None
    execution_model: Optional[str] = None
    port: int = 3000
    debug: bool = False


class ProxyStatus(BaseModel):
    running: bool
    port: Optional[int] = None
    pid: Optional[int] = None


def create_auth_dependency(auth_token: str):
    """Create authentication dependency with the configured token."""
    
    async def verify_token(credentials: HTTPAuthorizationCredentials = Depends(security)) -> bool:
        """Verify bearer token authentication."""
        if credentials.credentials != auth_token:
            logger.warning("Invalid authentication token provided")
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid authentication token",
                headers={"WWW-Authenticate": "Bearer"},
            )
        return True
    
    return verify_token


async def log_request(request: Request, call_next):
    """Log requests while redacting sensitive information."""
    start_time = time.time()
    
    # Redact authorization header
    headers = dict(request.headers)
    if "authorization" in headers:
        headers["authorization"] = "Bearer <redacted>"
    
    logger.info(
        "Request started",
        extra={
            "event": "request_start",
            "method": request.method,
            "url": str(request.url),
            "client": request.client.host if request.client else None,
        }
    )
    
    response = await call_next(request)
    
    process_time = time.time() - start_time
    logger.info(
        "Request completed",
        extra={
            "event": "request_complete",
            "method": request.method,
            "url": str(request.url),
            "status_code": response.status_code,
            "duration_ms": round(process_time * 1000, 2),
        }
    )
    
    return response


def create_app(auth_token: str) -> FastAPI:
    """Create and configure FastAPI application."""
    
    app = FastAPI(
        title="Claude-Throne Secrets Daemon",
        description="Secure API key storage and provider validation service",
        version="0.1.0",
        docs_url=None,  # Disable docs in production
        redoc_url=None,  # Disable redoc in production
        openapi_url=None,  # Disable OpenAPI schema in production
    )
    
    # Security middleware - localhost only, minimal CORS
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://127.0.0.1", "http://localhost"],
        allow_credentials=False,  # No cookies needed
        allow_methods=["GET", "POST", "PUT", "DELETE"],
        allow_headers=["Authorization", "Content-Type"],
    )
    
    # Request logging middleware
    app.middleware("http")(log_request)
    
    # Authentication dependency
    auth_dependency = create_auth_dependency(auth_token)
    
    # Dependencies
    def get_storage() -> SecretStorage:
        return get_secret_storage()
    
    def get_providers() -> Dict[str, ProviderAdapter]:
        return get_provider_registry()

    proxy_controller = ProxyController()
    
    @app.get("/health", response_model=HealthResponse)
    async def health_check() -> HealthResponse:
        """Health check endpoint (no authentication required)."""
        return HealthResponse(timestamp=time.time())
    
    @app.get("/secrets/providers", response_model=ProvidersResponse)
    async def list_providers(
        _: bool = Depends(auth_dependency),
        storage: SecretStorage = Depends(get_storage),
        providers: Dict[str, ProviderAdapter] = Depends(get_providers),
    ) -> ProvidersResponse:
        """List all providers with their key status (hasKey flags only)."""
        provider_statuses = []
        
        for provider_id, adapter in providers.items():
            has_key = await storage.has_key(provider_id)
            
            provider_statuses.append(ProviderStatus(
                id=provider_id,
                name=adapter.name,
                base_url=adapter.base_url,
                has_key=has_key,
            ))
        
        logger.info(
            "Listed providers",
            extra={
                "event": "providers_listed",
                "provider_count": len(provider_statuses),
                "providers_with_keys": sum(1 for p in provider_statuses if p.has_key),
            }
        )
        
        return ProvidersResponse(providers=provider_statuses)
    
    @app.put("/secrets/provider/{provider_id}")
    async def store_provider_key(
        provider_id: str,
        request: StoreKeyRequest,
        _: bool = Depends(auth_dependency),
        storage: SecretStorage = Depends(get_storage),
        providers: Dict[str, ProviderAdapter] = Depends(get_providers),
    ) -> Dict[str, str]:
        """Store API key for a provider."""
        if provider_id not in providers:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Provider '{provider_id}' not found"
            )
        
        success = await storage.store_key(
            provider_id, 
            request.api_key, 
            metadata=request.metadata
        )
        
        if not success:
            logger.error(
                "Failed to store API key",
                extra={"event": "key_store_failed", "provider_id": provider_id}
            )
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to store API key securely"
            )
        
        logger.info(
            "API key stored",
            extra={"event": "key_stored", "provider_id": provider_id}
        )
        
        return {"message": f"API key stored for {provider_id}"}
    
    @app.delete("/secrets/provider/{provider_id}")
    async def delete_provider_key(
        provider_id: str,
        _: bool = Depends(auth_dependency),
        storage: SecretStorage = Depends(get_storage),
        providers: Dict[str, ProviderAdapter] = Depends(get_providers),
    ) -> Dict[str, str]:
        """Delete API key for a provider."""
        if provider_id not in providers:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Provider '{provider_id}' not found"
            )
        
        success = await storage.delete_key(provider_id)
        
        if not success:
            logger.error(
                "Failed to delete API key",
                extra={"event": "key_delete_failed", "provider_id": provider_id}
            )
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to delete API key"
            )
        
        logger.info(
            "API key deleted",
            extra={"event": "key_deleted", "provider_id": provider_id}
        )
        
        return {"message": f"API key deleted for {provider_id}"}
    
    @app.post("/test/provider/{provider_id}", response_model=TestResult)
    async def test_provider_connectivity(
        provider_id: str,
        _: bool = Depends(auth_dependency),
        storage: SecretStorage = Depends(get_storage),
        providers: Dict[str, ProviderAdapter] = Depends(get_providers),
    ) -> TestResult:
        """Test connectivity to a provider using stored API key."""
        if provider_id not in providers:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Provider '{provider_id}' not found"
            )
        
        adapter = providers[provider_id]
        api_key = await storage.get_key(provider_id)
        
        if not api_key:
            return TestResult(
                success=False,
                error_message=f"No API key stored for {provider_id}"
            )
        
        # Test provider connectivity
        start_time = time.time()
        try:
            result = await adapter.validate(api_key)
            latency = (time.time() - start_time) * 1000
            
            logger.info(
                "Provider test completed",
                extra={
                    "event": "provider_tested",
                    "provider_id": provider_id,
                    "success": result.success,
                    "latency_ms": round(latency, 2),
                }
            )
            
            return TestResult(
                success=result.success,
                error_message=result.error_message if not result.success else None,
                latency_ms=round(latency, 2),
                provider_status=result.provider_status,
            )
            
        except Exception as e:
            latency = (time.time() - start_time) * 1000
            
            logger.error(
                "Provider test failed with exception",
                extra={
                    "event": "provider_test_error",
                    "provider_id": provider_id,
                    "error": str(e),
                    "latency_ms": round(latency, 2),
                }
            )
            
            return TestResult(
                success=False,
                error_message=f"Test failed: {str(e)}",
                latency_ms=round(latency, 2),
            )

    # Proxy lifecycle endpoints
    @app.get("/proxy/status", response_model=ProxyStatus)
    async def proxy_status(_: bool = Depends(auth_dependency)) -> ProxyStatus:
        if proxy_controller.is_running and proxy_controller.info:
            return ProxyStatus(running=True, port=proxy_controller.info.port, pid=proxy_controller.info.pid)
        return ProxyStatus(running=False)

    @app.post("/proxy/stop")
    async def proxy_stop(_: bool = Depends(auth_dependency)) -> Dict[str, bool]:
        ok = proxy_controller.stop()
        return {"success": ok}

    @app.post("/proxy/start", response_model=ProxyStatus)
    async def proxy_start(
        cfg: ProxyConfig,
        _: bool = Depends(auth_dependency),
        storage: SecretStorage = Depends(get_storage),
        providers: Dict[str, ProviderAdapter] = Depends(get_providers),
    ) -> ProxyStatus:
        provider_id = cfg.provider
        if provider_id not in providers:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Unknown provider '{provider_id}'")

        # Require key for provider
        api_key = await storage.get_key(provider_id)
        if not api_key:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"No API key stored for provider '{provider_id}'")

        # Compose environment for Node proxy
        env: Dict[str, str] = {
            "PORT": str(cfg.port),
        }
        if cfg.reasoning_model:
            env["REASONING_MODEL"] = cfg.reasoning_model
        if cfg.execution_model:
            env["COMPLETION_MODEL"] = cfg.execution_model
        if cfg.debug:
            env["DEBUG"] = "1"

        # Provider base URLs for Node proxy (must match OpenAI-compatible endpoints)
        base_urls = {
            "openrouter": "https://openrouter.ai/api",
            "openai": "https://api.openai.com",
            "together": "https://api.together.xyz",
            "groq": "https://api.groq.com/openai",
            "custom": cfg.custom_url or "",
        }

        # Set provider-specific env
        if provider_id == "custom":
            if not cfg.custom_url:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="custom_url is required for custom provider")
            env["ANTHROPIC_PROXY_BASE_URL"] = cfg.custom_url
            env["CUSTOM_API_KEY"] = api_key
        elif provider_id == "openrouter":
            env["ANTHROPIC_PROXY_BASE_URL"] = base_urls["openrouter"]
            env["OPENROUTER_API_KEY"] = api_key
        elif provider_id == "openai":
            env["ANTHROPIC_PROXY_BASE_URL"] = base_urls["openai"]
            env["OPENAI_API_KEY"] = api_key
        elif provider_id == "together":
            env["ANTHROPIC_PROXY_BASE_URL"] = base_urls["together"]
            env["TOGETHER_API_KEY"] = api_key
        elif provider_id == "groq":
            env["ANTHROPIC_PROXY_BASE_URL"] = base_urls["groq"]
            env["GROQ_API_KEY"] = api_key
        else:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Unsupported provider '{provider_id}'")

        try:
            info = proxy_controller.start(env=env, port=cfg.port)
            return ProxyStatus(running=True, port=info.port, pid=info.pid)
        except Exception as e:
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))
    
    return app
