import { EmbedBuilder, SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { container } from '../container.js';
import { getLevel } from '@ex/db';

export const data = new SlashCommandBuilder()
  .setName('レベル確認')
  .setDescription('レベルの確認をします');

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const dataStore = container.current?.getDataStore()
  if (!dataStore) return

  const guild = interaction.guild
  if (!guild) return


  const model = await dataStore.do(async (db) => 
    await getLevel(db, {serverId: guild.id, userId: interaction.user.id})

  )
  if (!model) return
  
  const embed = new EmbedBuilder()
  embed.setTitle(`${interaction.user.displayName} | lvl`)
  embed.addFields({name: "今のレベルはこれだ", value: model.lvl.toString()})
  embed.setFooter({text: `by ${interaction.user.id}`})
  await interaction.reply({embeds: [embed]});
}
