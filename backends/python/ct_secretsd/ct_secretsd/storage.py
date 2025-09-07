"""
Secure storage for API keys using OS keyring.
"""

import asyncio
import json
import logging
import os
from abc import ABC, abstractmethod
from typing import Dict, Optional

import keyring
from cryptography.fernet import Fernet, InvalidToken
from keyring.errors import KeyringError

logger = logging.getLogger(__name__)

SERVICE_NAME = "claude-throne"


class StorageError(Exception):
    """Base class for storage errors."""
    pass


class SecretStorage(ABC):
    """Abstract interface for secure secret storage."""
    
    @abstractmethod
    async def store_key(self, provider_id: str, api_key: str, metadata: Optional[Dict[str, str]] = None) -> bool:
        """Store an API key for a provider."""
        pass
    
    @abstractmethod
    async def get_key(self, provider_id: str) -> Optional[str]:
        """Retrieve an API key for a provider."""
        pass
    
    @abstractmethod
    async def has_key(self, provider_id: str) -> bool:
        """Check if a provider has a stored key."""
        pass
    
    @abstractmethod
    async def delete_key(self, provider_id: str) -> bool:
        """Delete an API key for a provider."""
        pass
    
    @abstractmethod
    async def list_providers(self) -> list[str]:
        """List all providers with stored keys."""
        pass


class KeyringStorage(SecretStorage):
    """Secure storage using OS keyring (Keychain/DPAPI/libsecret)."""
    
    def __init__(self, service_name: str = SERVICE_NAME):
        self.service_name = service_name
        logger.info(f"Initialized keyring storage with service: {service_name}")
    
    def _get_account_name(self, provider_id: str) -> str:
        """Get account name for keyring entry."""
        return f"{provider_id}-api-key"
    
    def _run_sync(self, func, *args, **kwargs):
        """Run synchronous keyring operations in thread pool."""
        loop = asyncio.get_event_loop()
        return loop.run_in_executor(None, func, *args, **kwargs)
    
    async def store_key(self, provider_id: str, api_key: str, metadata: Optional[Dict[str, str]] = None) -> bool:
        """Store an API key in the OS keyring."""
        try:
            account_name = self._get_account_name(provider_id)
            
            # Store metadata separately if provided
            if metadata:
                metadata_account = f"{provider_id}-metadata"
                metadata_json = json.dumps(metadata)
                await self._run_sync(
                    keyring.set_password, 
                    self.service_name, 
                    metadata_account, 
                    metadata_json
                )
            
            # Store the API key
            await self._run_sync(
                keyring.set_password, 
                self.service_name, 
                account_name, 
                api_key
            )
            
            logger.info(f"Stored API key for provider: {provider_id}")
            return True
            
        except KeyringError as e:
            logger.error(f"Keyring error storing key for {provider_id}: {e}")
            return False
        except Exception as e:
            logger.error(f"Unexpected error storing key for {provider_id}: {e}")
            return False
    
    async def get_key(self, provider_id: str) -> Optional[str]:
        """Retrieve an API key from the OS keyring."""
        try:
            account_name = self._get_account_name(provider_id)
            key = await self._run_sync(
                keyring.get_password, 
                self.service_name, 
                account_name
            )
            
            if key:
                logger.debug(f"Retrieved API key for provider: {provider_id}")
            else:
                logger.debug(f"No API key found for provider: {provider_id}")
            
            return key
            
        except KeyringError as e:
            logger.error(f"Keyring error retrieving key for {provider_id}: {e}")
            return None
        except Exception as e:
            logger.error(f"Unexpected error retrieving key for {provider_id}: {e}")
            return None
    
    async def has_key(self, provider_id: str) -> bool:
        """Check if a provider has a stored key."""
        key = await self.get_key(provider_id)
        return key is not None
    
    async def delete_key(self, provider_id: str) -> bool:
        """Delete an API key from the OS keyring."""
        try:
            account_name = self._get_account_name(provider_id)
            metadata_account = f"{provider_id}-metadata"
            
            # Delete metadata if it exists
            try:
                await self._run_sync(
                    keyring.delete_password, 
                    self.service_name, 
                    metadata_account
                )
            except KeyringError:
                # Metadata might not exist, that's OK
                pass
            
            # Delete the API key
            await self._run_sync(
                keyring.delete_password, 
                self.service_name, 
                account_name
            )
            
            logger.info(f"Deleted API key for provider: {provider_id}")
            return True
            
        except KeyringError as e:
            logger.error(f"Keyring error deleting key for {provider_id}: {e}")
            return False
        except Exception as e:
            logger.error(f"Unexpected error deleting key for {provider_id}: {e}")
            return False
    
    async def list_providers(self) -> list[str]:
        """List all providers with stored keys."""
        # Note: This is a limitation of the keyring API - we can't easily enumerate
        # stored credentials. For now, we'll rely on the provider registry
        # to know which providers exist and check each one.
        logger.warning("list_providers not fully implemented - keyring API limitation")
        return []


