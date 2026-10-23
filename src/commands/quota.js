const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { guard } = require('../lib/permissions');
const { brand, ts, formatDuration } = require('../lib/embeds');
const { role } = require('../lib/guildConfig');
const { config } = require('../lib/config');
const { run } = require('../lib/db');
const { weekStart } = require('../lib/time');
const quota = require('../services/quota');

const tierChoices = () => config.quota.tiers.map((t) => ({ name: t.label, value: t.id }));

const data = new SlashCommandBuilder()
  .setName('quota')
  .setDescription('Check quota progress and tiers. Changing quotas is bot-owner only.')
  .addSubcommand((s) => s.setName('check').setDescription('A staff member\'s quota progress this week.')
    .addUserOption((o) => o.setName('member').setDescription('Staff member (default: you)')))
  .addSubcommand((s) => s.setName('tiers').setDescription('Every quota tier, its hours and the enforcement rules.'))
  .addSubcommand((s) => s.setName('set').setDescription('Change the weekly hours for a tier (bot owner only).')
    .addStringOption((o) => o.setName('tier').setDescription('Tier').setRequired(true).addChoices(...tierChoices()))
    .addNumberOption((o) => o.setName('hours').setDescription('Weekly hours required').setRequired(true).setMinValue(0).setMaxValue(168)))
  .addSubcommand((s) => s.setName('reset').setDescription('Reset a tier to the hours in config/quota.json (bot owner only).')
    .addStringOption((o) => o.setName('tier').setDescription('Tier').setRequired(true).addChoices(...tierChoices())));

const hoursText = (t) => (quota.hasQuota(t) ? `${formatDuration(t.weeklyHours * 3600)}/week` : 'No quota');

async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  if (!(await guard(interaction, sub === 'set' || sub === 'reset' ? 'owner' : 'supervisor'))) return;

  if (sub === 'set') {
    const tier = interaction.options.getString('tier');
    const hours = interaction.options.getNumber('hours');
    run('INSERT INTO quota_overrides(tier_id, weekly_hours) VALUES(?, ?) ON CONFLICT(tier_id) DO UPDATE SET weekly_hours = excluded.weekly_hours', tier, hours);
    return interaction.reply({ content: `✅ **${config.quota.tiers.find((t) => t.id === tier)?.label}** quota is now **${formatDuration(hours * 3600)}/week**.`, flags: MessageFlags.Ephemeral });
  }
  if (sub === 'reset') {
    run('DELETE FROM quota_overrides WHERE tier_id = ?', interaction.options.getString('tier'));
    return interaction.reply({ content: '↩️ Tier reset to the value in config/quota.json.', flags: MessageFlags.Ephemeral });
  }

  const { embed, files } = brand({ guild: interaction.guild });

  if (sub === 'tiers') {
    for (const group of quota.groups()) {
      const lines = quota.tiers().filter((t) => t.group === group).map((t) => {
        const roles = t.roles.map((slot) => (role(slot) ? `<@&${role(slot)}>` : `\`${slot}\` (not set)`)).join(', ');
        return `**${t.label}** — **${hoursText(t)}**${quota.hasQuota(t) && !t.enforced ? ' (no auto strike/demotion)' : ''} · ${roles}`;
      });
      embed.addFields({ name: quota.groupLabel(group), value: lines.join('\n').slice(0, 1024) });
    }
    const rules = config.quota.enforcement.map((e) => `${e.emoji} ${e.belowHours != null ? `Below ${formatDuration(e.belowHours * 3600)}` : 'Below quota'} → **${e.action}**`);
    const promo = config.quota.promotional;
    embed.setTitle('⏱️ Quota Tiers').addFields(
      { name: 'Enforcement (Staff, Trial Moderator, Trial Administrator)', value: rules.join('\n') },
      { name: 'Promotional quota', value: `${promo.weeklyHours}h+ of shifts **and** top ${promo.topN} on the leaderboard. Reviewed every Friday; eligible ≠ guaranteed. Head/Senior Moderator → Trial Administrator needs an Admin Application.` },
      { name: 'Week resets', value: `Every ${config.quota.weekResetDay} · current week started ${ts(weekStart(), 'F')}` },
    );
    return interaction.reply({ embeds: [embed], files, allowedMentions: { parse: [] } });
  }

  // check
  const user = interaction.options.getUser('member') ?? interaction.user;
  const member = await interaction.guild.members.fetch(user.id).catch(() => null);
  if (!member) return interaction.reply({ content: 'That user isn\'t in this server.', flags: MessageFlags.Ephemeral });
  const list = quota.tiers();
  const start = weekStart();
  const secs = quota.secondsByMember(start, weekStart(undefined, 1))[member.id] ?? 0;
  const lastSecs = quota.secondsByMember(weekStart(undefined, -1), start)[member.id] ?? 0;
  const logs = quota.iaLogsByMember(start, weekStart(undefined, 1))[member.id] ?? 0;

  embed.setTitle(`⏱️ Quota — ${member.displayName}`).setDescription(
    `**This week:** ${formatDuration(secs)} · **Last week:** ${formatDuration(lastSecs)} · **Resets** ${ts(weekStart(undefined, 1), 'R')}`,
  );
  let matched = 0;
  for (const group of quota.groups()) {
    const tier = quota.tierFor(member, list, group) ?? (group === 'staff' && role('staff') && member.roles.cache.has(role('staff')) ? list.find((t) => t.id === 'general') : null);
    if (!tier) continue;
    matched += 1;
    const status = quota.evaluate(member, secs / 3600, tier, { logs });
    let value = `${status.emoji} **${status.label}** · ${tier.label} · ${hoursText(tier)}`;
    if (tier.minLogsPerWeek != null) value += ` + ${tier.minLogsPerWeek} cases logged (**${logs}** so far)`;
    if (quota.hasQuota(tier)) {
      const pct = Math.min(100, Math.round((secs / 3600 / (tier.weeklyHours || 1)) * 100));
      value += `\n${'▰'.repeat(Math.round(pct / 10))}${'▱'.repeat(10 - Math.round(pct / 10))} ${pct}%`;
    }
    if (tier.notes?.length) value += `\n-# Also: ${tier.notes.slice(0, 4).join(' · ')}`;
    embed.addFields({ name: quota.groupLabel(group), value });
  }
  if (!matched) embed.addFields({ name: 'No quota', value: 'This member has no quota role (check `/setup roles`).' });
  return interaction.reply({ embeds: [embed], files, allowedMentions: { parse: [] } });
}

module.exports = { data, execute };
