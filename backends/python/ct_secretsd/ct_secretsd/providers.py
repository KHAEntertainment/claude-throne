"""
Provider adapters for API validation and connectivity testing.
"""

import asyncio
import logging
from abc import ABC, abstractmethod
from typing import Dict, Optional

import httpx
from pydantic import BaseModel

logger = logging.getLogger(__name__)


class ValidationResult(BaseModel):
    """Result of provider validation."""
    success: bool
    error_message: Optional[str] = None
    provider_status: Optional[str] = None


class ProviderAdapter(ABC):
    """Abstract base class for provider adapters."""
    
    def __init__(self, name: str, base_url: str):
        self.name = name
        self.base_url = base_url
    
    @abstractmethod
    async def validate(self, api_key: str) -> ValidationResult:
        """Validate API key by making a lightweight test request."""
        pass
    
    def get_headers(self, api_key: str) -> Dict[str, str]:
        """Get headers for API requests."""
        return {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "User-Agent": "Claude-Throne-Secrets-Daemon/0.1.0",
        }


class OpenRouterAdapter(ProviderAdapter):
    """Adapter for OpenRouter API."""
    
    def __init__(self):
        super().__init__("OpenRouter", "https://openrouter.ai/api")
    
    def get_headers(self, api_key: str) -> Dict[str, str]:
        """Get headers with OpenRouter-specific headers."""
        headers = super().get_headers(api_key)
        headers.update({
            "HTTP-Referer": "https://github.com/KHAEntertainment/claude-throne",
            "X-Title": "Claude-Throne",
        })
        return headers
    
    async def validate(self, api_key: str) -> ValidationResult:
        """Validate OpenRouter API key using models endpoint."""
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(
                    f"{self.base_url}/v1/models",
                    headers=self.get_headers(api_key)
                )
                
                if response.status_code == 200:
                    data = response.json()
                    model_count = len(data.get("data", []))
                    return ValidationResult(
                        success=True,
                        provider_status=f"OK - {model_count} models available"
                    )
                elif response.status_code == 401:
                    return ValidationResult(
                        success=False,
                        error_message="Invalid API key. Get your key at: https://openrouter.ai/keys"
                    )
                elif response.status_code == 429:
                    return ValidationResult(
                        success=False,
                        error_message="Rate limited. Please try again in a moment."
                    )
                else:
                    return ValidationResult(
                        success=False,
                        error_message=f"API returned status {response.status_code}: {response.text}"
                    )
                    
        except httpx.TimeoutException:
            return ValidationResult(
                success=False,
                error_message="Request timed out. Check your internet connection."
            )
        except Exception as e:
            return ValidationResult(
                success=False,
                error_message=f"Connection failed: {str(e)}"
            )


class OpenAIAdapter(ProviderAdapter):
    """Adapter for OpenAI API."""
    
    def __init__(self):
        super().__init__("OpenAI", "https://api.openai.com")
    
    async def validate(self, api_key: str) -> ValidationResult:
        """Validate OpenAI API key using models endpoint."""
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(
                    f"{self.base_url}/v1/models",
                    headers=self.get_headers(api_key)
                )
                
                if response.status_code == 200:
                    data = response.json()
                    model_count = len(data.get("data", []))
                    return ValidationResult(
                        success=True,
                        provider_status=f"OK - {model_count} models available"
                    )
                elif response.status_code == 401:
                    return ValidationResult(
                        success=False,
                        error_message="Invalid API key. Get your key at: https://platform.openai.com/api-keys"
                    )
                elif response.status_code == 429:
                    return ValidationResult(
                        success=False,
                        error_message="Rate limited or quota exceeded. Check your OpenAI billing."
                    )
                else:
                    return ValidationResult(
                        success=False,
                        error_message=f"API returned status {response.status_code}: {response.text}"
                    )
                    
        except httpx.TimeoutException:
            return ValidationResult(
                success=False,
                error_message="Request timed out. Check your internet connection."
            )
        except Exception as e:
            return ValidationResult(
                success=False,
                error_message=f"Connection failed: {str(e)}"
            )


