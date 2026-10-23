const { SlashCommandBuilder } = require('discord.js');
const { formatDuration, ts } = require('../lib/embeds');
const { sessionCard, sessionButtons, players } = require('../lib/sessionUi');
const { activeSession, sessionStats, upcomingScheduled } = require('../lib/sessions');
const { now } = require('../lib/db');
const erlc = require('../lib/erlc');
const { guard } = require('../lib/permissions');

const data = new SlashCommandBuilder().setName('session-status').setDescription('Live status of the current session.');

async function execute(interaction) {
  if (!(await guard(interaction, 'supervisor'))) return;
  await interaction.deferReply();
  const session = activeSession();
  const server = await erlc.getServerCached(['Players', 'Queue']).catch(() => null);
  const { top, main, files } = sessionCard();

  if (!session) {
    const next = upcomingScheduled().find((s) => s.scheduled_for > now());
    main.setTitle('🔴 No Session Running')
      .setDescription('**There is no active session right now.**\nKeep an eye on this channel — tap below to get pinged when the next one starts!');
    if (next) main.addFields({ name: 'Next scheduled session', value: `${ts(next.scheduled_for, 'F')} (${ts(next.scheduled_for, 'R')}) — hosted by <@${next.host_id}>` });
    return interaction.editReply({ embeds: [top, main], files, components: sessionButtons(null), allowedMentions: { parse: [] } });
  }

  const stats = sessionStats(session);
  const queue = server && Array.isArray(server.Queue) ? server.Queue.length : 0;
  main.setTitle('🟢 Session Live')
    .setDescription(`**The session is live — hosted by <@${session.host_id}>.**\nRunning for **${formatDuration(stats.duration)}** (since ${ts(session.started_at, 't')}).`)
    .addFields(
      { name: 'Players', value: server ? `${players(server)}` : '—' },
      { name: 'Queue', value: `**${queue}**`, inline: true },
      { name: 'Peak', value: `**${session.peak_players}**`, inline: true },
      { name: 'Unique players', value: `**${stats.uniquePlayers}**`, inline: true },
      { name: 'Time to fill', value: stats.timeToFill != null ? formatDuration(stats.timeToFill) : 'Not full yet', inline: true },
      { name: 'Join code', value: server ? `\`${server.JoinKey}\`` : '—', inline: true },
    );
  return interaction.editReply({ embeds: [top, main], files, components: sessionButtons(server?.JoinKey), allowedMentions: { parse: [] } });
}

module.exports = { data, execute };
