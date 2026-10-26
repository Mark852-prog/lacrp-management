// Ticket system: the panel posted by /ticketpanel, the form a member fills in, the private ticket channel,
// and closing a ticket with a transcript in #ticket-transcripts.
const path = require('node:path');
const {
  ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, MessageFlags,
  ModalBuilder, OverwriteType, PermissionFlagsBits: P, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle,
} = require('discord.js');
const { ACCESS, normalize } = require('./layout');
const { COLORS } = require('./branding');

const BANNER = path.join(__dirname, '..', '..', 'assets', 'ticket-banner.webp');
const CATEGORY_NAME = 'Open Tickets'; // kept outside the [LAPD] categories so /setup never touches it
const TRANSCRIPTS = 'tickettranscripts';

// `staff` is who can see and handle the ticket (see ACCESS in layout.js). `emoji` is a custom server emoji name.
const TYPES = {
  general: {
    label: 'General Support', emoji: 'id_card', staff: 'supervisors',
    description: 'Questions, concerns or technical problems.',
    about: 'For any question, concern or technical problem you run into in the department. '
      + 'This is not the place to report an officer; open an Officer Misconduct ticket for that.',
    fields: [
      ['subject', 'What do you need help with?', TextInputStyle.Short],
      ['details', 'Give us the details', TextInputStyle.Paragraph],
    ],
  },
  misconduct: {
    label: 'Officer Misconduct', emoji: 'ia_seal', staff: 'ia',
    description: 'Report an officer to Internal Affairs.',
    about: "For reporting an officer's conduct. Internal Affairs reviews every report, but action is only taken "
      + 'when there is clear video evidence of what happened. Have your clip ready before you open the ticket.',
    fields: [
      ['officer', "Officer's name or callsign", TextInputStyle.Short],
      ['details', 'What happened?', TextInputStyle.Paragraph],
      ['evidence', 'Video evidence (link)', TextInputStyle.Short],
    ],
  },
  command: {
    label: 'Command Staff', emoji: 'dhr', staff: 'shr',
    description: 'Serious misconduct by a high rank, or a transfer.',
    about: 'For serious misconduct or abuse of power by a high rank, and for transfer requests to Detective, SWAT '
      + 'or another division. These go straight to Command Staff and are handled in confidence.',
    fields: [
      ['subject', 'What is this about?', TextInputStyle.Short],
      ['details', 'Give us the details', TextInputStyle.Paragraph],
    ],
  },
};

// A custom server emoji by name, as message text ("<:name:id>") and as a component emoji. Empty if missing.
const emoji = (guild, name) => guild.emojis.cache.find((e) => e.name === name);
const emojiText = (guild, name) => emoji(guild, name)?.toString() ?? '';

function panel(guild) {
  const e = (name) => emojiText(guild, name);
  const banner = new AttachmentBuilder(BANNER, { name: 'ticket-banner.webp' });
  const embed = new EmbedBuilder()
    .setColor(COLORS.navy)
    .setTitle(`${e('lapd_seal')} LAPD Ticket Support`.trim())
    .setDescription([
      'Welcome to LAPD ticket support. Use the menu below to reach the right team, and have everything '
        + 'ready before you open a ticket so we can help you straight away.',
      '',
      `${e('rules')} **Before you open a ticket**`.trim(),
      "- Say why you're opening the ticket as soon as it opens. Tickets left empty or idle are closed.",
      '- Misconduct reports need video evidence. Screenshots and witness statements are not accepted.',
      '- Be patient and respectful. Pinging Internal Affairs agents or Command Staff, or showing an attitude, '
        + 'gets your ticket closed and can get you blacklisted from tickets.',
      '- Infraction appeals and requests to be roled after a training are not handled through tickets.',
      ...Object.values(TYPES).flatMap((t) => ['', `${e(t.emoji)} **${t.label}**`.trim(), t.about]),
    ].join('\n'))
    .setImage('attachment://ticket-banner.webp')
    .setFooter({ text: 'By opening a ticket, you agree to the guidelines above.' });
  const menu = new StringSelectMenuBuilder()
    .setCustomId('ticket:open')
    .setPlaceholder('Select a ticket type')
    .addOptions(Object.entries(TYPES).map(([value, t]) => {
      const option = { value, label: t.label, description: t.description };
      const custom = emoji(guild, t.emoji);
      if (custom) option.emoji = { id: custom.id, name: custom.name };
      return option;
    }));
  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(menu)], files: [banner] };
}

const staffRoles = (guild, type) => (ACCESS[TYPES[type].staff] ?? [])
  .map((name) => guild.roles.cache.find((r) => r.name === name))
  .filter(Boolean);

const findOpen = (guild, type, userId) => guild.channels.cache.find((c) => c.topic === `ticket:${type}:${userId}`);

async function ticketCategory(guild) {
  // Also picks up the older "📩 Open Tickets" name and renames it.
  const existing = guild.channels.cache.find((c) => c.type === ChannelType.GuildCategory && c.name.endsWith(CATEGORY_NAME));
  if (existing) return existing.name === CATEGORY_NAME ? existing : existing.setName(CATEGORY_NAME);
  return guild.channels.create({
    name: CATEGORY_NAME,
    type: ChannelType.GuildCategory,
    permissionOverwrites: [
      { id: guild.id, type: OverwriteType.Role, deny: [P.ViewChannel] },
      { id: guild.members.me.id, type: OverwriteType.Member, allow: [P.ViewChannel, P.SendMessages, P.ManageChannels, P.ReadMessageHistory, P.AttachFiles, P.EmbedLinks] },
    ],
    reason: 'Ticket category',
  });
}

