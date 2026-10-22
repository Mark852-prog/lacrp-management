// /availability set|view|clear - members save the days and times they can usually play (in their own time)
// /availability poll           - Supervisor+: post a "when can you play this week?" poll
// Everything feeds /session-times (src/lib/availability.js).
const { DateTime } = require('luxon');
const {
  SlashCommandBuilder, MessageFlags, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder,
} = require('discord.js');
const { guard, can } = require('../lib/permissions');
const { BRAND_COLOR, forEdit, ts } = require('../lib/embeds');
const { sessionCard, bar } = require('../lib/sessionUi');
const { withPing } = require('../lib/pings');
const { postToSessions } = require('../lib/sessionPost');
const { config } = require('../lib/config');
const { run, get, all, now } = require('../lib/db');
const av = require('../lib/availability');

const data = new SlashCommandBuilder()
  .setName('availability')
  .setDescription('When can you usually play? Helps staff pick session times.')
  .addSubcommand((s) => s.setName('set').setDescription('Pick the days and times you can usually play (in your own time).')
    .addStringOption((o) => o.setName('timezone').setDescription('Your timezone (default: your timezone role)')
      .addChoices(...av.zones().map((z) => ({ name: `${z.label} — ${z.name}`, value: z.key })))))
  .addSubcommand((s) => s.setName('view').setDescription('See the availability you (or someone else) saved.')
    .addUserOption((o) => o.setName('member').setDescription('Who (default: you)')))
  .addSubcommand((s) => s.setName('clear').setDescription('Delete your saved availability.'))
  .addSubcommand((s) => s.setName('poll').setDescription('Post a "when can you play this week?" poll (Supervisor+).')
    .addStringOption((o) => o.setName('question').setDescription('Question (default: "When can you play this week?")').setMaxLength(200)));

// ---------------------------------------------------------------- editor (ephemeral)
const drafts = new Map(); // userId -> { days: [], blocks: [] } while picking
const draftOf = (id) => drafts.get(id) ?? { days: [], blocks: [] };
const DAY_GROUPS = { wk: [1, 2, 3, 4, 5], we: [6, 7], all: [1, 2, 3, 4, 5, 6, 7] };
const expandDays = (values) => [...new Set(values.flatMap((v) => DAY_GROUPS[v] ?? [Number(v)]))].sort();