class TogetherAdapter(ProviderAdapter):
    """Adapter for Together AI API."""
    
    def __init__(self):
        super().__init__("Together AI", "https://api.together.xyz")
    
    async def validate(self, api_key: str) -> ValidationResult:
        """Validate Together AI API key using models endpoint."""
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(
                    f"{self.base_url}/v1/models",
                    headers=self.get_headers(api_key)
                )
                
                if response.status_code == 200:
                    data = response.json()
                    model_count = len(data.get("data", []))
                    return ValidationResult(
                        success=True,
                        provider_status=f"OK - {model_count} models available"
                    )
                elif response.status_code == 401:
                    return ValidationResult(
                        success=False,
                        error_message="Invalid API key. Get your key at: https://api.together.xyz/settings/api-keys"
                    )
                elif response.status_code == 429:
                    return ValidationResult(
                        success=False,
                        error_message="Rate limited. Please try again in a moment."
                    )
                else:
                    return ValidationResult(
                        success=False,
                        error_message=f"API returned status {response.status_code}: {response.text}"
                    )
                    
        except httpx.TimeoutException:
            return ValidationResult(
                success=False,
                error_message="Request timed out. Check your internet connection."
            )
        except Exception as e:
            return ValidationResult(
                success=False,
                error_message=f"Connection failed: {str(e)}"
            )


class GroqAdapter(ProviderAdapter):
    """Adapter for Groq API."""
    
    def __init__(self):
        super().__init__("Groq", "https://api.groq.com")
    
    async def validate(self, api_key: str) -> ValidationResult:
        """Validate Groq API key using models endpoint."""
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(
                    f"{self.base_url}/openai/v1/models",
                    headers=self.get_headers(api_key)
                )
                
                if response.status_code == 200:
                    data = response.json()
                    model_count = len(data.get("data", []))
                    return ValidationResult(
                        success=True,
                        provider_status=f"OK - {model_count} models available"
                    )
                elif response.status_code == 401:
                    return ValidationResult(
                        success=False,
                        error_message="Invalid API key. Get your key at: https://console.groq.com/keys"
                    )
                elif response.status_code == 429:
                    return ValidationResult(
                        success=False,
                        error_message="Rate limited. Please try again in a moment."
                    )
                else:
                    return ValidationResult(
                        success=False,
                        error_message=f"API returned status {response.status_code}: {response.text}"
                    )
                    
        except httpx.TimeoutException:
            return ValidationResult(
                success=False,
                error_message="Request timed out. Check your internet connection."
            )
        except Exception as e:
            return ValidationResult(
                success=False,
                error_message=f"Connection failed: {str(e)}"
            )


class CustomAdapter(ProviderAdapter):
    """Adapter for custom OpenAI-compatible endpoints."""
    
    def __init__(self, base_url: str = "https://api.example.com"):
        super().__init__("Custom Provider", base_url)
    
    async def validate(self, api_key: str) -> ValidationResult:
        """Validate custom provider API key using models endpoint."""
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                # Try standard OpenAI-compatible endpoints
                endpoints_to_try = [
                    f"{self.base_url}/v1/models",
                    f"{self.base_url}/models",
                    f"{self.base_url}/openai/v1/models",
                ]
                
                for endpoint in endpoints_to_try:
                    try:
                        response = await client.get(
                            endpoint,
                            headers=self.get_headers(api_key)
                        )
                        
                        if response.status_code == 200:
                            data = response.json()
                            model_count = len(data.get("data", []))
                            return ValidationResult(
                                success=True,
                                provider_status=f"OK - {model_count} models available"
                            )
                        elif response.status_code == 401:
                            return ValidationResult(
                                success=False,
                                error_message="Invalid API key for custom provider"
                            )
                        elif response.status_code == 404:
                            # Try next endpoint
                            continue
                        else:
                            return ValidationResult(
                                success=False,
                                error_message=f"API returned status {response.status_code}: {response.text}"
                            )
                    except httpx.RequestError:
                        # Try next endpoint
                        continue
                
                return ValidationResult(
                    success=False,
                    error_message="No valid models endpoint found. Ensure your provider is OpenAI-compatible."
                )
                    
        except httpx.TimeoutException:
            return ValidationResult(
                success=False,
                error_message="Request timed out. Check your internet connection and provider URL."
            )
        except Exception as e:
            return ValidationResult(
                success=False,
                error_message=f"Connection failed: {str(e)}"
            )


# Global provider registry
_provider_registry: Optional[Dict[str, ProviderAdapter]] = None


def get_provider_registry() -> Dict[str, ProviderAdapter]:
    """Get the provider registry (singleton)."""
    global _provider_registry
    
    if _provider_registry is not None:
        return _provider_registry
    
    _provider_registry = {
        "openrouter": OpenRouterAdapter(),
        "openai": OpenAIAdapter(), 
        "together": TogetherAdapter(),
        "groq": GroqAdapter(),
        "custom": CustomAdapter(),
    }
    
    logger.info(f"Initialized provider registry with {len(_provider_registry)} providers")
    return _provider_registry