// Step 1: picked a type from the panel -> show the form (or point to the ticket they already have).
async function onSelect(interaction) {
  const type = interaction.values[0];
  const open = findOpen(interaction.guild, type, interaction.user.id);
  if (open) {
    return interaction.reply({ content: `You already have a ${TYPES[type].label} ticket open: ${open}`, flags: MessageFlags.Ephemeral });
  }
  const modal = new ModalBuilder().setCustomId(`ticket:form:${type}`).setTitle(TYPES[type].label);
  for (const [id, label, style] of TYPES[type].fields) {
    modal.addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style).setRequired(true)
        .setMinLength(style === TextInputStyle.Paragraph ? 20 : 2).setMaxLength(style === TextInputStyle.Paragraph ? 1000 : 200),
    ));
  }
  return interaction.showModal(modal);
}

// Step 2: filled in the form -> create the private ticket channel.
async function onForm(interaction, type) {
  const { guild, user } = interaction;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  if (findOpen(guild, type, user.id)) return interaction.editReply('You already have a ticket of this type open.');

  const staff = staffRoles(guild, type);
  const access = [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.AttachFiles, P.EmbedLinks];
  const channel = await guild.channels.create({
    name: `${type}-${user.username}`.slice(0, 90),
    parent: (await ticketCategory(guild)).id,
    topic: `ticket:${type}:${user.id}`,
    permissionOverwrites: [
      { id: guild.id, type: OverwriteType.Role, deny: [P.ViewChannel] },
      { id: guild.members.me.id, type: OverwriteType.Member, allow: [...access, P.ManageChannels] },
      { id: user.id, type: OverwriteType.Member, allow: access },
      ...staff.map((r) => ({ id: r.id, type: OverwriteType.Role, allow: access })),
    ],
    reason: `${TYPES[type].label} ticket for ${user.tag}`,
  });

  const embed = new EmbedBuilder()
    .setColor(COLORS.navy)
    .setTitle(`${emojiText(guild, TYPES[type].emoji)} ${TYPES[type].label}`.trim())
    .setDescription(`Opened by ${user}. Someone will be with you soon. Please don't ping staff.`)
    .addFields(TYPES[type].fields.map(([id, label]) => ({ name: label, value: interaction.fields.getTextInputValue(id) })))
    .setTimestamp();
  const close = new ButtonBuilder().setCustomId('ticket:close').setLabel('Close ticket').setStyle(ButtonStyle.Danger);
  await channel.send({ content: `${user}`, embeds: [embed], components: [new ActionRowBuilder().addComponents(close)] });
  return interaction.editReply(`Your ticket is open: ${channel}`);
}

// Step 3: close -> transcript to #ticket-transcripts, then delete the channel.
async function onClose(interaction) {
  const { channel, guild, member } = interaction;
  const [, type, openerId] = (channel.topic ?? '').split(':');
  if (!TYPES[type]) return interaction.reply({ content: 'This is not a ticket channel.', flags: MessageFlags.Ephemeral });
  const isStaff = member.permissions.has(P.Administrator)
    || staffRoles(guild, type).some((r) => member.roles.cache.has(r.id));
  if (!isStaff && member.id !== openerId) {
    return interaction.reply({ content: 'Only staff or the person who opened this ticket can close it.', flags: MessageFlags.Ephemeral });
  }
  await interaction.reply('Closing this ticket in 5 seconds...');

  const messages = [];
  let before;
  while (messages.length < 1000) {
    const batch = await channel.messages.fetch({ limit: 100, before });
    if (!batch.size) break;
    messages.push(...batch.values());
    before = batch.last().id;
  }
  const lines = messages.reverse().map((m) => {
    const extras = [...m.embeds.map((e) => [e.title, e.description, ...e.fields.map((f) => `${f.name}: ${f.value}`)].filter(Boolean).join(' | ')),
      ...m.attachments.map((a) => a.url)];
    return `[${m.createdAt.toISOString().replace('T', ' ').slice(0, 16)}] ${m.author.tag}: ${[m.content, ...extras].filter(Boolean).join(' ')}`;
  });

  const log = guild.channels.cache.find((c) => normalize(c.name) === TRANSCRIPTS);
  if (log) {
    const embed = new EmbedBuilder()
      .setColor(COLORS.navy)
      .setTitle(`${TYPES[type].label} ticket closed`)
      .addFields(
        { name: 'Opened by', value: `<@${openerId}>`, inline: true },
        { name: 'Closed by', value: `${interaction.user}`, inline: true },
        { name: 'Messages', value: `${messages.length}`, inline: true },
      )
      .setTimestamp();
    const file = new AttachmentBuilder(Buffer.from(lines.join('\n')), { name: `${channel.name}.txt` });
    await log.send({ embeds: [embed], files: [file] }).catch((err) => console.warn(`Ticket transcript failed: ${err.message}`));
  }
  setTimeout(() => channel.delete(`Ticket closed by ${interaction.user.tag}`).catch(() => {}), 5000);
}

async function handle(interaction) {
  const [, action, type] = interaction.customId.split(':');
  if (action === 'open' && interaction.isStringSelectMenu()) return onSelect(interaction);
  if (action === 'form' && interaction.isModalSubmit() && TYPES[type]) return onForm(interaction, type);
  if (action === 'close' && interaction.isButton()) return onClose(interaction);
}

module.exports = { panel, handle, TYPES };
