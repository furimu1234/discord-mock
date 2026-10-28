import { expect, it } from "vitest";
import { Client, Events, GatewayIntentBits } from "discord.js";
import {
  createTestEnvironment,
  type TestRunSummary,
  type TestRunView,
} from "@discord-mock/client-js/testing";

async function adminCookie(url: string): Promise<string> {
  const response = await fetch(`${url}/_admin/session`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-discord-mock-local": "1",
    },
    body: "{}",
  });
  const cookie = response.headers.get("set-cookie")?.split(";", 1)[0];
  if (!cookie) throw new Error("管理セッションを開けませんでした");
  return cookie;
}

it("実際の SDK の操作と返信を別の app へ反映し、SSE で通知する", async () => {
  const app = await createTestEnvironment();
  const sut = await createTestEnvironment({
    reportTo: { baseUrl: app.url, name: "Web で確認する UT" },
  });
  const cookie = await adminCookie(app.url);
  const response = await fetch(`${app.url}/_admin/test-runs/events`, {
    headers: { cookie },
    signal: AbortSignal.timeout(5000),
  });
  const reader = response.body?.getReader();
  if (!reader) throw new Error("SSE を開けませんでした");
  try {
    const before = app.snapshot();
    const changed = (async () => {
      let text = "";
      while (!text.includes("event: changed")) {
        const chunk = await reader.read();
        if (chunk.done) throw new Error("変更通知の前に切断しました");
        text += new TextDecoder().decode(chunk.value);
      }
    })();
    const user = await sut.users.create({ username: "UT 実行者" });
    const channel = await sut.channels.create({ name: "ut-channel" });
    const bot = new Client({ intents: [GatewayIntentBits.Guilds] });
    const failures: unknown[] = [];
    bot.once(Events.ClientReady, (client) => {
      client.application.commands
        .set([{ name: "ping", description: "テスト" }])
        .catch((error: unknown) => failures.push(error));
    });
    bot.on(Events.InteractionCreate, (interaction) => {
      if (interaction.isChatInputCommand())
        interaction
          .reply({
            embeds: [{ title: "UT の返信", footer: { text: "検証用" } }],
          })
          .catch((error: unknown) => failures.push(error));
    });
    await sut.connect(bot);
    await sut.commands.waitFor("ping");
    await sut.as(user).sendMessage(channel.id, "UT の投稿");
    await sut.as(user).runCommand(channel.id, "ping");
    await sut.report({ status: "passed", step: "返信を検証した" });
    await changed;
    await sut.close();
    const { runs } = (await (
      await fetch(`${app.url}/_admin/test-runs`, { headers: { cookie } })
    ).json()) as { runs: TestRunSummary[] };
    expect(runs[0].status).toBe("passed");
    const view = (await (
      await fetch(`${app.url}/_admin/test-runs/${runs[0].id}`, {
        headers: { cookie },
      })
    ).json()) as TestRunView;
    expect(view.messages[channel.id][0].content).toBe("UT の投稿");
    expect(view.messages[channel.id][1].embeds[0].title).toBe("UT の返信");
    expect(view.messages[channel.id][1].interaction?.user.id).toBe(user.id);
    expect(view.steps.map((step) => step.text)).toContain("/ping を実行");
    expect(JSON.stringify(view)).not.toContain(sut.botToken);
    expect(app.snapshot()).toEqual(before);
    expect(failures).toEqual([]);
  } finally {
    await reader.cancel();
    await sut.close();
    await app.close();
  }
});

it("失敗と中断も記録し、表示先への接続失敗を握りつぶさない", async () => {
  const app = await createTestEnvironment();
  try {
    const cancelled = await createTestEnvironment({
      reportTo: { baseUrl: app.url, name: "中断" },
    });
    await cancelled.close();
    const failed = await createTestEnvironment({
      reportTo: { baseUrl: app.url, name: "失敗" },
    });
    await failed.report({ status: "failed", step: "検証失敗" });
    await failed.close();
    const cookie = await adminCookie(app.url);
    const { runs } = (await (
      await fetch(`${app.url}/_admin/test-runs`, { headers: { cookie } })
    ).json()) as { runs: TestRunSummary[] };
    expect(runs.map((run) => run.status)).toEqual(["failed", "cancelled"]);
    await expect(
      createTestEnvironment({
        reportTo: { baseUrl: "https://discord.com", name: "拒否" },
      }),
    ).rejects.toThrow("ループバック");
    const url = app.url;
    await app.close();
    await expect(
      createTestEnvironment({ reportTo: { baseUrl: url, name: "停止済み" } }),
    ).rejects.toThrow("pnpm app");
  } finally {
    await app.close();
  }
});