function editorPayload(member, notice) {
  const z = av.memberZone(member);
  const draft = draftOf(member.id);
  const saved = av.summaryLines(member.id);
  const embed = new EmbedBuilder().setColor(BRAND_COLOR)
    .setAuthor({ name: member.displayName, iconURL: member.displayAvatarURL() })
    .setTitle('📅 Your Availability')
    .setDescription(
      (z ? `Times are in **your** time: **${z.label}** (${z.name}, ${av.offsetLabel(z.zone)}).\n`
        : '⚠️ **Pick your timezone first** in the third menu, so your times can be converted correctly.\n') +
      '**1.** Pick one or more days  ·  **2.** Pick the times you\'re usually free  ·  **3.** Press **Save**\n' +
      '-# Different times on different days? Save one group of days, then pick the next.',
    )
    .addFields({ name: 'Saved', value: saved.length ? saved.join('\n') : '-# Nothing saved yet.' });
  if (draft.days.length || draft.blocks.length) {
    const days = expandDays(draft.days).map((d) => av.DAYS[d - 1].slice(0, 3)).join(', ') || '—';
    const times = draft.blocks.includes('none') ? 'Not available' : draft.blocks.map((b) => av.blockLabel(Number(b))).join(', ') || '—';
    embed.addFields({ name: 'Ready to save', value: `**Days:** ${days}\n**Times:** ${times}` });
  }
  embed.setFooter({ text: `${config.settings.serverName} · change it any time with /availability set` });

  const daySelect = new StringSelectMenuBuilder().setCustomId('av:days').setPlaceholder('1. Pick day(s)').setMinValues(1).setMaxValues(10)
    .addOptions([
      ...av.DAYS.map((d, i) => ({ label: d, value: String(i + 1), default: draft.days.includes(String(i + 1)) })),
      { label: 'Weekdays (Mon–Fri)', value: 'wk', emoji: '🗓️', default: draft.days.includes('wk') },
      { label: 'Weekend (Sat–Sun)', value: 'we', emoji: '🎉', default: draft.days.includes('we') },
      { label: 'Every day', value: 'all', emoji: '📆', default: draft.days.includes('all') },
    ]);
  const blockSelect = new StringSelectMenuBuilder().setCustomId('av:blocks').setPlaceholder('2. Pick the times you can play').setMinValues(1)
    .setMaxValues(av.blocks().length + 1)
    .addOptions([
      ...av.blocks().map((b) => ({ label: av.blockLabel(b), value: String(b), description: b >= 24 ? 'Late night, after midnight' : undefined, default: draft.blocks.includes(String(b)) })),
      { label: 'Not available these days', value: 'none', emoji: '🚫', default: draft.blocks.includes('none') },
    ]);
  const tzSelect = new StringSelectMenuBuilder().setCustomId('av:tz').setPlaceholder('3. Your timezone')
    .addOptions(av.zones().map((x) => ({ label: `${x.label} — ${x.name}`, value: x.key, default: z?.key === x.key })));
  const ready = z && draft.days.length && draft.blocks.length;
  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('av:save').setLabel('Save for selected days').setStyle(ButtonStyle.Success).setDisabled(!ready),
    new ButtonBuilder().setCustomId('av:clear').setLabel('Clear everything').setStyle(ButtonStyle.Danger).setDisabled(!saved.length),
  );
  return {
    content: notice ?? '',
    embeds: [embed],
    components: [daySelect, blockSelect, tzSelect].map((s) => new ActionRowBuilder().addComponents(s)).concat(buttons),
    allowedMentions: { parse: [] },
  };
}

function viewEmbed(member) {
  const z = av.memberZone(member);
  const saved = av.summaryLines(member.id);
  const answers = get(`SELECT COUNT(*) AS n FROM avail_poll_votes v JOIN avail_polls p ON p.message_id = v.message_id
    WHERE v.user_id = ? AND p.week_start > ?`, member.id, now() - 7 * 86400).n;
  return new EmbedBuilder().setColor(BRAND_COLOR)
    .setAuthor({ name: member.displayName, iconURL: member.displayAvatarURL() })
    .setThumbnail(member.displayAvatarURL({ size: 256 }))
    .setTitle('📅 Availability')
    .setDescription(z ? `Shown in their own time: **${z.label}** (${z.name}, ${av.offsetLabel(z.zone)})` : 'No timezone picked yet.')
    .addFields(
      { name: 'Usually plays', value: saved.length ? saved.join('\n') : '-# Nothing saved yet — `/availability set`' },
      { name: 'Availability polls (last 7 days)', value: answers ? `Answered **${answers}**` : '-# None answered' },
    )
    .setFooter({ text: config.settings.serverName })
    .setTimestamp();
}

// ---------------------------------------------------------------- poll
const pollZoneLabel = () => av.zones().find((z) => z.zone === config.timezones.pollZone)?.label ?? config.timezones.pollZone;
const alsoLabel = () => config.timezones.display.find((d) => d.zone === config.timezones.pollAlsoShow)?.label ?? config.timezones.pollAlsoShow;

function pollDays(poll) {
  const start = DateTime.fromSeconds(poll.week_start, { zone: config.timezones.pollZone });
  return Array.from({ length: 7 }, (_, i) => start.plus({ days: i }));
}
// Block start (unix) on the poll's first day, and its labels in both zones.
function pollBlock(poll, b) {
  const t = DateTime.fromSeconds(poll.week_start, { zone: config.timezones.pollZone }).plus({ hours: b });
  const other = t.setZone(config.timezones.pollAlsoShow);
  return { unix: Math.floor(t.toSeconds()), main: `${av.blockLabel(b)} ${pollZoneLabel()}`, other: `${av.blockLabel(other.hour)} ${alsoLabel()}` };
}

