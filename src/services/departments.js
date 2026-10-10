// Departments hub (/panel departments), built with Discord's Components V2 layout.
// The posted hub has a menu of departments. Each opens privately as a "brochure": the department's
// photo across the top, its short name, full name and logo, the description, and Previous / Next
// buttons to flip through every department.
// Custom emojis are :name: shortcodes, swapped for the server's emoji at send time (src/lib/emojis.js).
const path = require('node:path');
const {
  ContainerBuilder, SectionBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MediaGalleryBuilder,
  ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder, MessageFlags,
} = require('discord.js');
const { kvGet, kvSet } = require('../lib/db');

const ACCENT = 0xe67e22;
const ASSETS = path.join(__dirname, '..', '..', 'assets');
const asset = (rel, name) => new AttachmentBuilder(path.join(ASSETS, rel), { name });

// ---------------------------------------------------------------- content
const HUB = {
  title: 'Departments', emoji: 'w_map',
  intro: 'This is the main hub for every official department on the server, plus any other useful info you’ll need.',
  heading: 'Looking for organizations?',
  body: [
    'At Los Angeles Roleplay we offer a solid range of departments so you can shape your roleplay the way you want. There’s something here for every type of player and every kind of team.',
    'Each department comes with its own training, divisions, group sessions, and more. Click into any department that interests you to see the full details.',
    'You can browse the complete list of departments below..',
  ],
};

// media: photo in assets/departments (falls back to the LA banner when missing).
const DEPARTMENTS = {
  lapd: {
    name: 'Los Angeles Police Department', short: 'LAPD', kind: 'Law Enforcement Agency', emoji: 'dept_lapd',
    logo: 'lapd-logo.png', media: 'lapd-media.webp', invite: 'https://discord.gg/X44ahfH2e',
    about: 'The *Los Angeles Police Department* (LAPD) is responsible for enforcing laws, preventing crime, investigating criminal activity, ensuring public safety and establishing community relations throughout Los Angeles.',
  },
  lafd: {
    name: 'Los Angeles Fire Department', short: 'LAFD', kind: 'Fire & Rescue Agency', emoji: 'dept_lafd',
    logo: 'lafd-logo.png', media: 'lafd-media.webp', invite: 'https://discord.gg/zJmnUztc7',
    about: 'The *Los Angeles Fire Department* (LAFD) is the first call when things go wrong. Firefighters and paramedics respond to fires, medical emergencies, crashes and rescues across the city, treating patients on scene and getting them to the hospital when every second counts.',
  },
  lasd: {
    name: 'Los Angeles Sheriff\'s Department', short: 'LASD', kind: 'Law Enforcement Agency', emoji: 'dept_lasd',
    logo: 'lasd-logo.png', media: 'lasd-media.webp', invite: 'https://discord.gg/CcaEPmxst',
    about: 'The *Los Angeles Sheriff\'s Department* (LASD) keeps the peace across Los Angeles County. Deputies patrol the county roads and communities outside the city, respond to calls and back up other agencies, all built on three words: **Service. Trust. Accountability.**',
  },
  gov: {
    name: 'Los Angeles Government', short: 'GOV', kind: 'City Government', emoji: 'dept_gov',
    logo: 'gov-logo.png', media: 'gov-media.webp', invite: 'https://discord.gg/HW6xxGQNC',
    about: 'The *Los Angeles Government* is the backbone of the city. From the courthouse to city hall, it handles laws, court cases and public services, and keeps every department working together so Los Angeles runs smoothly.',
  },
  dot: {
    name: 'Los Angeles Department of Transportation', short: 'LADOT', kind: 'Transportation Agency', emoji: 'dept_dot',
    logo: 'dot-logo.png', media: 'dot-media.webp', invite: 'https://discord.gg/Jx86cMUcF',
    about: 'The *Los Angeles Department of Transportation* (LADOT) keeps Los Angeles moving. Crews handle roadwork, traffic control and towing, set up closures and clear the road after crashes so everyone gets where they need to go safely.',
  },
};
const ORDER = Object.keys(DEPARTMENTS);

// ---------------------------------------------------------------- building blocks
const text = (content) => new TextDisplayBuilder().setContent(content);
const divider = (big = false) => new SeparatorBuilder().setDivider(true).setSpacing(big ? SeparatorSpacingSize.Large : SeparatorSpacingSize.Small);
const quote = (s) => s.split('\n').map((l) => `> ${l}`).join('\n');

