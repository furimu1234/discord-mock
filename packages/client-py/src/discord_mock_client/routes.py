"""Opt-in discord.py REST route redirection for a single offline test process.

discord.http.Route is an SDK implementation detail, not a documented stable API.
Do not use this context manager concurrently with production clients.
"""

from __future__ import annotations

from contextlib import contextmanager
from typing import Iterator
from urllib.parse import urlsplit

_active = False


@contextmanager
def mock_routes(base_url: str = "http://127.0.0.1:3000") -> Iterator[None]:
    """Temporarily redirect discord.py's REST Route.BASE to a local mock.

    Restores the original on exit, including exceptions. Must be used *before*
    Client.login()/start(). Does not patch another Discord connection outside the
    scope. Gateway discovery relies on the mock's /gateway endpoint.
    """
    global _active
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
        raise ValueError("Mock URL must be a loopback HTTP base")
    if _active:
        raise RuntimeError("Only one discord.py mock_routes context may be active")

    from discord.http import Route

    # Deliberately version-bound SDK seam, not Discord's private API.
    original = Route.BASE
    _active = True
    try:
        Route.BASE = f"{base_url.rstrip('/')}/api/v10"
        yield
    finally:
        Route.BASE = original
        _active = False
