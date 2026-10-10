const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { guard } = require('../lib/permissions');
const { lowActivityMessage } = require('../lib/alerts');
const { postToSessions } = require('../lib/sessionPost');
const erlc = require('../lib/erlc');

const data = new SlashCommandBuilder()
  .setName('session-low-activity')
  .setDescription('Post a "low player activity" nudge to get more people in-game.');

async function execute(interaction) {
  if (!(await guard(interaction, 'staff'))) return;
  const server = await erlc.getServerCached(['Players']).catch(() => null);
  const msg = await postToSessions(interaction, lowActivityMessage(interaction.guild, server));
  if (!msg) return;
  return interaction.reply({ content: `📣 Low-activity notice posted in ${msg.channel}.`, flags: MessageFlags.Ephemeral });
}

module.exports = { data, execute };
