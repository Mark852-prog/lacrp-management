// /perm-scan - read-only scan for channels that look restricted but are visible to big/general roles,
// plus general roles that carry dangerous permissions. Changes nothing.
const { SlashCommandBuilder, MessageFlags, AttachmentBuilder, PermissionFlagsBits: P, ChannelType } = require('discord.js');
const { guard } = require('../lib/permissions');

const data = new SlashCommandBuilder()
  .setName('perm-scan')
  .setDescription('Scan channel and role permissions for restricted channels that general roles can see.');

// Channels whose names suggest they are not meant for everybody.
const RESTRICTED = /vip|premium|executive|exec|staff|training|trainee|instructor|internal|affairs|\bia\b|\bhr\b|management|high.?rank|supervisor|admin|mod|log|handbook|phase|department|private|boost|lounge|command|leadership|director/i;
const RISKY = {
  Administrator: P.Administrator, ManageGuild: P.ManageGuild, ManageRoles: P.ManageRoles, ManageChannels: P.ManageChannels,
  BanMembers: P.BanMembers, KickMembers: P.KickMembers, ModerateMembers: P.ModerateMembers, ManageMessages: P.ManageMessages,
  ManageWebhooks: P.ManageWebhooks, MentionEveryone: P.MentionEveryone, ViewAuditLog: P.ViewAuditLog,
};
const SKIP_TYPES = new Set([ChannelType.GuildCategory, ChannelType.PublicThread, ChannelType.PrivateThread, ChannelType.AnnouncementThread]);
const clean = (s) => String(s).replace(/[^\p{L}\p{N} &'()./+|-]/gu, '').replace(/\s+/g, ' ').trim() || String(s);

function scan(guild) {
  const everyone = guild.roles.everyone;
  const total = guild.memberCount || guild.members.cache.size;
  const broadMin = Math.max(15, Math.ceil(total * 0.2)); // a role held by 20%+ of the server counts as "general"
  const roles = guild.roles.cache.filter((r) => r.id !== everyone.id && !r.managed && !r.permissions.has(P.Administrator));
  const broad = roles.filter((r) => r.members.size >= broadMin).sort((a, b) => b.members.size - a.members.size);

  const L = [];
  L.push(`PERMISSION SCAN - ${clean(guild.name)} (${total} members)`);
  L.push(`"General" roles = @everyone plus roles with ${broadMin}+ members: ${broad.map((r) => `${clean(r.name)} (${r.members.size})`).join(', ') || 'none'}`, '');

  // 1. Restricted-looking channels that general roles can open.
  const hits = [];
  const open = [];
  for (const c of guild.channels.cache.values()) {
    if (SKIP_TYPES.has(c.type)) continue;
    const label = `${clean(c.name)}${c.parent ? ` [${clean(c.parent.name)}]` : ''}`;
    const text = `${c.name} ${c.parent?.name ?? ''}`;
    const sees = [];
    if (c.permissionsFor(everyone).has(P.ViewChannel)) sees.push('@everyone');
    for (const r of broad.values()) if (c.permissionsFor(r).has(P.ViewChannel) && !sees.includes('@everyone')) sees.push(`${clean(r.name)} (${r.members.size})`);
    if (RESTRICTED.test(text) && sees.length) hits.push({ label, sees, everyone: sees.includes('@everyone') });
    else if (RESTRICTED.test(text)) open.push(label);
  }
  L.push(`1. RESTRICTED-LOOKING CHANNELS THAT GENERAL ROLES CAN SEE (${hits.length})`);
  if (!hits.length) L.push('   None found.');
  for (const h of hits.sort((a, b) => Number(b.everyone) - Number(a.everyone))) L.push(`   ${h.everyone ? '!!' : '! '} ${h.label}  <-  ${h.sees.join(', ')}`);
  L.push('', `   Restricted-looking channels general roles can NOT see: ${open.length}`, '');

  // 2. General roles carrying dangerous permissions.
  L.push('2. GENERAL ROLES WITH DANGEROUS PERMISSIONS');
  const risky = [everyone, ...broad.values()].map((r) => [r, Object.entries(RISKY).filter(([, f]) => r.permissions.has(f)).map(([k]) => k)]).filter(([, p]) => p.length);
  if (!risky.length) L.push('   None found.');
  for (const [r, p] of risky) L.push(`   ${r.id === everyone.id ? '@everyone' : `${clean(r.name)} (${r.members.size})`}: ${p.join(', ')}`);

  // 3. Roles that are not general but give View Channel on many restricted channels (leaky roles).
  L.push('', '3. SMALL ROLES THAT CAN SEE EVERY RESTRICTED-LOOKING CHANNEL (check these are intended)');
  const restrictedChans = guild.channels.cache.filter((c) => !SKIP_TYPES.has(c.type) && RESTRICTED.test(`${c.name} ${c.parent?.name ?? ''}`));
  const leaky = roles.filter((r) => !broad.has(r.id) && restrictedChans.size && restrictedChans.every((c) => c.permissionsFor(r).has(P.ViewChannel)));
  if (!leaky.size) L.push('   None found.');
  for (const r of leaky.values()) L.push(`   ${clean(r.name)} (${r.members.size})`);

  L.push('', 'Legend: !! = visible to @everyone, !  = visible to a general role. This scan changes nothing.');
  return { text: L.join('\n'), hits: hits.length, everyoneHits: hits.filter((h) => h.everyone).length, risky: risky.length };
}

async function execute(interaction) {
  if (!(await guard(interaction, 'highRank'))) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  await interaction.guild.members.fetch().catch(() => {});
  const r = scan(interaction.guild);
  const summary = `Scan finished: **${r.hits}** restricted-looking channel(s) visible to general roles (**${r.everyoneHits}** to @everyone), **${r.risky}** general role(s) with dangerous permissions. Full report attached.`;
  return interaction.editReply({ content: summary, files: [new AttachmentBuilder(Buffer.from(r.text), { name: 'perm-scan.txt' })] });
}

module.exports = { data, execute, scan };