class EncryptedFileStorage(SecretStorage):
    """Fallback storage using encrypted files (for systems without keyring)."""
    
    def __init__(self, storage_dir: str = "~/.claude-throne"):
        import os
        from pathlib import Path
        
        self.storage_dir = Path(storage_dir).expanduser()
        self.storage_dir.mkdir(mode=0o700, exist_ok=True)
        
        # Generate or load encryption key
        self.key_file = self.storage_dir / ".encryption_key"
        self._encryption_key = self._get_or_create_key()
        
        logger.info(f"Initialized encrypted file storage at: {self.storage_dir}")
    
    def _get_or_create_key(self) -> bytes:
        """Get or create encryption key."""
        try:
            if self.key_file.exists():
                with open(self.key_file, 'rb') as f:
                    return f.read()
            else:
                key = Fernet.generate_key()
                with open(self.key_file, 'wb') as f:
                    f.write(key)
                self.key_file.chmod(0o600)  # User read/write only
                return key
        except Exception as e:
            logger.error(f"Failed to manage encryption key: {e}")
            raise StorageError(f"Cannot initialize encrypted storage: {e}")
    
    def _get_key_file(self, provider_id: str) -> str:
        """Get file path for provider key."""
        return str(self.storage_dir / f"{provider_id}.key")
    
    def _encrypt_data(self, data: str) -> bytes:
        """Encrypt data using Fernet."""
        fernet = Fernet(self._encryption_key)
        return fernet.encrypt(data.encode())
    
    def _decrypt_data(self, encrypted_data: bytes) -> str:
        """Decrypt data using Fernet."""
        fernet = Fernet(self._encryption_key)
        return fernet.decrypt(encrypted_data).decode()
    
    async def store_key(self, provider_id: str, api_key: str, metadata: Optional[Dict[str, str]] = None) -> bool:
        """Store an encrypted API key to file."""
        try:
            key_file = self._get_key_file(provider_id)
            
            # Create data structure
            data = {
                "api_key": api_key,
                "metadata": metadata or {}
            }
            
            # Encrypt and save
            encrypted_data = self._encrypt_data(json.dumps(data))
            
            with open(key_file, 'wb') as f:
                f.write(encrypted_data)
            
            # Set restrictive permissions
            import os
            os.chmod(key_file, 0o600)
            
            logger.info(f"Stored encrypted API key for provider: {provider_id}")
            return True
            
        except Exception as e:
            logger.error(f"Failed to store encrypted key for {provider_id}: {e}")
            return False
    
    async def get_key(self, provider_id: str) -> Optional[str]:
        """Retrieve and decrypt an API key from file."""
        try:
            key_file = self._get_key_file(provider_id)
            
            if not os.path.exists(key_file):
                return None
            
            with open(key_file, 'rb') as f:
                encrypted_data = f.read()
            
            decrypted_json = self._decrypt_data(encrypted_data)
            data = json.loads(decrypted_json)
            
            logger.debug(f"Retrieved encrypted API key for provider: {provider_id}")
            return data.get("api_key")
            
        except (FileNotFoundError, InvalidToken, json.JSONDecodeError) as e:
            logger.error(f"Failed to retrieve encrypted key for {provider_id}: {e}")
            return None
        except Exception as e:
            logger.error(f"Unexpected error retrieving encrypted key for {provider_id}: {e}")
            return None
    
    async def has_key(self, provider_id: str) -> bool:
        """Check if encrypted key file exists."""
        import os
        key_file = self._get_key_file(provider_id)
        return os.path.exists(key_file)
    
    async def delete_key(self, provider_id: str) -> bool:
        """Delete encrypted key file."""
        try:
            import os
            key_file = self._get_key_file(provider_id)
            
            if os.path.exists(key_file):
                os.remove(key_file)
                logger.info(f"Deleted encrypted key file for provider: {provider_id}")
            
            return True
            
        except Exception as e:
            logger.error(f"Failed to delete encrypted key for {provider_id}: {e}")
            return False
    
    async def list_providers(self) -> list[str]:
        """List providers with encrypted key files."""
        try:
            providers = []
            for file_path in self.storage_dir.glob("*.key"):
                provider_id = file_path.stem
                providers.append(provider_id)
            return providers
        except Exception as e:
            logger.error(f"Failed to list providers: {e}")
            return []


# Global storage instance
_storage_instance: Optional[SecretStorage] = None


def get_secret_storage(prefer_keyring: bool = True) -> SecretStorage:
    """Get the secret storage instance (singleton)."""
    global _storage_instance
    
    if _storage_instance is not None:
        return _storage_instance
    
    if prefer_keyring:
        try:
            # Test keyring availability
            test_service = "claude-throne-test"
            test_account = "test-account"
            keyring.set_password(test_service, test_account, "test")
            keyring.delete_password(test_service, test_account)
            
            _storage_instance = KeyringStorage()
            logger.info("Using OS keyring for secure storage")
            
        except Exception as e:
            logger.warning(f"Keyring not available ({e}), falling back to encrypted file storage")
            _storage_instance = EncryptedFileStorage()
    else:
        _storage_instance = EncryptedFileStorage()
        logger.info("Using encrypted file storage")
    
    return _storage_instance
