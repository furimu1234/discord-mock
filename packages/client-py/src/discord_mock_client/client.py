"""Local-only health and SDK event adapters.

The adapters never call a real Discord login, REST, Gateway or Voice endpoint.
Full Discord protocol compatibility is not implemented yet.
"""

import json
from typing import Any
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, build_opener


class _RejectRedirects(HTTPRedirectHandler):
    """Prevent a local HTTP health request redirecting to an external host."""

    def redirect_request(
        self, request: Any, fp: Any, code: int, msg: str, headers: Any, newurl: str
    ) -> None:
        return None


def _safe_urlopen(url: str, *, timeout: float) -> Any:
    return build_opener(_RejectRedirects()).open(url, timeout=timeout)


class DiscordMockClient:
    """Minimal local-only transport client retained for existing users."""

    def __init__(
        self, base_url: str = "http://127.0.0.1:3000", *, opener: Any = _safe_urlopen
    ) -> None:
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
        """Read Mock health status without authenticating with Discord."""
        with self._opener(f"{self._base_url}/health", timeout=5) as response:
            data = json.load(response)
        if not isinstance(data, dict) or data.get("status") != "ok":
            raise ValueError("Unexpected health response from discord-mock")
        return data


class DisMockClient(DiscordMockClient):
    """Wrap a discord.Client / commands.Bot instance using its public dispatch API.

    This does not alter the wrapped instance or replace its REST/Gateway/Voice
    connections. Never call the wrapped client's login/run/start in Mock tests.
    """

    def __init__(
        self,
        client: Any,
        *,
        base_url: str = "http://127.0.0.1:3000",
        opener: Any = _safe_urlopen,
    ) -> None:
        if not callable(getattr(client, "dispatch", None)):
            raise TypeError("disMockClient requires a discord.py-style client with dispatch()")
        super().__init__(base_url=base_url, opener=opener)
        self.client = client

    def dispatch(self, event: str, *args: Any, **kwargs: Any) -> None:
        """Schedule an event via client.dispatch('message', message), not 'on_message'."""
        if not isinstance(event, str) or not event or event.startswith("on_"):
            raise ValueError("event must be a name such as 'message', without the 'on_' prefix")
        self.client.dispatch(event, *args, **kwargs)

    def emit(self, event: str, *args: Any, **kwargs: Any) -> None:
        """Alias for dispatch()."""
        self.dispatch(event, *args, **kwargs)


def disMockClient(client: Any, **options: Any) -> DisMockClient:
    """Attach a test controller to an existing discord.py client instance."""
    return DisMockClient(client, **options)


class DisMockMixin:
    """Mix into any discord.Client / commands.Bot descendant.

    Usage: class UtBot(DisMockMixin, MyBot): ...
    """

    @property
    def mock(self) -> DisMockClient:
        controller = getattr(self, "_dis_mock_controller", None)
        if controller is None:
            controller = DisMockClient(self)
            self._dis_mock_controller = controller
        return controller


def disMockClass(base_class: type) -> type:
    """Return a new subclass of an existing Bot class with a .mock property.

    Usage: class UtBot(disMockClass(MyBot)): ...
    """
    if not isinstance(base_class, type) or not callable(getattr(base_class, "dispatch", None)):
        raise TypeError("disMockClass expects a discord.py-style client class")
    if issubclass(base_class, DisMockMixin):
        return base_class
    return type(f"DisMock{base_class.__name__}", (DisMockMixin, base_class), {})


dis_mock_client = disMockClient
dis_mock_class = disMockClass