function pollTally(poll) {
  const votes = all('SELECT * FROM avail_poll_votes WHERE message_id = ?', poll.message_id).map((v) => ({ ...v, days: JSON.parse(v.days), blocks: JSON.parse(v.blocks) }));
  const blocks = config.timezones.pollBlocks;
  return {
    votes,
    complete: votes.filter((v) => v.days.length && v.blocks.length),
    days: Array.from({ length: 7 }, (_, d) => votes.filter((v) => v.days.includes(d)).length),
    blocks: blocks.map((b) => votes.filter((v) => v.blocks.includes(b)).length),
  };
}

function pollMessage(poll) {
  const tally = pollTally(poll);
  const days = pollDays(poll);
  const blocks = config.timezones.pollBlocks;
  const maxDay = Math.max(1, ...tally.days); const maxBlock = Math.max(1, ...tally.blocks);
  const { top, main, files } = sessionCard();
  main.setTitle(poll.closed ? '🗓️ Availability Poll — Closed' : '🗓️ Availability Poll')
    .setDescription(
      `**${poll.question}**\n` +
      (poll.closed
        ? '-# This poll is closed — thanks to everyone who answered!'
        : '-# Pick **every** day and **every** time you could play. Change your answer any time — just pick again.'),
    )
    .addFields(
      { name: '📆 Days', value: days.map((d, i) => `\`${d.toFormat('ccc d LLL').padEnd(10)}\` ${bar(tally.days[i], maxDay, 8)} **${tally.days[i]}**`).join('\n') },
      {
        name: `🕒 Times (${pollZoneLabel()} · ${alsoLabel()} · yours)`,
        value: blocks.map((b, i) => {
          const blk = pollBlock(poll, b);
          return `\`${blk.main}\` · ${blk.other} · ${ts(blk.unix, 't')}\n${bar(tally.blocks[i], maxBlock, 8)} **${tally.blocks[i]}**`;
        }).join('\n'),
      },
      { name: '​', value: `👥 **${tally.complete.length}** member${tally.complete.length === 1 ? '' : 's'} answered · started by <@${poll.created_by}>` },
    );

  const closed = Boolean(poll.closed);
  const daySelect = new StringSelectMenuBuilder().setCustomId('avp:days').setPlaceholder('Which days can you play?').setMinValues(1).setMaxValues(7).setDisabled(closed)
    .addOptions(days.map((d, i) => ({ label: d.toFormat('cccc d LLLL'), value: String(i), description: i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : undefined })));
  const timeSelect = new StringSelectMenuBuilder().setCustomId('avp:times').setPlaceholder('Which times can you play?').setMinValues(1).setMaxValues(blocks.length).setDisabled(closed)
    .addOptions(blocks.map((b) => {
      const blk = pollBlock(poll, b);
      return { label: blk.main, value: String(b), description: `${blk.other}${b >= 24 ? ' · after midnight' : ''}` };
    }));
  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('avp:clear').setLabel('Remove my answer').setStyle(ButtonStyle.Secondary).setDisabled(closed),
    new ButtonBuilder().setCustomId('avp:results').setLabel('Results').setEmoji('📊').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('avp:close').setLabel('Close').setStyle(ButtonStyle.Danger).setDisabled(closed),
  );
  return {
    embeds: [top, main], files,
    components: [new ActionRowBuilder().addComponents(daySelect), new ActionRowBuilder().addComponents(timeSelect), buttons],
    allowedMentions: { parse: [] },
  };
}

