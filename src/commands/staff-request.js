const { SlashCommandBuilder, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
const { guard, can } = require('../lib/permissions');
const { fetchChannel } = require('../lib/guildConfig');
const { run } = require('../lib/db');
const requests = require('../lib/staffRequests');
const { withPing } = require('../lib/pings');

const data = new SlashCommandBuilder()
  .setName('staff-request')
  .setDescription('Request to come on duty or host a session.')
  .addStringOption((o) => o.setName('type').setDescription('What are you requesting?').setRequired(true)
    .addChoices(...Object.entries(requests.TYPES).map(([value, name]) => ({ name, value }))))
  .addStringOption((o) => o.setName('details').setDescription('Details (time, reason, etc.)').setRequired(true).setMaxLength(1000));

async function execute(interaction) {
  if (!(await guard(interaction, 'staff'))) return;
  const channel = await fetchChannel(interaction.client, 'staff_requests');
  if (!channel) return interaction.reply({ content: '⚠️ The staff request queue channel isn\'t set up yet. Ask an admin to run `/setup channels`.', flags: MessageFlags.Ephemeral });

  const req = requests.create(interaction.options.getString('type'), interaction.user.id, interaction.options.getString('details'));
  const msg = await channel.send(withPing(requests.requestMessage(interaction.guild, req), 'staff_request'));
  run('UPDATE staff_requests SET channel_id = ?, message_id = ? WHERE id = ?', channel.id, msg.id, req.id);
  return interaction.reply({ content: `📨 Request **#${req.id}** submitted to ${channel}. You'll get a DM when it's handled.`, flags: MessageFlags.Ephemeral });
}

// Queue buttons: staffreq:approve:<id> / staffreq:deny:<id>
async function button(interaction) {
  const [, action, id] = interaction.customId.split(':');
  if (!can(interaction.member, 'supervisor')) {
    return interaction.reply({ content: '🔒 Only Supervisors and above can handle staff requests.', flags: MessageFlags.Ephemeral });
  }
  if (action === 'approve') {
    const res = await requests.decide(interaction.client, Number(id), true, interaction.user.id);
    return interaction.reply({ content: res.ok ? `✅ Approved request #${id}.` : `⚠️ ${res.error}`, flags: MessageFlags.Ephemeral });
  }
  const modal = new ModalBuilder().setCustomId(`staffreq-deny:${id}`).setTitle(`Deny request #${id}`).addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('reason').setLabel('Reason').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(500),
    ),
  );
  return interaction.showModal(modal);
}

async function modal(interaction) {
  const id = Number(interaction.customId.split(':')[1]);
  const res = await requests.decide(interaction.client, id, false, interaction.user.id, interaction.fields.getTextInputValue('reason'));
  return interaction.reply({ content: res.ok ? `❌ Denied request #${id}.` : `⚠️ ${res.error}`, flags: MessageFlags.Ephemeral });
}

module.exports = { data, execute, buttons: { staffreq: button }, modals: { 'staffreq-deny': modal } };
