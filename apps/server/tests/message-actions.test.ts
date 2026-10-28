import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const { startMock } = createRequire(import.meta.url)("../dist/server.cjs");

async function browser(mock, username: string) {
  const response = await fetch(`${mock.url}/_ui/session`);
  const { csrf, users } = await response.json();
  const headers = {
    cookie: response.headers.get("set-cookie").split(";")[0],
    "content-type": "application/json",
    "x-discord-mock-csrf": csrf,
  };
  const user = users.find((user) => user.username === username);
  assert.ok(user);
  assert.equal(
    (
      await fetch(`${mock.url}/_ui/identity`, {
        method: "POST",
        headers,
        body: JSON.stringify({ user_id: user.id }),
      })
    ).status,
    200,
  );
  return { headers, user };
}

test("本人のみ編集でき、削除は本人またはロール権限を検証しJSONにも保存する", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mock-message-actions-"));
  const statePath = join(dir, "state.json");
  let mock = await startMock({ port: 0, statePath });
  try {
    const bob = await browser(mock, "Bob");
    const charlie = await browser(mock, "Charlie");
    const channel = mock.testing.channels.findByName("general");
    const message = await mock.testing
      .as(bob.user)
      .sendMessage(channel.id, "最初の本文");
    const url = `${mock.url}/_ui/messages/${channel.id}/${message.id}`;
    const patch = (headers, content) =>
      fetch(url, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ content, user_id: bob.user.id }),
      });
    assert.equal((await fetch(url)).status, 401);
    assert.equal(
      (await patch({ ...bob.headers, "x-discord-mock-csrf": "wrong" }, "偽装"))
        .status,
      403,
    );
    assert.equal(
      (await patch({ ...bob.headers, origin: "https://example.com" }, "偽装"))
        .status,
      403,
    );
    assert.equal((await patch(charlie.headers, "他人の編集")).status, 403);
    assert.equal(
      (await fetch(url, { method: "DELETE", headers: charlie.headers })).status,
      403,
    );
    assert.equal((await patch(bob.headers, "x".repeat(2001))).status, 400);
    assert.equal((await patch(bob.headers, " ")).status, 400);
    const edited = await patch(bob.headers, "<script>編集した本文</script>");
    assert.equal(edited.status, 200);
    assert.equal((await edited.json()).canEdit, true);
    assert.ok(mock.testing.snapshot().messages[channel.id][0].edited_timestamp);
    const second = await mock.testing
      .as(bob.user)
      .sendMessage(channel.id, "削除対象");
    const secondUrl = `${mock.url}/_ui/messages/${channel.id}/${second.id}`;
    const role = await mock.testing.roles.create({
      name: "メッセージ管理",
      permissions: "8192",
    });
    await mock.testing.members.addRole(charlie.user.id, role.id);
    const available = await (
      await fetch(url, { headers: charlie.headers })
    ).json();
    assert.equal(available.canEdit, false);
    assert.equal(available.canDelete, true);
    assert.equal(
      (await patch(charlie.headers, "管理者による編集")).status,
      403,
    );
    assert.equal(
      (await fetch(secondUrl, { method: "DELETE", headers: charlie.headers }))
        .status,
      200,
    );
    assert.equal(
      (await fetch(secondUrl, { headers: charlie.headers })).status,
      404,
    );

    const hidden = await mock.testing.channels.create({
      name: "非公開",
      permissionOverwrites: [
        { id: charlie.user.id, type: 1, allow: "0", deny: "1024" },
      ],
    });
    const secret = await mock.testing
      .as(bob.user)
      .sendMessage(hidden.id, "閲覧不可");
    const hiddenUrl = `${mock.url}/_ui/messages/${hidden.id}/${secret.id}`;
    for (const method of ["GET", "PATCH", "DELETE"]) {
      assert.equal(
        (
          await fetch(hiddenUrl, {
            method,
            headers: charlie.headers,
            ...(method === "PATCH"
              ? { body: JSON.stringify({ content: "不可" }) }
              : {}),
          })
        ).status,
        403,
      );
    }
    const own = await mock.testing
      .as(bob.user)
      .sendMessage(channel.id, "自分で削除");
    assert.equal(
      (
        await fetch(`${mock.url}/_ui/messages/${channel.id}/${own.id}`, {
          method: "DELETE",
          headers: bob.headers,
        })
      ).status,
      200,
    );
    await mock.close();
    mock = await startMock({ port: 0, statePath });
    const restored = mock.testing.snapshot().messages[channel.id];
    assert.equal(restored.length, 1);
    assert.equal(restored[0].content, "<script>編集した本文</script>");
    assert.ok(restored[0].edited_timestamp);
  } finally {
    await mock.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("実行結果のメッセージは実行IDで分離し、進捗更新後も編集・削除を維持する", async () => {
  const mock = await startMock({ port: 0 });
  try {
    const bob = await browser(mock, "Bob");
    const charlie = await browser(mock, "Charlie");
    const channel = mock.testing.channels.findByName("general");
    const message = await mock.testing
      .as(bob.user)
      .sendMessage(channel.id, "元の本文");
    const hidden = await mock.testing.channels.create({
      name: "隠す",
      permissionOverwrites: [
        { id: charlie.user.id, type: 1, allow: "0", deny: "1024" },
      ],
    });
    await mock.testing.as(bob.user).sendMessage(hidden.id, "隠した本文");
    const snapshot = mock.testing.snapshot();
    const admin = await fetch(`${mock.url}/_admin/session`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-discord-mock-local": "1",
      },
      body: "{}",
    });
    const headers = {
      cookie: admin.headers.get("set-cookie").split(";")[0],
      "content-type": "application/json",
      "x-discord-mock-admin-csrf": (await admin.json()).csrf,
    };
    const publish = (id?: string) =>
      fetch(`${mock.url}/_admin/test-runs${id ? `/${id}` : ""}`, {
        method: id ? "PUT" : "POST",
        headers,
        body: JSON.stringify({ name: "UT", snapshot }),
      });
    const first = await (await publish()).json();
    const second = await (await publish()).json();
    const url = `${mock.url}/_ui/messages/${channel.id}/${message.id}?runId=${first.id}`;
    assert.equal(
      (
        await fetch(url, {
          method: "PATCH",
          headers: charlie.headers,
          body: JSON.stringify({ content: "他人" }),
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(url, {
          method: "PATCH",
          headers: bob.headers,
          body: JSON.stringify({ content: "編集後" }),
        })
      ).status,
      200,
    );
    assert.equal((await publish(first.id)).status, 200);
    assert.equal(
      (await (await fetch(url, { headers: bob.headers })).json()).content,
      "編集後",
    );
    const otherUrl = `${mock.url}/_ui/messages/${channel.id}/${message.id}?runId=${second.id}`;
    assert.equal(
      (await (await fetch(otherUrl, { headers: bob.headers })).json()).content,
      "元の本文",
    );
    assert.equal(
      (await fetch(url, { method: "DELETE", headers: bob.headers })).status,
      200,
    );
    await publish(first.id);
    assert.equal((await fetch(url, { headers: bob.headers })).status, 404);
    const filtered = await (
      await fetch(`${mock.url}/_ui/test-runs/${first.id}`, {
        headers: charlie.headers,
      })
    ).json();
    assert.equal(filtered.messages[hidden.id], undefined);
    assert.equal(
      filtered.guild.channels.some((item) => item.id === hidden.id),
      false,
    );
    assert.equal(filtered.database, undefined);
    // 実行後にAppで付けたロールも過去のメッセージ操作に反映される。
    const role = await mock.testing.roles.create({
      name: "履歴の管理者",
      permissions: "8192",
    });
    await mock.testing.members.addRole(charlie.user.id, role.id);
    const allowed = await (
      await fetch(otherUrl, { headers: charlie.headers })
    ).json();
    assert.equal(allowed.canEdit, false);
    assert.equal(allowed.canDelete, true);
    assert.equal(
      (await fetch(otherUrl, { method: "DELETE", headers: charlie.headers }))
        .status,
      200,
    );
    await publish(second.id);
    assert.equal(
      (await fetch(otherUrl, { headers: charlie.headers })).status,
      404,
    );
    assert.equal(
      (
        await fetch(
          `${mock.url}/_ui/messages/${hidden.id}/${snapshot.messages[hidden.id][0].id}?runId=${second.id}`,
          { headers: charlie.headers },
        )
      ).status,
      403,
    );
    assert.equal(
      mock.testing.snapshot().messages[channel.id][0].content,
      "元の本文",
      "表示用の編集を通常Mockへ混入させない",
    );
    assert.equal(
      (
        await fetch(
          `${url.replace(first.id, "11111111-1111-4111-8111-111111111111")}`,
          { headers: bob.headers },
        )
      ).status,
      404,
    );
  } finally {
    await mock.close();
  }
});
