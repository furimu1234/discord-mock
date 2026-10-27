"""Register commands through discord.py's public CommandTree against the local Mock."""

import asyncio
import json
import os
import shutil
import subprocess
from pathlib import Path
from queue import Empty, Queue
from threading import Thread
from urllib.error import HTTPError
from urllib.request import ProxyHandler, Request, build_opener

import aiohttp
import discord
import pytest
from discord import app_commands

from discord_mock_client.routes import mock_routes

APPLICATION_ID = 123456789000000001
GUILD_ID = 123456789000000000


@pytest.fixture
def mock_server():
    bundle = Path(__file__).resolve().parents[3] / "apps/server/dist/server.cjs"
    node = shutil.which("node")
    if node is None or not bundle.is_file():
        pytest.skip("Run pnpm build with Node.js before the REST contract test")
    program = """
    const { startMock } = require(process.argv[1]);
    // Contract fixture only; actual PGlite/pg reads are tested in the JS app suite.
    const database = {
      tables: async () => [{ schema: 'example', name: 'lvl', columnCount: 1 }],
      rows: async (query) => ({
        schema: query.schema, table: query.table,
        columns: [{ name: 'lvl', type: 'integer', nullable: false, primaryKey: false }],
        rows: [[3]], totalRows: 1, offset: 0, limit: query.limit, truncated: false,
      }),
    };
    startMock({ port: 0, database }).then((mock) => {
      console.log(JSON.stringify({ url: mock.url, token: mock.token, adminSecret: mock.adminSecret }));
      process.once('SIGTERM', () => { void mock.close(); });
    }).catch(() => { process.exitCode = 1; });
    """
    process = subprocess.Popen(
        [node, "-e", program, str(bundle)],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        env={**os.environ},
    )
    lines = Queue()
    reader = Thread(target=lambda: lines.put(process.stdout.readline()), daemon=True)
    reader.start()
    try:
        try:
            line = lines.get(timeout=10)
        except Empty:
            pytest.fail("Mock server did not start within 10 seconds")
        if not line:
            pytest.fail("Mock server exited before reporting its address")
        yield json.loads(line)
    finally:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)
        reader.join(timeout=1)
        process.stdout.close()
        process.stderr.close()


def test_command_tree_sync_uses_registered_ids_and_global_guild_scopes(mock_server):
    async def exercise():
        client = discord.Client(intents=discord.Intents.none(), application_id=APPLICATION_ID)
        tree = app_commands.CommandTree(client)

        @tree.command(name="ping", description="Check local Bot response")
        async def ping(interaction: discord.Interaction):
            await interaction.response.send_message("Pong!")

        async with client:
            with mock_routes(mock_server["url"]):
                await client.login(mock_server["token"])
                commands = await tree.sync()
                assert [command.name for command in commands] == ["ping"]
                command_id = commands[0].id
                assert commands[0].application_id == APPLICATION_ID
                assert [command.id for command in await tree.fetch_commands()] == [command_id]
                assert (await tree.sync())[0].id == command_id

                guild = discord.Object(id=GUILD_ID)
                tree.copy_global_to(guild=guild)
                guild_commands = await tree.sync(guild=guild)
                assert guild_commands[0].guild_id == GUILD_ID
                assert guild_commands[0].id != command_id
                assert len(await tree.fetch_commands(guild=guild)) == 1
                tree.clear_commands(guild=None)
                assert await tree.sync() == []
                assert len(await tree.fetch_commands(guild=guild)) == 1

    asyncio.run(exercise())

    request = Request(f"{mock_server['url']}/api/v10/applications/{APPLICATION_ID}/commands")
    with pytest.raises(HTTPError) as error:
        build_opener(ProxyHandler({})).open(request, timeout=3)
    assert error.value.code == 401


