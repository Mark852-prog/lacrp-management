const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { guard } = require('../lib/permissions');
const counting = require('../services/counting');

const data = new SlashCommandBuilder()
  .setName('counting')
  .setDescription('The counting game.')
  .addSubcommand((sub) => sub
    .setName('status')
    .setDescription('Show the current count and the high score.'))
  .addSubcommand((sub) => sub
    .setName('set')
    .setDescription('Set the count (bot owner only), e.g. to carry on after the bot was offline.')
    .addIntegerOption((o) => o.setName('number').setDescription('The last number that was counted correctly').setRequired(true).setMinValue(0).setMaxValue(999999999))
    .addUserOption((o) => o.setName('last_counter').setDescription('Who counted that number (they can\'t count the next one)')));

async function execute(interaction) {
  const sub = interaction.options.getSubcommand();

  if (sub === 'status') {
    const state = counting.load();
    return interaction.reply({
      content: `🔢 The count is at **${state.current}**, so the next number is **${state.current + 1}**.\n` +
        `${state.lastUser ? `Last counted by <@${state.lastUser}>.\n` : ''}🏆 High score: **${state.best}**`,
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
  }

  if (!(await guard(interaction, 'owner'))) return;
  const number = interaction.options.getInteger('number', true);
  const user = interaction.options.getUser('last_counter');
  counting.setCount(number, user?.id ?? null);
  return interaction.reply({
    content: `✅ Count set to **${number}**. The next number is **${number + 1}**${user ? `, and ${user} can't count it` : ''}.`,
    flags: MessageFlags.Ephemeral,
    allowedMentions: { parse: [] },
  });
}

module.exports = { data, execute };
