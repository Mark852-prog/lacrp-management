// /ticketpanel - posts the ticket panel (admins only).
const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const tickets = require('../lib/tickets');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ticketpanel')
    .setDescription('Post the ticket panel')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addChannelOption((o) => o.setName('channel').setDescription('Where to post it (default: here)')
      .addChannelTypes(ChannelType.GuildText)),

  async execute(interaction) {
    const channel = interaction.options.getChannel('channel') ?? interaction.channel;
    await channel.send(tickets.panel());
    return interaction.reply({ content: `Ticket panel posted in ${channel}.`, flags: MessageFlags.Ephemeral });
  },
};
