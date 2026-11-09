const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { guard } = require('../lib/permissions');
const { formatDuration } = require('../lib/embeds');
const { buildEndedPost } = require('../lib/sessionUi');
const { activeSession, endSession, sessionStats } = require('../lib/sessions');
const { postToSessions } = require('../lib/sessionPost');
const { rolesFor } = require('../lib/pings');

const data = new SlashCommandBuilder()
  .setName('session-end')
  .setDescription('End the current session and post a summary.')
  .addStringOption((o) => o.setName('note').setDescription('Optional closing message').setMaxLength(500));

async function execute(interaction) {
  if (!(await guard(interaction, 'supervisor'))) return;
  const session = activeSession();
  if (!session) return interaction.reply({ content: 'There is no session running.', flags: MessageFlags.Ephemeral });
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const ended = endSession(session.id, interaction.user.id);
  const stats = sessionStats(ended);
  const post = buildEndedPost({
    pingRoles: rolesFor('session_end'),
    host: ended.host_id,
    duration: formatDuration(stats.duration),
    peakPlayers: ended.peak_players,
    uniquePlayers: stats.uniquePlayers,
    note: interaction.options.getString('note'),
  });
  const msg = await postToSessions(interaction, post);
  if (!msg) return;
  return interaction.editReply(`Session ended. Summary posted in ${msg.channel}.`);
}

module.exports = { data, execute };
