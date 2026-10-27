"""Local-only discord.py testing adapters (preview)."""

from .client import (
    DisMockClient,
    DisMockMixin,
    DiscordMockClient,
    dis_mock_class,
    dis_mock_client,
    disMockClass,
    disMockClient,
)

__all__ = [
    "DisMockClient",
    "DisMockMixin",
    "DiscordMockClient",
    "disMockClass",
    "disMockClient",
    "dis_mock_class",
    "dis_mock_client",
]
