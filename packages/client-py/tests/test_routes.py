"""Route replacement is opt-in, local-only and restored afterwards."""

import pytest

from discord_mock_client.routes import mock_routes


def test_patch_only_inside_context() -> None:
    from discord.http import Route

    original = Route.BASE
    with mock_routes("http://127.0.0.1:3000"):
        assert Route.BASE == "http://127.0.0.1:3000/api/v10"
        assert Route("GET", "/users/@me").url.startswith("http://127.0.0.1:3000/api/v10/")
        with pytest.raises(RuntimeError, match="Only one"):
            with mock_routes():
                pass
    assert Route.BASE == original


def test_patch_restores_on_error_and_blocks_remote() -> None:
    from discord.http import Route

    original = Route.BASE
    with pytest.raises(ValueError, match="loopback"):
        with mock_routes("https://discord.com"):
            pass
    with pytest.raises(ZeroDivisionError):
        with mock_routes():
            1 / 0
    assert Route.BASE == original
