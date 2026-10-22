// /timezone panel - Supervisor+: post the "pick your timezone" panel (creates missing roles after confirmation)
// /timezone view  - anyone: a member's timezone and their current local time
const path = require('node:path');
const { DateTime } = require('luxon');
const {
  SlashCommandBuilder, MessageFlags, ChannelType, EmbedBuilder, AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MediaGalleryBuilder,
} = require('discord.js');
const { guard, can } = require('../lib/permissions');
const { BRAND_COLOR } = require('../lib/embeds');
const { config } = require('../lib/config');
const { setSlot } = require('../lib/guildConfig');
const av = require('../lib/availability');

const ASSETS = path.join(__dirname, '..', '..', 'assets');

const data = new SlashCommandBuilder()
  .setName('timezone')
  .setDescription('Timezones: see anyone\'s local time, or post the timezone roles panel.')
  .addSubcommand((s) => s.setName('view').setDescription('See a member\'s timezone and what time it is for them right now.')
    .addUserOption((o) => o.setName('member').setDescription('Who (default: you)')))
  .addSubcommand((s) => s.setName('panel').setDescription('Post the timezone roles panel (Supervisor+).')
    .addChannelOption((o) => o.setName('channel').setDescription('Where to post it (default: this channel)').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)));

// ---------------------------------------------------------------- view
// "3 hours ahead of you", "5 hours 30 min behind you", "the same time as you"
function difference(targetZone, viewerZone) {
  const diff = DateTime.now().setZone(targetZone).offset - DateTime.now().setZone(viewerZone).offset;
  if (!diff) return 'Same time as you';
  const a = Math.abs(diff); const h = Math.floor(a / 60); const m = a % 60;
  return `${h ? `${h} hour${h === 1 ? '' : 's'}` : ''}${h && m ? ' ' : ''}${m ? `${m} min` : ''} ${diff > 0 ? 'ahead of' : 'behind'} you`;
}

function viewEmbed(member, viewer) {
  const z = av.memberZone(member);
  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setAuthor({ name: member.displayName, iconURL: member.displayAvatarURL() })
    .setThumbnail(member.displayAvatarURL({ size: 256 }))
    .setFooter({ text: `${config.settings.serverName} · pick yours on the timezone panel` })
    .setTimestamp();
  if (!z) {
    return embed.setTitle('🕒 Timezone not set')
      .setDescription(`${member} hasn't picked a timezone yet.\n-# They can pick one on the timezone panel, or with \`/availability set\`.`);
  }
  const local = DateTime.now().setZone(z.zone);
  const viewerZone = viewer.id !== member.id ? av.memberZone(viewer) : null;
  const usually = av.summaryLines(member.id);
  embed.setTitle(`🕒 Local time · ${z.label}`)
    .setDescription(`# ${local.toFormat('h:mm a')}\n**${local.toFormat('cccc, d LLLL')}**\n-# ${z.name} · ${av.offsetLabel(z.zone)}`)
    .addFields(
      { name: 'Timezone', value: `${config.timezones.regions[z.region] ?? '🌐'} **${z.label}**\n-# ${z.region}`, inline: true },
      { name: 'UTC offset', value: `**${av.offsetLabel(z.zone)}**\n-# ${z.zone}`, inline: true },
      ...(viewerZone ? [{ name: 'Compared to you', value: `**${difference(z.zone, viewerZone.zone)}**\n-# you're on ${viewerZone.label}`, inline: true }] : []),
      { name: '📅 Usually plays (their time)', value: usually.length ? usually.join('\n') : '-# No availability saved yet — `/availability set`' },
    );
  return embed;
}

// ---------------------------------------------------------------- panel
const text = (content) => new TextDisplayBuilder().setContent(content);
const divider = (big = false) => new SeparatorBuilder().setDivider(true).setSpacing(big ? SeparatorSpacingSize.Large : SeparatorSpacingSize.Small);

function panelPayload() {
  const c = new ContainerBuilder().setAccentColor(BRAND_COLOR)
    .addMediaGalleryComponents(new MediaGalleryBuilder().addItems((i) => i.setURL('attachment://banner-la.png')))
    .addTextDisplayComponents(text(
      '# 🌍 Pick Your Timezone\n' +
      'Tap the timezone you live in. You\'ll get its role, and staff use it to plan sessions at times that work for everyone.\n' +
      '-# Changed your mind or moved? Just tap another one — your old timezone role is removed for you.',
    ))
    .addSeparatorComponents(divider(true));
  const regions = [...new Set(av.zones().map((z) => z.region))];
  for (const region of regions) {
    const list = av.zones().filter((z) => z.region === region);
    c.addTextDisplayComponents(text(`### ${config.timezones.regions[region] ?? '🌐'} ${region}\n-# ${list.map((z) => `**${z.label}** ${z.name}`).join(' · ')}`));
    for (let i = 0; i < list.length; i += 5) {
      c.addActionRowComponents(new ActionRowBuilder().addComponents(list.slice(i, i + 5).map((z) =>
        new ButtonBuilder().setCustomId(`tz:pick:${z.key}`).setLabel(z.label).setStyle(ButtonStyle.Secondary))));
    }
  }
  c.addSeparatorComponents(divider(true))
    .addTextDisplayComponents(text('### 📅 When can you play?\nTell us the days and times you\'re usually free — it takes 30 seconds and helps us host sessions when you can join.'))
    .addActionRowComponents(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('av:open').setLabel('Set my availability').setEmoji('📅').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('tz:me').setLabel('My time').setEmoji('🕒').setStyle(ButtonStyle.Secondary),
    ));
  return {
    components: [c], files: [new AttachmentBuilder(path.join(ASSETS, 'banner-la.png'), { name: 'banner-la.png' })],
    flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] },
  };
}

