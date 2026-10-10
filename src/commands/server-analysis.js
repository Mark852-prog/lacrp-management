const { SlashCommandBuilder } = require('discord.js');
const { guard } = require('../lib/permissions');
const { serverAnalysis } = require('../services/analysis');

const data = new SlashCommandBuilder()
  .setName('server-analysis')
  .setDescription('Server population, session and moderation analytics with charts.')
  .addIntegerOption((o) => o.setName('days').setDescription('How far back to look (default 30)')
    .addChoices({ name: '7 days', value: 7 }, { name: '30 days', value: 30 }, { name: '90 days', value: 90 }, { name: '180 days', value: 180 }, { name: '365 days', value: 365 }));

async function execute(interaction) {
  if (!(await guard(interaction, 'highRank'))) return;
  await interaction.deferReply();
  const days = interaction.options.getInteger('days') ?? 30;
  try {
    const result = await serverAnalysis(interaction.guild, days);
    if (result.empty) return interaction.editReply('📭 Not enough data yet — the bot needs to run for a while to collect history.');
    return interaction.editReply({ ...result, allowedMentions: { parse: [] } });
  } catch (err) {
    console.error('[server-analysis]', err);
    return interaction.editReply(`❌ Couldn't build the analysis: ${err.message}`);
  }
}

module.exports = { data, execute };
