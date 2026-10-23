// Permission checks based on the roles assigned in /setup.
const { PermissionFlagsBits, MessageFlags } = require('discord.js');
const { role } = require('./guildConfig');

const isAdmin = (member) => member?.permissions?.has(PermissionFlagsBits.ManageGuild) ?? false;

// The only person allowed to configure the bot: BOT_OWNER_ID in .env (falls back to the server owner).
const isOwner = (member) => Boolean(member) && member.id === (process.env.BOT_OWNER_ID || member.guild.ownerId);

function hasSlot(member, slot) {
  const id = role(slot);
  return Boolean(id && member.roles.cache.has(id));
}

// "<slot> and above": holds that role, or any role positioned at/above it in the server's role list.
function atLeast(member, slot) {
  if (isAdmin(member)) return true;
  const id = role(slot);
  if (!id) return false;
  const target = member.guild?.roles?.cache.get(id);
  if (!target) return false;
  return member.roles.cache.some((r) => r.id === id || r.comparePositionTo(target) >= 0);
}

// "<role name> and above" for ranks that have no /setup slot (matched by exact name, case ignored).
function atLeastNamed(member, name) {
  const target = member.guild?.roles?.cache.find((r) => r.name.trim().toLowerCase() === name.toLowerCase());
  return Boolean(target) && member.roles.cache.some((r) => r.id === target.id || r.comparePositionTo(target) >= 0);
}

const LEVELS = {
  staff: (m) => isAdmin(m) || hasSlot(m, 'staff') || atLeast(m, 'supervisor'),
  supervisor: (m) => atLeast(m, 'supervisor') || hasSlot(m, 'high_rank') || hasSlot(m, 'senior_high_rank'),
  highRank: (m) => isAdmin(m) || hasSlot(m, 'high_rank') || hasSlot(m, 'senior_high_rank') || atLeast(m, 'high_rank'),
  // Administrator rank and everything above it.
  admin: (m) => isAdmin(m) || atLeastNamed(m, 'Administrator'),
  owner: isOwner,
};

const LABELS = {
  staff: 'staff members',
  supervisor: 'Supervisors and above',
  highRank: 'High Rank / Senior High Rank',
  admin: 'Administrators and above',
  owner: 'the bot owner',
};

// Returns true if allowed; otherwise replies with an ephemeral error and returns false.
async function guard(interaction, level) {
  const ok = LEVELS[level](interaction.member);
  if (!ok) {
    await interaction.reply({ content: `🔒 This is limited to **${LABELS[level]}**.`, flags: MessageFlags.Ephemeral });
  }
  return ok;
}

module.exports = { isAdmin, isOwner, hasSlot, atLeast, can: (m, level) => LEVELS[level](m), guard };
