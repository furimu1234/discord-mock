import { Client, type ClientOptions } from "discord.js";
import type { SapphireClient } from "@sapphire/framework";
import {
  Client as mockClient,
  disMockClient,
  disMockClientClass,
  disMockMixin,
} from "../src/index.js";

class CustomBot extends Client {
  constructor(
    readonly label: string,
    options: ClientOptions,
  ) {
    super(options);
  }

  customMethod(): string {
    return this.label;
  }
}

function verifyPublicTypes(client: Client, sapphire: SapphireClient): void {
  const wrappedClient: Client = disMockClient(client).client;
  const wrappedSapphire: SapphireClient = disMockClient(sapphire).client;
  wrappedClient.emit("customEvent", { userId: "alice" });
  wrappedSapphire.emit("customEvent", { userId: "alice" });
  const start = mockClient(client, async (original, connect) => {
    const same: Client = original;
    await connect();
    return { same, failures: [] as Error[] };
  });
  const returned: Promise<{ same: Client; failures: Error[] }> =
    start("mock_test");
  void returned;
  const sapphireStart = mockClient(sapphire, async () => ({
    client: sapphire,
  }));
  void sapphireStart;

  class MixedBot extends disMockMixin(CustomBot) {}
  const mixed = new MixedBot("test", { intents: [] });
  const original: CustomBot = mixed;
  const label: string = original.customMethod();
  mixed.mock.dispatch("customEvent", { label });

  const MockBot = disMockClientClass(CustomBot);
  const fromClass: CustomBot = new MockBot("test", { intents: [] });
  fromClass.customMethod();

  // @ts-expect-error The original constructor still requires its label argument.
  new MixedBot({ intents: [] });
}

void verifyPublicTypes;
