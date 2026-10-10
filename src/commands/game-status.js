const { SlashCommandBuilder } = require('discord.js');
const erlc = require('../lib/erlc');
const { brand, ts, formatDuration } = require('../lib/embeds');
const { activeSession, upcomingScheduled } = require('../lib/sessions');
const { now } = require('../lib/db');

const data = new SlashCommandBuilder().setName('game-status').setDescription('Current in-game server and session status.');

async function execute(interaction) {
  await interaction.deferReply();
  let server;
  try {
    server = await erlc.getServerCached(['Players', 'Queue']);
  } catch (err) {
    return interaction.editReply(`❌ Couldn't reach the ER:LC server: ${err.message}`);
  }
  const players = server.Players ?? [];
  const staff = players.filter((p) => p.Permission && p.Permission !== 'Normal').length;
  const queue = Array.isArray(server.Queue) ? server.Queue.length : 0;
  const session = activeSession();
  const next = upcomingScheduled().find((s) => s.scheduled_for > now());

  const { embed, files } = brand({ guild: interaction.guild });
  embed.setTitle(`🎮 ${server.Name ?? 'Game Status'}`).addFields(
    { name: 'Players', value: `**${server.CurrentPlayers}/${server.MaxPlayers}**`, inline: true },
    { name: 'Queue', value: `**${queue}**`, inline: true },
    { name: 'Staff in-game', value: `**${staff}**`, inline: true },
    { name: 'Join code', value: `\`${server.JoinKey}\``, inline: true },
    { name: 'Session', value: session ? `🟢 Active — hosted by <@${session.host_id}>, running ${formatDuration(now() - session.started_at)}` : '🔴 No session running', inline: false },
  );
  if (next) embed.addFields({ name: 'Next scheduled session', value: `${ts(next.scheduled_for, 'F')} (${ts(next.scheduled_for, 'R')}) — <@${next.host_id}>` });
  return interaction.editReply({ embeds: [embed], files, allowedMentions: { parse: [] } });
}

module.exports = { data, execute };