function menu() {
  return new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
    .setCustomId('dp:menu')
    .setPlaceholder('Browse the departments')
    .addOptions(Object.entries(DEPARTMENTS).map(([key, d]) => ({
      label: d.name, description: d.kind, value: key, emoji: { name: d.emoji },
    }))));
}

// ---------------------------------------------------------------- hub
function mainPayload() {
  const c = new ContainerBuilder().setAccentColor(ACCENT)
    .addMediaGalleryComponents(new MediaGalleryBuilder().addItems((i) => i.setURL('attachment://banner-la.png')))
    .addTextDisplayComponents(text(`# :${HUB.emoji}: ${HUB.title}\n${HUB.intro}`))
    .addSeparatorComponents(divider(true))
    .addTextDisplayComponents(text(`### ${HUB.heading}\n${HUB.body.join('\n\n')}`))
    .addActionRowComponents(menu());
  return {
    components: [c], files: [asset('banner-la.png', 'banner-la.png')],
    flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] },
  };
}

// ---------------------------------------------------------------- department brochure
function pagePayload(key) {
  const d = DEPARTMENTS[key];
  const at = ORDER.indexOf(key);
  const media = d.media ? { file: asset(path.join('departments', d.media), d.media), name: d.media } : { file: asset('banner-la.png', 'banner-la.png'), name: 'banner-la.png' };
  const c = new ContainerBuilder().setAccentColor(ACCENT)
    .addMediaGalleryComponents(new MediaGalleryBuilder().addItems((i) => i.setURL(`attachment://${media.name}`).setDescription(d.name)))
    .addSectionComponents(new SectionBuilder()
      .addTextDisplayComponents(text(`# ${d.short}\n**:${d.emoji}: ${d.name}**\n-# ${d.kind}`))
      .setThumbnailAccessory((t) => t.setURL(`attachment://${d.logo}`).setDescription(`${d.name} logo`)))
    .addSeparatorComponents(divider(true))
    .addTextDisplayComponents(text(quote(d.about)))
    .addSeparatorComponents(divider(true))
    .addActionRowComponents(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(d.invite).setLabel(`Join ${d.short}`),
      new ButtonBuilder().setCustomId(`dp:go:${ORDER[(at - 1 + ORDER.length) % ORDER.length]}`).setLabel('Previous').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`dp:go:${ORDER[(at + 1) % ORDER.length]}`).setLabel('Next').setStyle(ButtonStyle.Primary),
    ))
    .addTextDisplayComponents(text(`-# Department ${at + 1} of ${ORDER.length} · Los Angeles Roleplay`));
  return {
    components: [c], files: [media.file, asset(path.join('departments', d.logo), d.logo)],
    flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] },
  };
}

// ---------------------------------------------------------------- interactions
async function onMenu(interaction) {
  return show(interaction, interaction.values[0]);
}
async function onButton(interaction) {
  const [, , key] = interaction.customId.split(':');
  return show(interaction, key);
}
async function show(interaction, key) {
  if (!DEPARTMENTS[key]) return interaction.reply({ content: 'That department no longer exists.', flags: MessageFlags.Ephemeral });
  const payload = pagePayload(key);
  // Inside a private page, switch it in place; from the public hub, open a new private page.
  if (interaction.message?.flags?.has(MessageFlags.Ephemeral)) return interaction.update({ ...payload, attachments: [] });
  return interaction.reply({ ...payload, flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
}

// ---------------------------------------------------------------- posting
async function post(channel) {
  const msg = await channel.send(mainPayload());
  kvSet('panel_departments', { channelId: channel.id, messageId: msg.id });
  return msg;
}

// Re-renders the posted hub (design changes, or emojis re-uploaded with new IDs).
async function refresh(client) {
  const ref = kvGet('panel_departments');
  if (!ref) return;
  const ch = await client.channels.fetch(ref.channelId).catch(() => null);
  const msg = await ch?.messages.fetch(ref.messageId).catch(() => null);
  if (!msg) return kvSet('panel_departments', null);
  await msg.edit({ ...mainPayload(), attachments: [] }).catch((err) => console.warn('[departments]', err.message));
}

module.exports = { DEPARTMENTS, mainPayload, pagePayload, post, refresh, onMenu, onButton };