// Day x time grid + who answered - for the creator and Supervisor+.
function resultsReply(poll) {
  const tally = pollTally(poll);
  const days = pollDays(poll);
  const blocks = config.timezones.pollBlocks;
  const head = `${''.padEnd(10)}${blocks.map((b) => av.hourLabel(b).replace(' ', '').padStart(5)).join('')}`;
  const rows = days.map((d, i) => `${d.toFormat('ccc d LLL').padEnd(10)}${blocks.map((b) => String(tally.complete.filter((v) => v.days.includes(i) && v.blocks.includes(b)).length).padStart(5)).join('')}`);
  const combos = [];
  days.forEach((d, i) => blocks.forEach((b) => {
    const n = tally.complete.filter((v) => v.days.includes(i) && v.blocks.includes(b)).length;
    if (n) combos.push({ n, unix: Math.floor(d.plus({ hours: b }).toSeconds()), label: `${d.toFormat('ccc d LLL')}, ${av.blockLabel(b)} ${pollZoneLabel()}` });
  }));
  combos.sort((a, b) => b.n - a.n || a.unix - b.unix);
  const embed = new EmbedBuilder().setColor(BRAND_COLOR).setTitle('📊 Availability Poll — Results')
    .setDescription(`**${poll.question}**\nMembers who can play, per day and block start (${pollZoneLabel()}):\n\`\`\`\n${head}\n${rows.join('\n')}\n\`\`\``)
    .addFields(
      { name: '🏆 Most popular', value: combos.slice(0, 5).map((c, i) => `**${i + 1}.** ${c.label} — **${c.n}** · ${ts(c.unix, 'F')}`).join('\n') || '-# No complete answers yet.' },
      { name: `👥 Answered (${tally.complete.length})`, value: tally.complete.map((v) => `<@${v.user_id}>`).join(' ').slice(0, 1024) || '-# nobody yet' },
    )
    .setFooter({ text: 'These answers are included in /session-times automatically.' });
  return { embeds: [embed], flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } };
}

// ---------------------------------------------------------------- handlers
async function execute(interaction) {
  const sub = interaction.options.getSubcommand();

  if (sub === 'set') {
    const key = interaction.options.getString('timezone');
    let notice;
    if (key) notice = (await av.setMemberZone(interaction.member, key)).roleNote;
    return interaction.reply({ ...editorPayload(interaction.member, notice ? `⚠️ Timezone saved, but ${notice}.` : undefined), flags: MessageFlags.Ephemeral });
  }

  if (sub === 'view') {
    const user = interaction.options.getUser('member') ?? interaction.user;
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    if (!member) return interaction.reply({ content: 'That person isn\'t in the server.', flags: MessageFlags.Ephemeral });
    return interaction.reply({ embeds: [viewEmbed(member)], flags: MessageFlags.Ephemeral });
  }

  if (sub === 'clear') {
    av.clearAvailability(interaction.user.id);
    return interaction.reply({ content: '🗑️ Your saved availability was deleted. Your timezone is kept — set new times any time with `/availability set`.', flags: MessageFlags.Ephemeral });
  }

  if (!(await guard(interaction, 'supervisor'))) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const question = interaction.options.getString('question') ?? 'When can you play this week?';
  const weekStart = Math.floor(DateTime.now().setZone(config.timezones.pollZone).startOf('day').toSeconds());
  const draft = { message_id: 'draft', created_by: interaction.user.id, week_start: weekStart, question, closed: 0 };
  const msg = await postToSessions(interaction, withPing(pollMessage(draft), 'availability_poll'));
  if (!msg) return;
  run('INSERT INTO avail_polls(message_id, channel_id, created_by, created_at, week_start, question) VALUES(?, ?, ?, ?, ?, ?)',
    msg.id, msg.channel.id, interaction.user.id, now(), weekStart, question);
  return interaction.editReply(`🗓️ Availability poll posted in ${msg.channel}. Answers feed into \`/session-times\` automatically.`);
}

