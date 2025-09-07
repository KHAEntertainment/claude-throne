#!/usr/bin/env python3
"""
Claude-Throne Secrets Daemon (ct-secretsd)
Secure API key storage and provider validation service for Claude-Throne VS Code extension.
"""

import asyncio
import logging
import secrets
from pathlib import Path
from typing import Optional

import typer
import uvicorn
from pythonjsonlogger import jsonlogger

from .app import create_app


def setup_logging(level: str = "INFO", json_logs: bool = True) -> None:
    """Configure structured logging."""
    log_level = getattr(logging, level.upper())
    
    if json_logs:
        formatter = jsonlogger.JsonFormatter(
            fmt="%(asctime)s %(name)s %(levelname)s %(message)s",
            datefmt="%Y-%m-%d %H:%M:%S"
        )
    else:
        formatter = logging.Formatter(
            "%(asctime)s - %(name)s - %(levelname)s - %(message)s"
        )
    
    handler = logging.StreamHandler()
    handler.setFormatter(formatter)
    
    logger = logging.getLogger()
    logger.setLevel(log_level)
    logger.addHandler(handler)
    
    # Quiet down external libraries
    logging.getLogger("uvicorn").setLevel(logging.WARNING)
    logging.getLogger("fastapi").setLevel(logging.WARNING)


def cli(
    host: str = typer.Option("127.0.0.1", "--host", "-h", 
                            help="Host to bind to (security: localhost only)"),
    port: int = typer.Option(0, "--port", "-p", 
                            help="Port to bind to (0 for random available port)"),
    auth_token: Optional[str] = typer.Option(None, "--auth-token", "-t",
                                           help="Bearer token for API authentication"),
    log_level: str = typer.Option("INFO", "--log-level", "-l",
                                 help="Logging level"),
    json_logs: bool = typer.Option(True, "--json-logs/--text-logs",
                                  help="Use JSON structured logging"),
    dev_mode: bool = typer.Option(False, "--dev", 
                                 help="Development mode (load .env file)"),
) -> None:
    """
    Start the Claude-Throne Secrets Daemon.
    
    This service provides secure API key storage and provider validation
    for the Claude-Throne VS Code extension.
    
    Security Features:
    - Binds to localhost only (127.0.0.1)
    - Requires bearer token authentication 
    - Uses OS keyring for secret storage
    - Never logs API keys or sensitive data
    """
    if host != "127.0.0.1":
        typer.echo("⚠️  Security Warning: Only 127.0.0.1 binding is supported", err=True)
        typer.echo("   This service handles sensitive API keys and must not be exposed", err=True)
        raise typer.Exit(1)
    
    # Setup logging
    setup_logging(log_level, json_logs)
    logger = logging.getLogger(__name__)
    
    # Generate auth token if not provided
    if not auth_token:
        auth_token = secrets.token_urlsafe(32)
        logger.info(f"Generated auth token: {auth_token}")
    
    # Load environment in dev mode
    if dev_mode:
        try:
            from dotenv import load_dotenv
            env_path = Path(__file__).parent.parent / ".env"
            if env_path.exists():
                load_dotenv(env_path)
                logger.info("Loaded .env file for development")
        except ImportError:
            logger.warning("python-dotenv not available, skipping .env loading")
    
    # Create FastAPI app
    app = create_app(auth_token=auth_token)
    
    # Configure uvicorn
    config = uvicorn.Config(
        app,
        host=host,
        port=port,
        log_level=log_level.lower(),
        access_log=False,  # We handle logging in FastAPI
        server_header=False,
        date_header=False,
    )
    
    logger.info(f"🔐 Claude-Throne Secrets Daemon starting on {host}:{port or 'random'}")
    logger.info(f"🛡️  Authentication: Bearer token required")
    logger.info(f"📊 Log level: {log_level}")
    
    # Start server
    server = uvicorn.Server(config)
    
    try:
        asyncio.run(server.serve())
    except KeyboardInterrupt:
        logger.info("👑 Claude-Throne Secrets Daemon shutting down gracefully")
    except Exception as e:
        logger.error(f"Failed to start server: {e}")
        raise typer.Exit(1)


if __name__ == "__main__":
    typer.run(cli)
