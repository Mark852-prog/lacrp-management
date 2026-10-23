const { SlashCommandBuilder, MessageFlags, ChannelType } = require('discord.js');
const { guard } = require('../lib/permissions');

// Server tool: hidden from everyone without Administrator; the code still only lets the bot owner run it.
const data = new SlashCommandBuilder()
  .setDefaultMemberPermissions(0)
  .setName('say')
  .setDescription('Make the bot send a message (bot owner only).')
  .addStringOption((o) => o.setName('message').setDescription('What the bot should say. Use \\n for a new line.').setRequired(true).setMaxLength(2000))
  .addChannelOption((o) => o.setName('channel').setDescription('Where to send it (default: this channel)')
    .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.PublicThread, ChannelType.PrivateThread));

async function execute(interaction) {
  if (!(await guard(interaction, 'owner'))) return;
  const channel = interaction.options.getChannel('channel') ?? interaction.channel;
  const text = interaction.options.getString('message').replace(/\\n/g, '\n');
  // Users and roles can be pinged; @everyone / @here are blocked so /say can't mass-ping.
  await channel.send({ content: text, allowedMentions: { parse: ['users', 'roles'] } });
  return interaction.reply({ content: `✅ Sent in ${channel}.`, flags: MessageFlags.Ephemeral });
}

module.exports = { data, execute };
