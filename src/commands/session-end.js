const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { guard } = require('../lib/permissions');
const { formatDuration, ts } = require('../lib/embeds');
const { sessionCard, sessionButtons } = require('../lib/sessionUi');
const { activeSession, endSession, sessionStats } = require('../lib/sessions');
const { postToSessions } = require('../lib/sessionPost');
const { withPing } = require('../lib/pings');

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
  const note = interaction.options.getString('note');
  const { top, main, files } = sessionCard();
  main.setTitle('🔴 Session Ended')
    .setDescription(
      '**This session has ended — thank you to everyone who joined!**\n' +
      'Want to know when the next one starts? Tap the button below.' +
      (note ? `\n\n> ${note.replace(/\n/g, '\n> ')}` : ''),
    )
    .addFields(
      { name: 'Host', value: `<@${ended.host_id}>`, inline: true },
      { name: 'Duration', value: `**${formatDuration(stats.duration)}**`, inline: true },
      { name: 'Ran', value: `${ts(ended.started_at, 't')} – ${ts(ended.ended_at, 't')}`, inline: true },
      { name: 'Peak players', value: `**${ended.peak_players}**`, inline: true },
      { name: 'Unique players', value: `**${stats.uniquePlayers}**`, inline: true },
      { name: 'Avg players', value: `**${stats.avgPlayers}**`, inline: true },
    );
  if (stats.timeToFill != null) main.addFields({ name: 'Time to fill', value: formatDuration(stats.timeToFill), inline: true });

  const msg = await postToSessions(interaction, withPing({ embeds: [top, main], files, components: sessionButtons(null) }, 'session_end'));
  if (!msg) return;
  return interaction.editReply(`✅ Session ended. Summary posted in ${msg.channel}.`);
}

module.exports = { data, execute };
