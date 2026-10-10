const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { guard } = require('../lib/permissions');
const { brand, forEdit, ts } = require('../lib/embeds');
const { sessionCard, sessionButtons } = require('../lib/sessionUi');
const { withPing } = require('../lib/pings');
const { postToSessions } = require('../lib/sessionPost');
const { parseWhen, zone } = require('../lib/time');
const { run, get, all, now } = require('../lib/db');

const data = new SlashCommandBuilder()
  .setName('session-schedule')
  .setDescription('Schedule, list or cancel upcoming sessions.')
  .addSubcommand((s) => s.setName('create').setDescription('Schedule a session and announce it.')
    .addStringOption((o) => o.setName('when').setDescription('e.g. "19:30", "7:30pm", "2h", "2026-10-01 19:30" (server timezone)').setRequired(true))
    .addUserOption((o) => o.setName('host').setDescription('Who will host (default: you)'))
    .addStringOption((o) => o.setName('note').setDescription('Optional details').setMaxLength(500)))
  .addSubcommand((s) => s.setName('list').setDescription('Show upcoming scheduled sessions.'))
  .addSubcommand((s) => s.setName('cancel').setDescription('Cancel a scheduled session.')
    .addIntegerOption((o) => o.setName('id').setDescription('Schedule number from /session-schedule list').setRequired(true)));

function scheduleMessage(guild, s) {
  const { top, main, files } = sessionCard();
  const cancelled = s.status === 'cancelled';
  main.setTitle(cancelled ? '📅 Session Cancelled' : '📅 Session Scheduled')
    .setDescription(cancelled
      ? '**This scheduled session has been cancelled.**\nKeep an eye on this channel for the next one!'
      : '**A session has been scheduled — mark your calendar!**\nTap the button below to get pinged when it goes live.' +
        (s.note ? `\n\n> ${s.note.replace(/\n/g, '\n> ')}` : ''));
  if (!cancelled) {
    main.addFields(
      { name: 'When', value: `${ts(s.scheduled_for, 'F')}\n${ts(s.scheduled_for, 'R')}`, inline: true },
      { name: 'Host', value: `<@${s.host_id}>`, inline: true },
      { name: 'Schedule #', value: `${s.id}`, inline: true },
    );
  }
  return { embeds: [top, main], files, components: cancelled ? [] : sessionButtons(null, { join: false }), allowedMentions: { parse: [] } };
}

async function execute(interaction) {
  const sub = interaction.options.getSubcommand();

  if (sub === 'list') {
    const rows = all("SELECT * FROM scheduled_sessions WHERE status = 'scheduled' AND scheduled_for > ? ORDER BY scheduled_for LIMIT 15", now() - 3600);
    const { embed, files } = brand({ banner: 'sessions', guild: interaction.guild });
    embed.setTitle('📅 Upcoming Sessions').setDescription(
      rows.map((r) => `**#${r.id}** ${ts(r.scheduled_for, 'F')} (${ts(r.scheduled_for, 'R')}) — <@${r.host_id}>`).join('\n') || 'Nothing scheduled.',
    );
    return interaction.reply({ embeds: [embed], files, flags: MessageFlags.Ephemeral });
  }

  if (!(await guard(interaction, 'supervisor'))) return;

  if (sub === 'cancel') {
    const id = interaction.options.getInteger('id');
    const s = get('SELECT * FROM scheduled_sessions WHERE id = ?', id);
    if (!s || s.status !== 'scheduled') return interaction.reply({ content: `No upcoming scheduled session #${id}.`, flags: MessageFlags.Ephemeral });
    run("UPDATE scheduled_sessions SET status = 'cancelled' WHERE id = ?", id);
    if (s.channel_id && s.message_id) {
      const ch = await interaction.client.channels.fetch(s.channel_id).catch(() => null);
      const msg = await ch?.messages.fetch(s.message_id).catch(() => null);
      await msg?.edit(forEdit(scheduleMessage(interaction.guild, { ...s, status: 'cancelled' }))).catch(() => {});
    }
    return interaction.reply({ content: `🗑️ Scheduled session #${id} cancelled.`, flags: MessageFlags.Ephemeral });
  }

  const when = parseWhen(interaction.options.getString('when'));
  if (!when || when < now()) {
    return interaction.reply({ content: `⚠️ Couldn't understand that time (or it's in the past). Try \`19:30\`, \`7:30pm\`, \`2h\` or \`2026-10-01 19:30\` — times are in ${zone()}.`, flags: MessageFlags.Ephemeral });
  }
  const host = interaction.options.getUser('host') ?? interaction.user;
  const note = interaction.options.getString('note');
  const { lastInsertRowid } = run('INSERT INTO scheduled_sessions(host_id, scheduled_for, created_at, note) VALUES(?, ?, ?, ?)', host.id, when, now(), note);
  const s = get('SELECT * FROM scheduled_sessions WHERE id = ?', Number(lastInsertRowid));

  const msg = await postToSessions(interaction, withPing(scheduleMessage(interaction.guild, s), 'session_schedule'));
  if (!msg) {
    run('DELETE FROM scheduled_sessions WHERE id = ?', s.id);
    return;
  }
  run('UPDATE scheduled_sessions SET channel_id = ?, message_id = ? WHERE id = ?', msg.channel.id, msg.id, s.id);
  return interaction.reply({ content: `📅 Scheduled session #${s.id} for ${ts(when, 'F')} announced in ${msg.channel}. The host gets a DM when it's due; if it isn't started within the grace period it counts as a no-show.`, flags: MessageFlags.Ephemeral });
}

module.exports = { data, execute };
