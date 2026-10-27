import { createLeveling, getLevel, updateLeveling } from '@ex/db';
import { Events, type Message } from 'discord.js';
import { container } from '../container';

export const name = Events.MessageCreate;
export const once = false;
export async function execute(message: Message): Promise<void> {
  if (!container.current) return;

  // Upstream accidentally processed only bot messages. Level human users.
  if (message.author.bot) return;

  const store = container.current.getDataStore();

  if (!message.guild) return;
  const guild = message.guild;

  await store.do(async (db) => {
    let model = await getLevel(db, {
      serverId: guild.id,
      userId: message.author.id,
    });

    if (!model) {
      await createLeveling(db, {
        lvl: 1,
        serverId: guild.id,
        userId: message.author.id,
      });
      model = await getLevel(db, {
        serverId: guild.id,
        userId: message.author.id,
      });
    }
    if (!model) return;
    await updateLeveling(db, model.lvl + 1, guild.id, message.author.id);
  });
}
