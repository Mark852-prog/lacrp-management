// /bans - the ER:LC server's ban list (list, search, unban). Administrator+.
const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const erlc = require('../lib/erlc');
const { brand, ts } = require('../lib/embeds');
const { guard } = require('../lib/permissions');
const { get } = require('../lib/db');
const { logIngame } = require('../lib/ingameLog');

const PAGE = 20;

const data = new SlashCommandBuilder()
  .setName('bans')
  .setDescription('ER:LC server bans (Administrator+).')
  .addSubcommand((s) => s.setName('list').setDescription('Every banned player.')
    .addIntegerOption((o) => o.setName('page').setDescription('Page number').setMinValue(1)))
  .addSubcommand((s) => s.setName('search').setDescription('Check whether a player is banned.')
    .addStringOption((o) => o.setName('player').setDescription('Roblox username or ID').setRequired(true)))
  .addSubcommand((s) => s.setName('unban').setDescription('Unban a player in-game (logged).')
    .addStringOption((o) => o.setName('player').setDescription('Roblox username or ID').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('Why they are being unbanned').setRequired(true).setMaxLength(200)));

// Who banned them and when, from the command logs the bot has stored (if it saw the ban).
function bannedBy(id, name) {
  return get('SELECT player, ts FROM command_logs WHERE command LIKE ? OR command LIKE ? OR command LIKE ? OR command LIKE ? ORDER BY ts DESC LIMIT 1',
    `:ban ${name}%`, `:tban ${name}%`, `:ban ${id}%`, `:tban ${id}%`);
}

async function loadBans(interaction) {
  try {
    return Object.entries(await erlc.getBans()).map(([id, name]) => ({ id: String(id), name: String(name) }));
  } catch (err) {
    await interaction.editReply(`❌ Couldn't load the ban list: ${err.message}`);
    return null;
  }
}

async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  if (!(await guard(interaction, 'admin'))) return;
  await interaction.deferReply(sub === 'list' ? {} : { flags: MessageFlags.Ephemeral });
  const bans = await loadBans(interaction);
  if (!bans) return;
  const { embed, files } = brand({ guild: interaction.guild, withBanner: false });

  if (sub === 'list') {
    const pages = Math.max(1, Math.ceil(bans.length / PAGE));
    const page = Math.min(interaction.options.getInteger('page') ?? 1, pages);
    const slice = bans.slice((page - 1) * PAGE, page * PAGE);
    embed.setTitle(`🔨 Server Bans (${bans.length})`)
      .setDescription(slice.length ? slice.map((b) => `**${b.name}** · \`${b.id}\``).join('\n') : 'Nobody is banned.')
      .setFooter({ text: `Page ${page}/${pages} · /bans search for details` });
    return interaction.editReply({ embeds: [embed], files });
  }

  const query = interaction.options.getString('player').trim().toLowerCase();
  const ban = bans.find((b) => b.id === query || b.name.toLowerCase() === query);
  if (!ban) return interaction.editReply(`✅ **${query}** is not on the ban list.`);

  if (sub === 'search') {
    const by = bannedBy(ban.id, ban.name);
    embed.setTitle('🔨 Banned').addFields(
      { name: 'Player', value: `[${ban.name}](https://www.roblox.com/users/${ban.id}/profile) \`${ban.id}\``, inline: true },
      { name: 'Banned by', value: by ? `${by.player} · ${ts(by.ts, 'R')}` : 'Unknown (before the bot was tracking)', inline: true },
    );
    return interaction.editReply({ embeds: [embed], files });
  }

  const command = `:unban ${ban.id}`;
  const reason = interaction.options.getString('reason');
  try {
    await erlc.runCommand(command);
    await logIngame(interaction, { command: `${command}  (${ban.name} - reason: ${reason})`, ok: true });
    return interaction.editReply(`✅ **${ban.name}** has been unbanned.`);
  } catch (err) {
    await logIngame(interaction, { command, ok: false, error: err.message });
    return interaction.editReply(`❌ ER:LC didn't accept the unban: ${err.message}`);
  }
}

module.exports = { data, execute };
