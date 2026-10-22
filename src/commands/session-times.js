// /session-times - Supervisor+: the best session slots for the next 7 days, from timezones, /availability
// and availability poll answers, shown in several timezones + a heatmap. Each slot has a Schedule button
// that creates a normal /session-schedule entry.
const { DateTime } = require('luxon');
const { SlashCommandBuilder, MessageFlags, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { guard, can } = require('../lib/permissions');
const { BRAND_COLOR, ts } = require('../lib/embeds');
const { config } = require('../lib/config');
const { get } = require('../lib/db');
const av = require('../lib/availability');
const { createScheduled } = require('./session-schedule');

const MEDALS = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'];
const SHADES = ['·', '░', '▒', '▓', '█'];

const data = new SlashCommandBuilder()
  .setName('session-times')
  .setDescription('Best times to host a session this week, based on member availability (Supervisor+).')
  .addIntegerOption((o) => o.setName('length').setDescription('Session length in hours (default 2)').setMinValue(1).setMaxValue(4))
  .addIntegerOption((o) => o.setName('count').setDescription('How many slots to suggest (default 5)').setMinValue(3).setMaxValue(5))
  .addStringOption((o) => o.setName('heatmap_zone').setDescription('Timezone for the heatmap (default: first in the list)')
    .addChoices(...config.timezones.display.map((d) => ({ name: d.label, value: d.zone }))))
  .addBooleanOption((o) => o.setName('share').setDescription('Post it in this channel for everyone (default: only you see it)'));

// 24 columns, one per hour, header marks every 3 hours.
function heatmap(data, zone) {
  const weight = config.timezones.estimate.weight;
  const value = data.hours.map((_, i) => data.confirmed[i].size + weight * data.likely[i].size);
  const max = Math.max(0, ...value);
  const index = new Map(data.hours.map((t, i) => [t, i]));
  const header = Array(24).fill(' ');
  for (let h = 0; h < 24; h += 3) String(h).split('').forEach((ch, k) => { header[h + k] = ch; });
  const start = DateTime.fromSeconds(data.hours[0], { zone }).startOf('day');
  const rows = [];
  for (let d = 0; d < 8; d++) {
    const day = start.plus({ days: d });
    let cells = '';
    let any = false;
    for (let h = 0; h < 24; h++) {
      const i = index.get(Math.floor(day.plus({ hours: h }).toSeconds()));
      if (i === undefined) { cells += ' '; continue; }
      any = true;
      cells += value[i] && max ? SHADES[Math.max(1, Math.ceil((value[i] / max) * 4))] : SHADES[0];
    }
    if (any) rows.push(`${day.toFormat('ccc dd').padEnd(7)} ${cells}`);
  }
  return { text: `${''.padEnd(7)} ${header.join('')}\n${rows.join('\n')}`, max };
}

async function execute(interaction) {
  if (!(await guard(interaction, 'supervisor'))) return;
  const share = interaction.options.getBoolean('share') ?? false;
  await interaction.deferReply(share ? {} : { flags: MessageFlags.Ephemeral });
  const length = interaction.options.getInteger('length') ?? 2;
  const count = interaction.options.getInteger('count') ?? 5;
  const gridZone = interaction.options.getString('heatmap_zone') ?? config.timezones.display[0].zone;
  const gridLabel = config.timezones.display.find((d) => d.zone === gridZone)?.label ?? gridZone;

  const members = await interaction.guild.members.fetch();
  const data = av.hourly(members);
  const slots = av.bestSlots(data, { length, count });
  const { availability, poll, zoneOnly } = data.counts;

  const main = new EmbedBuilder().setColor(BRAND_COLOR)
    .setAuthor({ name: config.settings.serverName, iconURL: interaction.guild.iconURL() ?? undefined })
    .setTitle('🗓️ Best Session Times · next 7 days')
    .setFooter({ text: `${length}h sessions · confirmed = saved availability or poll answer · likely = timezone only` })
    .setTimestamp();

  if (!slots.length) {
    main.setDescription('**No availability data yet.**\nPost the timezone panel with `/timezone panel`, ask members to use `/availability set`, or post a poll with `/availability poll`. Then run this again.');
    return interaction.editReply({ embeds: [main] });
  }

  main.setDescription(
    `Based on **${availability + poll + zoneOnly}** members — **${availability}** saved availability · **${poll}** answered a poll · **${zoneOnly}** timezone only *(likely)*.\n` +
    '-# The bold times below show in **your own** time.',
  );
  for (const [i, s] of slots.entries()) {
    const zones = config.timezones.display.map((d) => `\`${d.label}\` ${av.at(s.start, d.zone)}`).join(' · ');
    main.addFields({
      name: `${MEDALS[i]} ${av.at(s.start, config.timezones.display[0].zone, 'cccc, h:mm a')} ${config.timezones.display[0].label}`,
      value: `**${ts(s.start, 'F')}** → ${ts(s.start + length * av.HOUR, 't')} · ${ts(s.start, 'R')}\n` +
        `👥 **${s.confirmed + s.likely}** available — **${s.confirmed}** confirmed + **${s.likely}** likely\n${zones}`,
    });
  }

  const grid = heatmap(data, gridZone);
  const heat = new EmbedBuilder().setColor(BRAND_COLOR)
    .setTitle(`🔥 Availability by hour · ${gridLabel}`)
    .setDescription(`\`\`\`\n${grid.text}\n\`\`\`\n\`·\` nobody  \`░\` few  \`▒\` some  \`▓\` many  \`█\` most${grid.max ? ` (peak ≈ ${Math.round(grid.max)})` : ''}`);

  const row = new ActionRowBuilder().addComponents(slots.map((s, i) =>
    new ButtonBuilder().setCustomId(`st:sched:${s.start}`).setLabel(`Schedule #${i + 1}`).setEmoji('📅').setStyle(i === 0 ? ButtonStyle.Success : ButtonStyle.Secondary)));
  return interaction.editReply({ embeds: [main, heat], components: [row], allowedMentions: { parse: [] } });
}

// Schedule button: announces the slot through /session-schedule, with the clicker as host.
async function button(interaction) {
  if (!can(interaction.member, 'supervisor')) return interaction.reply({ content: '🔒 This is limited to **Supervisors and above**.', flags: MessageFlags.Ephemeral });
  const when = Number(interaction.customId.split(':')[2]);
  if (when < Math.floor(Date.now() / 1000)) return interaction.reply({ content: '⚠️ That slot has already started. Run `/session-times` again for fresh suggestions.', flags: MessageFlags.Ephemeral });
  const clash = get("SELECT id, host_id FROM scheduled_sessions WHERE status = 'scheduled' AND ABS(scheduled_for - ?) < ?", when, av.HOUR);
  if (clash) return interaction.reply({ content: `⚠️ Session #${clash.id} (host <@${clash.host_id}>) is already scheduled within an hour of ${ts(when, 'F')}.`, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
  return createScheduled(interaction, when, interaction.user, null);
}

module.exports = { data, execute, buttons: { st: button } };
