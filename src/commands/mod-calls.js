const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { guard } = require('../lib/permissions');
const { all, run, get, now } = require('../lib/db');
const { brand, ts, formatDuration } = require('../lib/embeds');

// Mod calls come from the ER:LC API via the poller. They are NOT logged to a channel.
const OPEN_WINDOW = 2 * 3600; // unanswered calls older than this drop off the queue

const data = new SlashCommandBuilder()
  .setName('mod-calls')
  .setDescription('The in-game mod call queue.')
  .addSubcommand((s) => s.setName('view').setDescription('View open and recent mod calls (any staff).'))
  .addSubcommand((s) => s.setName('resolve').setDescription('Mark a mod call as handled (Supervisor+).')
    .addIntegerOption((o) => o.setName('id').setDescription('Mod call number from /mod-calls view').setRequired(true)))
  .addSubcommand((s) => s.setName('clear').setDescription('Mark every open mod call as handled (Supervisor+).'));

async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  if (!(await guard(interaction, sub === 'view' ? 'staff' : 'supervisor'))) return;
  const t = now();

  if (sub === 'resolve') {
    const id = interaction.options.getInteger('id');
    const call = get('SELECT * FROM mod_calls WHERE id = ?', id);
    if (!call) return interaction.reply({ content: `No mod call #${id}.`, flags: MessageFlags.Ephemeral });
    run('UPDATE mod_calls SET resolved_by = ?, resolved_at = ? WHERE id = ?', interaction.user.id, t, id);
    return interaction.reply({ content: `✅ Mod call #${id} (${call.caller}) marked as handled.`, flags: MessageFlags.Ephemeral });
  }
  if (sub === 'clear') {
    const res = run('UPDATE mod_calls SET resolved_by = ?, resolved_at = ? WHERE moderator IS NULL AND resolved_at IS NULL AND ts >= ?', interaction.user.id, t, t - OPEN_WINDOW);
    return interaction.reply({ content: `🧹 Cleared ${res.changes} open mod call(s).`, flags: MessageFlags.Ephemeral });
  }

  const open = all('SELECT * FROM mod_calls WHERE moderator IS NULL AND resolved_at IS NULL AND ts >= ? ORDER BY ts ASC LIMIT 20', t - OPEN_WINDOW);
  const recent = all('SELECT * FROM mod_calls WHERE moderator IS NOT NULL ORDER BY ts DESC LIMIT 10');
  const { embed, files } = brand({ guild: interaction.guild });
  embed.setTitle('📞 Mod Calls').addFields(
    {
      name: `Open (${open.length})`,
      value: open.map((c) => `**#${c.id}** ${c.caller} \`${c.caller_id}\` — waiting ${formatDuration(t - c.ts)} (${ts(c.ts, 'T')})`).join('\n').slice(0, 1024) || 'No open mod calls 🎉',
    },
    {
      name: 'Recently answered',
      value: recent.map((c) => `**#${c.id}** ${c.caller} → **${c.moderator}**${c.seen_unanswered && c.answered_seen_at ? ` in ~${formatDuration(c.answered_seen_at - c.ts)}` : ''} (${ts(c.ts, 'R')})`).join('\n').slice(0, 1024) || '—',
    },
  ).setFooter({ text: 'Live from the ER:LC API · Supervisors+: /mod-calls resolve or clear' });
  return interaction.reply({ embeds: [embed], files, flags: MessageFlags.Ephemeral });
}

module.exports = { data, execute };
