"""Offline client tests."""

from io import BytesIO

import pytest

from discord_mock_client import DiscordMockClient


def test_rejects_remote_urls() -> None:
    with pytest.raises(ValueError, match="local HTTP"):
        DiscordMockClient("https://discord.com")

    with pytest.raises(ValueError, match="local HTTP"):
        DiscordMockClient("http://example.com")


def test_health_with_fake_transport() -> None:
    requests: list[str] = []

    def fake_opener(url: str, *, timeout: int) -> BytesIO:
        assert timeout == 5
        requests.append(url)
        return BytesIO(b'{"status": "ok", "service": "discord-mock"}')

    client = DiscordMockClient(opener=fake_opener)
    assert client.health() == {"status": "ok", "service": "discord-mock"}
    assert requests == ["http://127.0.0.1:3000/health"]
