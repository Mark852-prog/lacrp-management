const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const { guard } = require('../lib/permissions');
const panels = require('../services/panels');
const guidelines = require('../services/guidelines');
const departments = require('../services/departments');
const boosters = require('../services/boosters');

const channelOpt = (o) => o.setName('channel').setDescription('Where to post it (default: this channel)').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement);

// Server tool: hidden from everyone without Administrator; the code still only lets the bot owner run it.
const data = new SlashCommandBuilder()
  .setDefaultMemberPermissions(0)
  .setName('panel')
  .setDescription('Post a self-updating panel (bot owner only).')
  .addSubcommand((s) => s.setName('status').setDescription('Live server status - refreshes every minute.').addChannelOption(channelOpt))
  .addSubcommand((s) => s.setName('commands').setDescription('In-game announcement commands - updates when announcements change.').addChannelOption(channelOpt))
  .addSubcommand((s) => s.setName('guidelines').setDescription('Server guidelines with Regulations and Banned Items menus.').addChannelOption(channelOpt))
  .addSubcommand((s) => s.setName('departments').setDescription('Departments hub with a page and Discord link per department.').addChannelOption(channelOpt))
  .addSubcommand((s) => s.setName('booster-preview').setDescription('Preview the thank-you message new boosters get in #advocates (only you see it).'));

async function execute(interaction) {
  if (!(await guard(interaction, 'owner'))) return;
  if (interaction.options.getSubcommand() === 'booster-preview') {
    const msg = boosters.thankYouMessage(interaction.member, { isNew: true });
    return interaction.reply({ ...msg, flags: msg.flags | MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const channel = interaction.options.getChannel('channel') ?? interaction.channel;
  const sub = interaction.options.getSubcommand();
  if (sub === 'guidelines' || sub === 'departments') {
    await (sub === 'guidelines' ? guidelines : departments).post(channel);
    return interaction.editReply(`✅ ${sub === 'guidelines' ? 'Guidelines' : 'Departments hub'} posted in ${channel}. Its pages open privately for whoever picks them.`);
  }
  if (sub === 'status') await panels.postStatus(channel);
  else await panels.postCommands(channel);
  return interaction.editReply(`✅ ${sub === 'status' ? 'Status' : 'Commands'} panel posted in ${channel}. It keeps itself up to date — posting a new one replaces the old one's updates.`);
}

module.exports = {
  data, execute,
  selects: { gl: guidelines.onMenu, dp: departments.onMenu },
  buttons: { gl: guidelines.onButton, dp: departments.onButton },
};
