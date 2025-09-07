"""
Proxy process management for Claude-Throne.
"""

import os
import socket
import subprocess
import time
from dataclasses import dataclass
from typing import Optional, Dict


@dataclass
class ProxyProcessInfo:
    pid: int
    port: int
    started_at: float


class ProxyController:
    def __init__(self) -> None:
        self._proc: Optional[subprocess.Popen] = None
        self._info: Optional[ProxyProcessInfo] = None

    @property
    def is_running(self) -> bool:
        return self._proc is not None and self._proc.poll() is None

    @property
    def info(self) -> Optional[ProxyProcessInfo]:
        return self._info if self.is_running else None

    def _wait_for_port(self, host: str, port: int, timeout: float = 10.0) -> bool:
        deadline = time.time() + timeout
        while time.time() < deadline:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.settimeout(0.2)
                try:
                    s.connect((host, port))
                    return True
                except Exception:
                    time.sleep(0.1)
        return False

    def start(self, env: Dict[str, str], port: int) -> ProxyProcessInfo:
        if self.is_running:
            return self._info  # type: ignore

        # Resolve repo root (five levels up from this file)
        # .../backends/python/ct_secretsd/ct_secretsd/proxy_controller.py -> repo root is parents[4]
        repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), '../../../../..'))

        self._proc = subprocess.Popen(
            ["node", "index.js"],
            cwd=repo_root,
            env={**os.environ, **env},
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        started_at = time.time()

        # Wait until the port is accepting connections
        if not self._wait_for_port("127.0.0.1", port, timeout=15.0):
            # If it didn't start correctly, terminate
            try:
                self._proc.terminate()  # type: ignore
            except Exception:
                pass
            raise RuntimeError("Proxy failed to start or port did not open in time")

        self._info = ProxyProcessInfo(pid=self._proc.pid, port=port, started_at=started_at)  # type: ignore
        return self._info

    def stop(self) -> bool:
        if not self._proc:
            return True
        try:
            self._proc.terminate()
            self._proc.wait(timeout=5)
        except Exception:
            try:
                self._proc.kill()
            except Exception:
                pass
        finally:
            stopped = self._proc.poll() is not None
            self._proc = None
            self._info = None
            return stopped