def test_admin_database_contract_uses_an_independent_session(mock_server):
    opener = build_opener(ProxyHandler({}))
    base = mock_server["url"]

    def request(path, *, method="GET", body=None, headers=None):
        return opener.open(
            Request(
                f"{base}{path}",
                method=method,
                data=json.dumps(body).encode() if body is not None else None,
                headers={"content-type": "application/json", **(headers or {})},
            ),
            timeout=3,
        )

    with request("/_ui/session") as response:
        dummy_cookie = response.headers["set-cookie"].split(";")[0]
    with pytest.raises(HTTPError) as denied:
        request("/_admin/database/tables", headers={"cookie": dummy_cookie})
    assert denied.value.code == 403
    with request(
        "/_admin/session",
        method="POST",
        body={},
        headers={"x-discord-mock-local": "1", "origin": base},
    ) as response:
        cookie = response.headers["set-cookie"].split(";")[0]
        session = json.load(response)
    assert session["authenticated"] and session["databaseAvailable"]
    with request("/_admin/database/tables", headers={"cookie": cookie}) as response:
        assert json.load(response)["tables"] == [
            {"schema": "example", "name": "lvl", "columnCount": 1}
        ]
    with request(
        "/_admin/database/rows?schema=example&table=lvl&limit=25",
        headers={"cookie": cookie},
    ) as response:
        page = json.load(response)
        assert page["rows"] == [[3]] and page["limit"] == 25
        assert page["columns"][0]["type"] == "integer"
    with pytest.raises(HTTPError) as invalid:
        request(
            "/_admin/database/rows?schema=example&table=lvl&limit=101",
            headers={"cookie": cookie},
        )
    assert invalid.value.code == 400
    with request(
        "/_admin/session",
        method="DELETE",
        headers={"cookie": cookie, "x-discord-mock-admin-csrf": session["csrf"]},
    ) as response:
        assert json.load(response)["authenticated"] is False
    with pytest.raises(HTTPError) as revoked:
        request("/_admin/database/tables", headers={"cookie": cookie})
    assert revoked.value.code == 403


def test_command_reply_metadata_preserves_the_invoking_user(mock_server):
    base = mock_server["url"]

    async def exercise():
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=5)) as client:
            async with client.put(
                f"{base}/api/v10/applications/{APPLICATION_ID}/commands",
                headers={"authorization": f"Bot {mock_server['token']}"},
                json=[{"name": "ping", "description": "Test response metadata"}],
            ) as response:
                assert response.status == 200
            async with client.get(f"{base}/_ui/session") as response:
                dummy = await response.json()
                cookie = response.headers["set-cookie"].split(";")[0]
            headers = {"cookie": cookie, "x-discord-mock-csrf": dummy["csrf"]}
            async with client.ws_connect(f"{base.replace('http:', 'ws:')}/gateway") as ws:
                assert (await ws.receive_json())["op"] == 10
                await ws.send_json(
                    {
                        "op": 2,
                        "d": {
                            "token": mock_server["token"],
                            "intents": 0,
                            "properties": {"os": "test", "browser": "test", "device": "test"},
                        },
                    }
                )
                async with asyncio.timeout(5):
                    while (await ws.receive_json()).get("t") != "GUILD_CREATE":
                        pass
                    async with client.post(
                        f"{base}/_ui/interaction",
                        headers=headers,
                        json={"name": "ping", "channel_id": "123456789000000002"},
                    ) as response:
                        assert response.status == 201
                    interaction = (await ws.receive_json())["d"]
                async with client.post(
                    f"{base}/_ui/identity",
                    headers=headers,
                    json={"user_id": dummy["users"][1]["id"]},
                ) as response:
                    assert response.status == 200
                async with client.post(
                    f"{base}/api/v10/interactions/{interaction['id']}/{interaction['token']}/callback",
                    json={"type": 4, "data": {"content": "Pong!"}},
                ) as response:
                    assert response.status == 204
                async with client.post(
                    f"{base}/api/v10/interactions/{interaction['id']}/{interaction['token']}/callback",
                    json={"type": 4, "data": {"content": "Duplicate reply"}},
                ) as response:
                    assert response.status == 400
                    assert (await response.json())["code"] == 40060
                async with client.get(f"{base}/_ui/state", headers=headers) as response:
                    messages = (await response.json())["messages"]["123456789000000002"]
                    assert len(messages) == 1
                    reply = messages[-1]
                actor_id = dummy["selectedUserId"]
                assert reply["interaction"]["user"]["id"] == actor_id
                assert reply["interaction"]["name"] == "ping"
                assert reply["interaction_metadata"]["id"] == interaction["id"]
                assert reply["interaction_metadata"]["user"]["id"] == actor_id
                assert interaction["token"] not in json.dumps(reply)

    asyncio.run(exercise())