// Editor menus and buttons (av:...), from /availability set or the timezone panel.
async function editor(interaction) {
  const [, action] = interaction.customId.split(':');
  const member = interaction.member;
  if (action === 'open') return interaction.reply({ ...editorPayload(member), flags: MessageFlags.Ephemeral });

  const draft = draftOf(member.id);
  let notice;
  if (action === 'days') draft.days = interaction.values;
  if (action === 'blocks') {
    // "Not available" can't be combined with times: whichever was picked last wins.
    draft.blocks = interaction.values.includes('none') && interaction.values.length > 1 && !draft.blocks.includes('none')
      ? ['none'] : interaction.values.filter((v) => v !== 'none' || interaction.values.length === 1);
  }
  if (action === 'tz') {
    const { zone, roleNote } = await av.setMemberZone(member, interaction.values[0]);
    notice = roleNote ? `⚠️ Timezone saved as ${zone.label}, but ${roleNote}.` : `✅ Timezone set to **${zone.label}**.`;
  }
  if (action === 'save') {
    // A timezone that only comes from a role is saved too, so the times can be converted to UTC.
    const z = av.memberZone(member);
    if (z?.source === 'role') await av.setMemberZone(member, z.key);
    const days = expandDays(draft.days);
    const blocks = draft.blocks.includes('none') ? [] : draft.blocks.map(Number);
    av.saveDays(member.id, days, blocks);
    drafts.delete(member.id);
    notice = `✅ Saved ${days.map((d) => av.DAYS[d - 1].slice(0, 3)).join(', ')}. Pick more days, or you're done — dismiss this message.`;
    return interaction.update(editorPayload(member, notice));
  }
  if (action === 'clear') {
    av.clearAvailability(member.id);
    drafts.delete(member.id);
    return interaction.update(editorPayload(member, '🗑️ Cleared. Your timezone is kept.'));
  }
  drafts.set(member.id, draft);
  return interaction.update(editorPayload(member, notice));
}

// Poll menus and buttons (avp:...).
async function pollAction(interaction) {
  const [, action] = interaction.customId.split(':');
  const poll = get('SELECT * FROM avail_polls WHERE message_id = ?', interaction.message.id);
  if (!poll) return interaction.reply({ content: 'This poll no longer exists.', flags: MessageFlags.Ephemeral });
  const staff = interaction.user.id === poll.created_by || can(interaction.member, 'supervisor');

  if (action === 'results') {
    if (!staff) return interaction.reply({ content: '🔒 Only the poll creator or a Supervisor+ can see the full results.', flags: MessageFlags.Ephemeral });
    return interaction.reply(resultsReply(poll));
  }
  if (action === 'close') {
    if (!staff) return interaction.reply({ content: '🔒 Only the poll creator or a Supervisor+ can close it.', flags: MessageFlags.Ephemeral });
    run('UPDATE avail_polls SET closed = 1 WHERE message_id = ?', poll.message_id);
    return interaction.update(forEdit(pollMessage({ ...poll, closed: 1 })));
  }
  if (poll.closed) return interaction.reply({ content: 'This poll is closed.', flags: MessageFlags.Ephemeral });

  if (action === 'clear') run('DELETE FROM avail_poll_votes WHERE message_id = ? AND user_id = ?', poll.message_id, interaction.user.id);
  else {
    const column = action === 'days' ? 'days' : 'blocks';
    const values = JSON.stringify(interaction.values.map(Number));
    run(`INSERT INTO avail_poll_votes(message_id, user_id, ${column}) VALUES(?, ?, ?)
      ON CONFLICT(message_id, user_id) DO UPDATE SET ${column} = excluded.${column}`, poll.message_id, interaction.user.id, values);
  }
  await interaction.update(forEdit(pollMessage(poll)));

  const mine = get('SELECT * FROM avail_poll_votes WHERE message_id = ? AND user_id = ?', poll.message_id, interaction.user.id);
  const days = mine ? JSON.parse(mine.days) : []; const blocks = mine ? JSON.parse(mine.blocks) : [];
  const dayNames = pollDays(poll);
  const text = !mine ? '🗑️ Your answer was removed.'
    : !days.length ? `🕒 Times saved: ${blocks.map((b) => pollBlock(poll, b).main).join(', ')}.\n**Now pick your days** in the first menu.`
      : !blocks.length ? `📆 Days saved: ${days.map((d) => dayNames[d].toFormat('ccc')).join(', ')}.\n**Now pick your times** in the second menu.`
        : `✅ Thanks! You can play **${days.map((d) => dayNames[d].toFormat('ccc')).join(', ')}** at **${blocks.map((b) => pollBlock(poll, b).main).join(', ')}**.\n-# Pick again in either menu to change it.`;
  return interaction.followUp({ content: text, flags: MessageFlags.Ephemeral });
}

module.exports = {
  data, execute,
  buttons: { av: editor, avp: pollAction },
  selects: { av: editor, avp: pollAction },
};
