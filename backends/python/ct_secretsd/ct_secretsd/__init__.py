"""
Claude-Throne Secrets Daemon

Secure API key storage and provider validation service for Claude-Throne VS Code extension.
"""

__version__ = "0.1.0"
__author__ = "The Hive"
__email__ = "contact@thehive.ai"

from .app import create_app
from .main import cli

__all__ = ["create_app", "cli", "__version__"]
