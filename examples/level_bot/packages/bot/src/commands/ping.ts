import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';

export const data = new SlashCommandBuilder()
  .setName('コマンドテスト')
  .setDescription('Bot の応答を確認します');

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.reply('成功！');
}
