// /about - who the bot is, with the seal and a random quote.
const path = require('node:path');
const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const { COLORS, MOTTO, randomQuote } = require('../lib/branding');

const ASSETS = path.join(__dirname, '..', '..', 'assets');

module.exports = {
  data: new SlashCommandBuilder().setName('about').setDescription('About the LAPD bot'),

  async execute(interaction) {
    const seal = new AttachmentBuilder(path.join(ASSETS, 'avatar.png'), { name: 'seal.png' });
    const banner = new AttachmentBuilder(path.join(ASSETS, 'banner.png'), { name: 'banner.png' });
    const embed = new EmbedBuilder()
      .setColor(COLORS.navy)
      .setAuthor({ name: 'Los Angeles Police Department', iconURL: 'attachment://seal.png' })
      .setTitle(MOTTO)
      .setDescription([
        'Los Angeles Police Department, LACRP.',
        '',
        `*${randomQuote()}*`,
      ].join('\n'))
      .setThumbnail('attachment://seal.png')
      .setImage('attachment://banner.png')
      .addFields(
        { name: 'Uptime', value: `<t:${Math.floor((Date.now() - interaction.client.uptime) / 1000)}:R>`, inline: true },
        { name: 'Ping', value: `${Math.round(interaction.client.ws.ping)} ms`, inline: true },
      )
      .setFooter({ text: 'LAPD • LACRP', iconURL: 'attachment://seal.png' });
    await interaction.reply({ embeds: [embed], files: [seal, banner] });
  },
};
