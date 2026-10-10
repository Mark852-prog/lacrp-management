const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { guard } = require('../lib/permissions');
const { withPing } = require('../lib/pings');
const { sessionCard, sessionButtons, players } = require('../lib/sessionUi');
const { activeSession, startSession } = require('../lib/sessions');
const { postToSessions } = require('../lib/sessionPost');
const { ts } = require('../lib/embeds');
const { run, now } = require('../lib/db');
const erlc = require('../lib/erlc');

const data = new SlashCommandBuilder()
  .setName('session-start')
  .setDescription('Start a session and announce it.')
  .addStringOption((o) => o.setName('note').setDescription('Optional message for players').setMaxLength(500));

async function execute(interaction) {
  if (!(await guard(interaction, 'supervisor'))) return;
  const current = activeSession();
  if (current) {
    return interaction.reply({ content: `⚠️ A session is already running (hosted by <@${current.host_id}>). End it with \`/session-end\` first.`, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const server = await erlc.getServerCached(['Players', 'Queue']).catch(() => null);
  const note = interaction.options.getString('note');

  const { top, main, files } = sessionCard();
  main.setTitle('🟢 Session Started')
    .setDescription(
      '**A session is now LIVE — come join us!**\n' +
      'Grab your gear, pick a department and hop in-game. Every department is open for roleplay.' +
      (note ? `\n\n> ${note.replace(/\n/g, '\n> ')}` : ''),
    )
    .addFields(
      { name: 'Host', value: `<@${interaction.user.id}>`, inline: true },
      { name: 'Started', value: ts(now(), 'R'), inline: true },
      { name: 'Join code', value: server ? `\`${server.JoinKey}\`` : 'See in-game', inline: true },
    );
  if (server) main.addFields({ name: 'Players', value: `${players(server)}` });

  const payload = withPing({ embeds: [top, main], files, components: sessionButtons(server?.JoinKey) }, 'session_start');
  const channel = await postToSessions(interaction, payload);
  if (!channel) return;
  const session = startSession(interaction.user.id);
  run('UPDATE sessions SET channel_id = ?, message_id = ? WHERE id = ?', channel.channel.id, channel.id, session.id);
  return interaction.editReply(`✅ Session started and announced in ${channel.channel}.`);
}

module.exports = { data, execute };
