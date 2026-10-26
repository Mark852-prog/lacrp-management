// /ticketpanel - posts the ticket panel, or updates the one already in that channel (admins only).
const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const tickets = require('../lib/tickets');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ticketpanel')
    .setDescription('Post or update the ticket panel')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addChannelOption((o) => o.setName('channel').setDescription('Where to post it (default: here)')
      .addChannelTypes(ChannelType.GuildText)),

  async execute(interaction) {
    const channel = interaction.options.getChannel('channel') ?? interaction.channel;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await interaction.guild.emojis.fetch(); // pick up emojis added since the bot started
    const panel = tickets.panel(interaction.guild);

    const recent = await channel.messages.fetch({ limit: 50 });
    const existing = recent.find((m) => m.author.id === interaction.client.user.id
      && m.components.some((row) => row.components.some((c) => c.customId === 'ticket:open')));
    if (existing) {
      await existing.edit({ ...panel, attachments: [] });
      return interaction.editReply(`Ticket panel updated in ${channel}.`);
    }
    await channel.send(panel);
    return interaction.editReply(`Ticket panel posted in ${channel}.`);
  },
};
