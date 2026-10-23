// /verify - staff manually verify someone Bloxlink can't (link their Roblox account by hand).
// The link is stored in manual_links and wins over Bloxlink everywhere (nicknames, /server-check, /player).
const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { guard } = require('../lib/permissions');
const { run, get, now } = require('../lib/db');
const { plain } = require('../lib/embeds');
const { role, fetchChannel } = require('../lib/guildConfig');
const verifiedRoles = require('../services/verifiedRoles');

const data = new SlashCommandBuilder()
  .setName('verify')
  .setDescription('Manually verify members who can\'t verify with Bloxlink (staff).')
  .addSubcommand((s) => s.setName('user').setDescription('Link a member to their Roblox account and give them Verified.')
    .addUserOption((o) => o.setName('member').setDescription('The Discord member').setRequired(true))
    .addStringOption((o) => o.setName('roblox').setDescription('Their Roblox username or user ID').setRequired(true).setMaxLength(40)))
  .addSubcommand((s) => s.setName('remove').setDescription('Remove a manual verification.')
    .addUserOption((o) => o.setName('member').setDescription('The Discord member').setRequired(true)))
  .addSubcommand((s) => s.setName('check').setDescription('See how a member is linked.')
    .addUserOption((o) => o.setName('member').setDescription('The Discord member').setRequired(true)));

// Roblox username or ID -> { id, name }, null if no such account.
async function findRoblox(input) {
  const opts = { signal: AbortSignal.timeout(10_000) };
  if (/^\d+$/.test(input)) {
    const res = await fetch(`https://users.roblox.com/v1/users/${input}`, opts);
    if (res.status === 404 || res.status === 400) return null;
    if (!res.ok) throw new Error(`Roblox answered ${res.status}`);
    const u = await res.json();
    return { id: Number(u.id), name: u.name };
  }
  const res = await fetch('https://users.roblox.com/v1/usernames/users', {
    ...opts,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usernames: [input], excludeBannedUsers: false }),
  });
  if (!res.ok) throw new Error(`Roblox answered ${res.status}`);
  const u = (await res.json()).data?.[0];
  return u ? { id: Number(u.id), name: u.name } : null;
}

async function log(interaction, title, fields) {
  const channel = await fetchChannel(interaction.client, 'audit_logs');
  if (!channel) return;
  const embed = plain().setTitle(title).addFields({ name: 'Staff', value: `<@${interaction.user.id}>`, inline: true }, ...fields).setTimestamp();
  await channel.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => {});
}

async function execute(interaction) {
  if (!(await guard(interaction, 'staff'))) return;
  const sub = interaction.options.getSubcommand();
  const user = interaction.options.getUser('member');
  const member = await interaction.guild.members.fetch(user.id).catch(() => null);
  if (!member) return interaction.reply({ content: '❌ That person isn\'t in the server.', flags: MessageFlags.Ephemeral });
  const verifiedRole = role('verified');

  if (sub === 'check') {
    const manual = get('SELECT * FROM manual_links WHERE discord_id = ?', member.id);
    const blox = get('SELECT roblox_id FROM discord_links WHERE discord_id = ?', member.id);
    const lines = [
      manual
        ? `🛠️ **Manually verified** as [${manual.roblox_name}](https://www.roblox.com/users/${manual.roblox_id}/profile) by <@${manual.linked_by}> <t:${manual.linked_at}:R>`
        : '🛠️ No manual verification.',
      blox?.roblox_id ? `🔗 Bloxlink: linked to \`${blox.roblox_id}\`` : '🔗 Bloxlink: not linked (or not checked yet).',
      verifiedRole ? (member.roles.cache.has(verifiedRole) ? '✅ Has the Verified role.' : '⛔ Does not have the Verified role.') : '',
    ];
    return interaction.reply({ content: lines.filter(Boolean).join('\n'), flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
  }

  if (sub === 'remove') {
    const manual = get('SELECT * FROM manual_links WHERE discord_id = ?', member.id);
    if (!manual) return interaction.reply({ content: `${member} isn't manually verified.`, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
    run('DELETE FROM manual_links WHERE discord_id = ?', member.id);
    run('DELETE FROM discord_links WHERE discord_id = ?', member.id);
    if (verifiedRole) await member.roles.remove(verifiedRole, `Manual verification removed by ${interaction.user.tag}`).catch(() => {});
    const unverified = verifiedRoles.unverifiedRole(interaction.guild);
    if (unverified) await member.roles.add(unverified, `Manual verification removed by ${interaction.user.tag}`).catch(() => {});
    await log(interaction, '🛠️ Manual verification removed', [
      { name: 'Member', value: `${member}`, inline: true },
      { name: 'Was', value: `${manual.roblox_name} \`${manual.roblox_id}\``, inline: true },
    ]);
    return interaction.reply({ content: `✅ Removed the manual verification for ${member}.`, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
  }

  // sub === 'user'
  if (member.user.bot) return interaction.reply({ content: '❌ Bots can\'t be verified.', flags: MessageFlags.Ephemeral });
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  let account;
  try {
    account = await findRoblox(interaction.options.getString('roblox').trim());
  } catch (err) {
    return interaction.editReply(`❌ Couldn't reach Roblox: ${err.message}. Try again in a minute.`);
  }
  if (!account) return interaction.editReply('❌ No Roblox account with that username or ID.');

  const taken = get('SELECT discord_id FROM manual_links WHERE roblox_id = ? AND discord_id != ?', account.id, member.id);
  if (taken) return interaction.editReply(`❌ **${account.name}** is already manually linked to <@${taken.discord_id}>. Run \`/verify remove\` on them first.`);

  run(
    `INSERT INTO manual_links(discord_id, roblox_id, roblox_name, linked_by, linked_at) VALUES(?, ?, ?, ?, ?)
     ON CONFLICT(discord_id) DO UPDATE SET roblox_id = excluded.roblox_id, roblox_name = excluded.roblox_name, linked_by = excluded.linked_by, linked_at = excluded.linked_at`,
    member.id, account.id, account.name, interaction.user.id, now(),
  );

  const done = [`✅ ${member} is now verified as **[${account.name}](https://www.roblox.com/users/${account.id}/profile)**.`];
  if (!verifiedRole) done.push('⚠️ No Verified role is set, so no role was given. Set it with `/setup roles verified`.');
  else if (!member.roles.cache.has(verifiedRole)) {
    // Giving the role also triggers the nickname sync (services/nicknames.js).
    const ok = await member.roles.add(verifiedRole, `Manually verified by ${interaction.user.tag}`).then(() => true, () => false);
    if (!ok) done.push('⚠️ Couldn\'t give the Verified role. The bot\'s role must be above it.');
  }
  // Already had Verified (so no role-change event): take Unverified off here too.
  await member.fetch(true).then((m) => verifiedRoles.fix(m)).catch(() => {});
  if (member.manageable && member.nickname !== account.name && member.id !== interaction.guild.ownerId) {
    await member.setNickname(account.name, 'Manually verified: nickname = Roblox username').catch(() => {});
  }

  await log(interaction, '🛠️ Manually verified', [
    { name: 'Member', value: `${member}`, inline: true },
    { name: 'Roblox', value: `[${account.name}](https://www.roblox.com/users/${account.id}/profile) \`${account.id}\``, inline: true },
  ]);
  return interaction.editReply({ content: done.join('\n'), allowedMentions: { parse: [] } });
}

module.exports = { data, execute };
