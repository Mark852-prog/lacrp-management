const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { guard } = require('../lib/permissions');
const requests = require('../lib/staffRequests');

const data = new SlashCommandBuilder()
  .setName('staff-request-deny')
  .setDescription('Deny a pending staff request.')
  .addIntegerOption((o) => o.setName('id').setDescription('Request number').setRequired(true).setMinValue(1))
  .addStringOption((o) => o.setName('reason').setDescription('Reason (sent to the requester)').setRequired(true).setMaxLength(500));

async function execute(interaction) {
  if (!(await guard(interaction, 'supervisor'))) return;
  const id = interaction.options.getInteger('id');
  const res = await requests.decide(interaction.client, id, false, interaction.user.id, interaction.options.getString('reason'));
  return interaction.reply({ content: res.ok ? '❌ Denied request #' + id + '.' : '⚠️ ' + res.error, flags: MessageFlags.Ephemeral });
}

module.exports = { data, execute };