async function createRolesAndPost(interaction, channel) {
  const created = [];
  for (const z of av.zones()) {
    if (av.zoneRole(interaction.guild, z)) continue;
    const r = await interaction.guild.roles.create({ name: z.role, permissions: [], mentionable: false, hoist: false, reason: `Timezone role (approved by ${interaction.user.tag})` });
    setSlot(`tzrole:${z.key}`, r.id);
    created.push(r);
  }
  await channel.send(panelPayload());
  return created;
}

// ---------------------------------------------------------------- handlers
async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  if (sub === 'view') {
    const user = interaction.options.getUser('member') ?? interaction.user;
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    if (!member) return interaction.reply({ content: 'That person isn\'t in the server.', flags: MessageFlags.Ephemeral });
    return interaction.reply({ embeds: [viewEmbed(member, interaction.member)], flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
  }

  if (!(await guard(interaction, 'supervisor'))) return;
  const channel = interaction.options.getChannel('channel') ?? interaction.channel;
  const missing = av.zones().filter((z) => !av.zoneRole(interaction.guild, z));
  if (missing.length) {
    // Creating roles is a server change: show what will be made and wait for a click.
    const embed = new EmbedBuilder().setColor(BRAND_COLOR).setTitle('🌍 Timezone panel — roles needed')
      .setDescription(`These timezone roles don't exist yet. The bot will create them (no permissions, not pingable, at the bottom of the role list), then post the panel in ${channel}.`)
      .addFields({ name: `Roles to create (${missing.length})`, value: missing.map((z) => `• **${z.role}** — ${z.name}`).join('\n') });
    return interaction.reply({
      embeds: [embed], flags: MessageFlags.Ephemeral,
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`tz:create:${channel.id}`).setLabel('Create roles & post panel').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('tz:cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary),
      )],
    });
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  await channel.send(panelPayload());
  return interaction.editReply(`✅ Timezone panel posted in ${channel}.`);
}

async function button(interaction) {
  const [, action, arg] = interaction.customId.split(':');

  if (action === 'pick') {
    const before = av.memberZone(interaction.member);
    if (before?.key === arg && before.source === 'saved') {
      return interaction.reply({ embeds: [viewEmbed(interaction.member, interaction.member)], content: `You're already on **${before.label}**.`, flags: MessageFlags.Ephemeral });
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const { zone, roleNote } = await av.setMemberZone(interaction.member, arg);
    const local = DateTime.now().setZone(zone.zone);
    const embed = new EmbedBuilder().setColor(BRAND_COLOR)
      .setTitle(`✅ Timezone set: ${zone.label}`)
      .setDescription(`It's **${local.toFormat('h:mm a')}** on ${local.toFormat('cccc')} for you (${zone.name}, ${av.offsetLabel(zone.zone)}).` +
        (before && before.key !== zone.key ? `\n-# Switched from ${before.label}.` : '') +
        (roleNote ? `\n⚠️ Saved, but ${roleNote}.` : ''))
      .addFields({ name: 'Next step', value: 'Tell us when you can usually play, so sessions happen when you\'re around.' });
    return interaction.editReply({
      embeds: [embed],
      components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('av:open').setLabel('Set my availability').setEmoji('📅').setStyle(ButtonStyle.Primary))],
    });
  }

  if (action === 'me') return interaction.reply({ embeds: [viewEmbed(interaction.member, interaction.member)], flags: MessageFlags.Ephemeral });

  if (action === 'cancel') return interaction.update({ content: 'Cancelled — nothing was created.', embeds: [], components: [] });

  if (action === 'create') {
    if (!can(interaction.member, 'supervisor')) return interaction.reply({ content: '🔒 This is limited to **Supervisors and above**.', flags: MessageFlags.Ephemeral });
    const channel = await interaction.guild.channels.fetch(arg).catch(() => null);
    if (!channel) return interaction.update({ content: '⚠️ That channel no longer exists.', embeds: [], components: [] });
    await interaction.update({ content: '⏳ Creating roles…', embeds: [], components: [] });
    const created = await createRolesAndPost(interaction, channel);
    return interaction.editReply(`✅ Created ${created.length} role${created.length === 1 ? '' : 's'} (${created.map((r) => `**${r.name}**`).join(', ') || 'none'}) and posted the panel in ${channel}.`);
  }
}

module.exports = { data, execute, buttons: { tz: button }, viewEmbed };
