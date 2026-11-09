const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { guard } = require('../lib/permissions');
const { rolesFor } = require('../lib/pings');
const { buildStartPost } = require('../lib/sessionUi');
const { activeSession, startSession } = require('../lib/sessions');
const { postToSessions } = require('../lib/sessionPost');
const { closeOpenVotes } = require('./session-vote');
const { run } = require('../lib/db');
const erlc = require('../lib/erlc');

const data = new SlashCommandBuilder()
  .setName('session-start')
  .setDescription('Start a session and announce it.')
  .addStringOption((o) => o.setName('note').setDescription('Optional message for players').setMaxLength(500));

async function execute(interaction) {
  if (!(await guard(interaction, 'supervisor'))) return;
  const current = activeSession();
  if (current) {
    return interaction.reply({ content: `A session is already running (hosted by <@${current.host_id}>). End it with \`/session-end\` first.`, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const server = await erlc.getServerCached(['Players', 'Queue']).catch(() => null);

  const payload = buildStartPost({
    pingRoles: rolesFor('session_start'),
    host: interaction.user.id,
    serverInfo: server,
    code: server?.JoinKey,
    note: interaction.options.getString('note'),
  });
  const channel = await postToSessions(interaction, payload);
  if (!channel) return;
  const session = startSession(interaction.user.id);
  run('UPDATE sessions SET channel_id = ?, message_id = ? WHERE id = ?', channel.channel.id, channel.id, session.id);
  // The session has started, so any open "do you want a session" vote is finished.
  await closeOpenVotes(interaction.client).catch((err) => console.warn('[vote close]', err.message));
  return interaction.editReply(`Session started and announced in ${channel.channel}.`);
}

module.exports = { data, execute };
