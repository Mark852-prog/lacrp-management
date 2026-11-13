const { SlashCommandBuilder, MessageFlags, EmbedBuilder } = require('discord.js');
const { guard } = require('../lib/permissions');
require('../lib/accessLog');
const { all } = require('../lib/db');
const { BRAND_COLOR } = require('../lib/embeds');

const data = new SlashCommandBuilder()
  .setName('access-log')
  .setDescription('See who opened handbooks / panel buttons.')
  .addUserOption((o) => o.setName('member').setDescription('Only this member'))
  .addStringOption((o) => o.setName('item').setDescription('Only items containing this text, e.g. handbook'))
  .addIntegerOption((o) => o.setName('limit').setDescription('How many entries (default 25)').setMinValue(1).setMaxValue(50));

async function execute(interaction) {
  if (!(await guard(interaction, 'highRank'))) return;
  const user = interaction.options.getUser('member');
  const item = interaction.options.getString('item');
  const limit = interaction.options.getInteger('limit') ?? 25;
  const rows = all(
    `SELECT * FROM embed_access WHERE (? IS NULL OR user_id = ?) AND (? IS NULL OR item LIKE ? OR embed_name LIKE ?) ORDER BY id DESC LIMIT ?`,
    user?.id ?? null, user?.id ?? null, item, `%${item}%`, `%${item}%`, limit,
  );
  const lines = rows.map((r) => `<t:${r.at}:d> <t:${r.at}:t> <@${r.user_id}> opened **${r.item}** (${r.embed_name})`);
  let text = lines.join('\n') || 'No entries yet. Logging started when this update was installed.';
  if (text.length > 4000) text = `${text.slice(0, 3990)}\n...`;
  return interaction.reply({
    embeds: [new EmbedBuilder().setColor(BRAND_COLOR).setTitle('Panel access log').setDescription(text)],
    flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] },
  });
}

module.exports = { data, execute };
