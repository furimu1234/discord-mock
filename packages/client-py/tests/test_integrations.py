"""Verify the adapters against real discord.py Client and commands.Bot types."""

import asyncio

import discord
import pytest
from discord.ext import commands

from discord_mock_client import (
    DisMockClient,
    DisMockMixin,
    dis_mock_client,
    disMockClass,
    disMockClient,
)


def test_existing_discord_client_instance_is_preserved() -> None:
    client = discord.Client(intents=discord.Intents.none())
    wrapper = disMockClient(client)
    assert isinstance(wrapper, DisMockClient)
    assert wrapper.client is client
    assert dis_mock_client(client).client is client


def test_commands_bot_instance_and_class_inheritance() -> None:
    class MyBot(commands.Bot):
        def my_method(self) -> str:
            return "original"

    client = MyBot(command_prefix="!", intents=discord.Intents.none())
    wrapper = disMockClient(client)
    assert wrapper.client is client

    class UtBot(DisMockMixin, MyBot):
        pass

    bot = UtBot(command_prefix="!", intents=discord.Intents.none())
    assert isinstance(bot, MyBot)
    assert isinstance(bot, commands.Bot)
    assert bot.my_method() == "original"
    assert bot.mock.client is bot
    assert bot.mock is bot.mock

    class UtBotFactory(disMockClass(MyBot)):
        pass

    factory_bot = UtBotFactory(command_prefix="!", intents=discord.Intents.none())
    assert isinstance(factory_bot, MyBot)
    assert factory_bot.mock.client is factory_bot


def test_discord_client_can_receive_dispatched_custom_event_offline() -> None:
    observed = []
    client = discord.Client(intents=discord.Intents.none())

    @client.event
    async def on_mock_test(payload: object) -> None:
        observed.append(payload)

    async def exercise() -> None:
        # discord.Client's public async context manager initializes its event loop.
        async with client:
            wrapper = disMockClient(client)
            wrapper.dispatch("mock_test", {"userId": "dummy-1"})
            await asyncio.sleep(0.05)

    asyncio.run(exercise())
    assert observed == [{"userId": "dummy-1"}]


def test_discord_bot_subclass_receives_event_without_login() -> None:
    observed = []

    class MyBot(commands.Bot):
        async def on_mock_test(self, payload: str) -> None:
            observed.append(payload)

    class UtBot(DisMockMixin, MyBot):
        pass

    bot = UtBot(command_prefix="!", intents=discord.Intents.none())

    async def exercise() -> None:
        async with bot:
            bot.mock.emit("mock_test", "hello")
            await asyncio.sleep(0.05)

    asyncio.run(exercise())
    assert observed == ["hello"]


def test_invalid_client_and_event_are_rejected() -> None:
    with pytest.raises(TypeError, match="dispatch"):
        disMockClient(object())
    with pytest.raises(TypeError, match="client class"):
        disMockClass(object)

    wrapper = disMockClient(discord.Client(intents=discord.Intents.none()))
    with pytest.raises(ValueError, match="without the 'on_' prefix"):
        wrapper.dispatch("on_message", object())
