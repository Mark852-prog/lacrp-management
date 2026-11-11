const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { guard } = require('../lib/permissions');
const manual = require('../lib/manualLinks');

const data = new SlashCommandBuilder()
  .setName('manual-unverify')
  .setDescription('Remove a manual Roblox link made with /manual-verify.')
  .addUserOption((o) => o.setName('member').setDescription('The Discord member').setRequired(true));

async function execute(interaction) {
  if (!(await guard(interaction, 'highRank'))) return;
  const user = interaction.options.getUser('member');
  const existing = manual.byDiscord(user.id);
  const content = existing && manual.unlink(user.id)
    ? `Removed the manual link between <@${user.id}> and **${existing.roblox_name ?? existing.roblox_id}**. If they're linked through Bloxlink, that link is used again.`
    : `<@${user.id}> has no manual link.`;
  return interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
}

module.exports = { data, execute };
