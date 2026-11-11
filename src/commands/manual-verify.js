const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { guard } = require('../lib/permissions');
const manual = require('../lib/manualLinks');
const nicknames = require('../services/nicknames');

const data = new SlashCommandBuilder()
  .setName('manual-verify')
  .setDescription("Link a member to a Roblox account by hand, for people who can't verify with Bloxlink.")
  .addUserOption((o) => o.setName('member').setDescription('The Discord member').setRequired(true))
  .addStringOption((o) => o.setName('roblox_username').setDescription('Their exact Roblox username').setRequired(true).setMaxLength(32));

const NO_PINGS = { parse: [] };

async function execute(interaction) {
  if (!(await guard(interaction, 'highRank'))) return;
  const user = interaction.options.getUser('member');
  const typed = interaction.options.getString('roblox_username').trim().replace(/^@/, '');
  const ephemeral = { flags: MessageFlags.Ephemeral, allowedMentions: NO_PINGS };
  if (user.bot) return interaction.reply({ content: "Bots can't be verified.", ...ephemeral });
  if (!manual.USERNAME_RE.test(typed)) {
    return interaction.reply({ content: "That doesn't look like a Roblox username. Use 3 to 20 letters, numbers or underscores.", ...ephemeral });
  }
  await interaction.deferReply(ephemeral);

  const member = await interaction.guild.members.fetch(user.id).catch(() => null);
  if (!member) return interaction.editReply({ content: "That person isn't in this server.", allowedMentions: NO_PINGS });

  let account;
  try {
    account = await manual.lookupRobloxUser(typed);
  } catch (err) {
    return interaction.editReply({ content: `Couldn't reach Roblox (${err.message}). Try again in a moment.`, allowedMentions: NO_PINGS });
  }
  if (!account) return interaction.editReply({ content: `No Roblox account named **${typed}** exists. The username has to be exact.`, allowedMentions: NO_PINGS });

  const taken = manual.byRoblox(account.id);
  if (taken && taken.discord_id !== user.id) {
    return interaction.editReply({ content: `**${account.name}** is already manually linked to <@${taken.discord_id}>. Remove that link first with /manual-unverify.`, allowedMentions: NO_PINGS });
  }

  manual.link({ discordId: user.id, robloxId: account.id, robloxName: account.name, by: interaction.user.id });

  // Nickname = exact Roblox username (same rule as Bloxlink-verified members).
  const result = await nicknames.sync(member, { force: true, reason: `Manually verified by ${interaction.user.tag}: nickname = Roblox username` });
  const nick = {
    renamed: `Their nickname is now **${account.name}**.`,
    ok: `Their nickname already was **${account.name}**.`,
    exempt: "Their nickname wasn't changed, because the bot can't rename this member (server owner, ranked above the bot, or Senior High Rank).",
  }[result] ?? "Their nickname couldn't be changed right now. The automatic check fixes it within 6 hours.";

  return interaction.editReply({
    content: `Linked <@${user.id}> to Roblox account **${account.name}** (ID ${account.id}). ${nick} They no longer show up in the Discord check.`,
    allowedMentions: NO_PINGS,
  });
}

module.exports = { data, execute };
