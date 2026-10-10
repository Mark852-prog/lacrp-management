const { SlashCommandBuilder } = require('discord.js');
const { guard } = require('../lib/permissions');
const { brand, plain, ts, formatDuration, chunkLines } = require('../lib/embeds');
const { config } = require('../lib/config');
const quota = require('../services/quota');

// Read-only report: nothing is sent to members and no roles/infractions are changed.
const data = new SlashCommandBuilder()
  .setName('activity-check')
  .setDescription('Staff + IA activity / quota report from Vex shift hours (posts here, changes nothing).')
  .addStringOption((o) => o.setName('week').setDescription('Which quota week (default: last completed week)')
    .addChoices({ name: 'Last completed week', value: 'previous' }, { name: 'Current week so far', value: 'current' }))
  .addStringOption((o) => o.setName('team').setDescription('Which team (default: both)')
    .addChoices({ name: 'Both', value: 'all' }, { name: 'Staff team', value: 'staff' }, { name: 'Internal Affairs', value: 'ia' }));

function line(r) {
  const extra = [];
  if (r.promoEligible) extra.push('⭐ promo-eligible');
  if (r.trial) {
    const t = r.trial;
    const parts = [];
    if (t.minModerations != null) parts.push(`moderations ${t.moderations ?? '? (not linked)'}/${t.minModerations}`);
    if (t.minBansReviewed != null) parts.push(`bans reviewed ${t.bansReviewed}/${t.minBansReviewed}`);
    parts.push(`strikes ${t.strikes} (max ${t.maxStrikes})`);
    extra.push(`trial: ${parts.join(', ')}`);
  }
  const target = quota.hasQuota(r.tier) ? `${r.tier.weeklyHours}h` : 'no quota';
  if (r.tier.minLogsPerWeek != null) extra.unshift(`cases logged ${r.logs}/${r.tier.minLogsPerWeek}`);
  return `<@${r.member.id}> — **${formatDuration(r.hours * 3600)}** / ${target} · ${r.tier.label}${extra.length ? ` · ${extra.join(' · ')}` : ''}`;
}

// Groups rows by outcome (most serious first) and packs them into embeds within Discord's size limits.
function detailEmbeds(rows) {
  const order = [...config.quota.enforcement.map((e) => e.action), 'below', 'met', 'loa', 'exempt'];
  const byStatus = new Map();
  for (const r of rows) {
    if (!byStatus.has(r.status.key)) byStatus.set(r.status.key, { label: r.status.label, emoji: r.status.emoji, rows: [] });
    byStatus.get(r.status.key).rows.push(r);
  }
  const sorted = [...byStatus.entries()].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]));
  const summary = sorted.map(([, g]) => `${g.emoji} ${g.label}: **${g.rows.length}**`).join(' · ');

  const fields = [];
  for (const [, g] of sorted) {
    chunkLines(g.rows.map(line)).forEach((chunk, i) => fields.push({ name: `${g.emoji} ${g.label}${i ? ' (cont.)' : ''} — ${g.rows.length}`, value: chunk }));
  }
  const embeds = [];
  let cur = plain();
  let size = 0;
  for (const f of fields) {
    if (size + f.name.length + f.value.length > 5500 || (cur.data.fields?.length ?? 0) >= 25) {
      embeds.push(cur);
      cur = plain();
      size = 0;
    }
    cur.addFields(f);
    size += f.name.length + f.value.length;
  }
  if (cur.data.fields?.length) embeds.push(cur);
  return { summary, embeds };
}

async function execute(interaction) {
  if (!(await guard(interaction, 'highRank'))) return;
  await interaction.deferReply();
  const offset = (interaction.options.getString('week') ?? 'previous') === 'previous' ? -1 : 0;
  const team = interaction.options.getString('team') ?? 'all';
  const wanted = team === 'all' ? quota.groups() : [team];

  let first = true;
  for (const group of wanted) {
    const report = await quota.buildReport(interaction.guild, offset, group);
    const { summary, embeds } = detailEmbeds(report.rows);
    const { embed, files } = brand({ guild: interaction.guild });
    const promo = config.quota.promotional;
    const groupCfg = config.quota.groups?.[group] ?? {};
    const tierNotes = quota.tiers().filter((t) => t.group === group && t.notes?.length).flatMap((t) => t.notes);

    let desc = `**Week:** ${ts(report.start, 'D')} → ${ts(report.end, 'D')}${offset === 0 ? ' *(in progress)*' : ''}\n` +
      `**Checked:** ${report.rows.length} members\n${summary || 'Nobody found — check the roles in `/setup roles`.'}\n`;
    if (group === 'staff') {
      desc += `\n⭐ = promotion-eligible (${promo.weeklyHours}h+ and top ${promo.topN}). Eligible ≠ guaranteed.` +
        '\nMissing quota while not on approved LOA → infraction by SVs/HRs+ (issued Fridays).';
    }
    if (tierNotes.length) desc += `\n\n**Also required (check manually):**\n${tierNotes.map((n) => `• ${n}`).join('\n')}`;
    if (groupCfg.manualNote) desc += `\n\n-# ${groupCfg.manualNote}`;
    embed.setTitle(`📋 Activity Check — ${quota.groupLabel(group)}`).setDescription(desc.slice(0, 4096));

    const payload = { embeds: [embed], files, allowedMentions: { parse: [] } };
    if (first) await interaction.editReply(payload);
    else await interaction.followUp(payload);
    first = false;
    for (const e of embeds) await interaction.followUp({ embeds: [e], allowedMentions: { parse: [] } });
  }
}

module.exports = { data, execute };
