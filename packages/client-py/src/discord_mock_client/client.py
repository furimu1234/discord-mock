"""Minimal HTTP health client. Discord protocol compatibility is not implemented."""

import json
from urllib.parse import urlsplit
from urllib.request import urlopen


class DiscordMockClient:
    """Connect to a local discord-mock server, never to production Discord."""

    def __init__(self, base_url: str = "http://127.0.0.1:3000", *, opener=urlopen) -> None:
        parsed = urlsplit(base_url)
        if (
            parsed.scheme != "http"
            or parsed.hostname not in {"127.0.0.1", "localhost", "::1"}
            or parsed.username is not None
            or parsed.password is not None
            or parsed.path not in {"", "/"}
            or parsed.query
            or parsed.fragment
        ):
            raise ValueError("discord-mock must use a local HTTP base URL")
        self._base_url = base_url.rstrip("/")
        self._opener = opener

    def health(self) -> dict[str, str]:
        """Read the Mock health endpoint; no Discord authentication is used."""
        with self._opener(f"{self._base_url}/health", timeout=5) as response:
            data = json.load(response)
        if not isinstance(data, dict) or data.get("status") != "ok":
            raise ValueError("Unexpected health response from discord-mock")
        return data
