// Server guidelines panel (/panel guidelines), built with Discord's Components V2 layout.
// The posted message holds two menus (Regulations, Banned Items). Each section opens privately;
// long sections are split into pages with Previous / Next buttons. Text lives in guidelinesContent.js.
// Custom emojis are written as :name: shortcodes and swapped for the server's emoji at send time
// (src/lib/emojis.js), so re-uploaded emojis don't break the panel.
const path = require('node:path');
const {
  ContainerBuilder, SectionBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MediaGalleryBuilder,
  ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder, MessageFlags,
} = require('discord.js');
const { kvGet, kvSet } = require('../lib/db');
const { main, sections } = require('./guidelinesContent');

const ACCENT = 0xe67e22;
const PAGE_BUDGET = 3200; // characters of rule text per page (Discord allows 4000 per message)
const ASSETS = path.join(__dirname, '..', '..', 'assets');
const file = (name) => new AttachmentBuilder(path.join(ASSETS, name), { name });

const text = (content) => new TextDisplayBuilder().setContent(content);
const divider = (big = false) => new SeparatorBuilder().setDivider(true).setSpacing(big ? SeparatorSpacingSize.Large : SeparatorSpacingSize.Small);

// ---------------------------------------------------------------- pages
// Each page is a list of blocks; a section with rules is split so no page gets too long.
function pagesOf(key) {
  const s = sections[key];
  if (s.sections) return [s.sections.map(([title, body]) => (title ? `### ${title}\n${body}` : body))];
  // Evenly sized pages: work out how many are needed, then fill each up to the average.
  const blocks = s.rules.map(([title, body]) => `### ${title}\n${body}`);
  const total = blocks.reduce((n, b) => n + b.length, 0);
  const count = Math.ceil(total / PAGE_BUDGET);
  const target = total / count;
  const pages = [];
  let current = [];
  let size = 0;
  for (const block of blocks) {
    if (current.length && pages.length < count - 1 && size + block.length / 2 > target) {
      pages.push(current);
      current = [];
      size = 0;
    }
    current.push(block);
    size += block.length;
  }
  if (current.length) pages.push(current);
  return pages;
}

function menu(group, selected = null) {
  const options = Object.entries(sections).filter(([, s]) => s.group === group).map(([key, s]) => ({
    label: s.label, value: key, emoji: { name: s.emoji }, default: key === selected,
  }));
  return new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
    .setCustomId(`gl:menu:${group}`)
    .setPlaceholder(group === 'reg' ? 'Select a regulation' : 'Select a banned item')
    .addOptions(options));
}

function pagePayload(key, pageNo = 0) {
  const s = sections[key];
  const pages = pagesOf(key);
  const n = Math.max(0, Math.min(pageNo, pages.length - 1));
  const c = new ContainerBuilder().setAccentColor(ACCENT);

  const head = [`## :${s.emoji}: ${s.label}`];
  if (pages.length > 1) head.push(`-# Page ${n + 1} of ${pages.length}`);
  if (n === 0 && s.intro) head.push('', s.intro);
  c.addTextDisplayComponents(text(head.join('\n')));
  c.addSeparatorComponents(divider(true));

  pages[n].forEach((block, i) => {
    if (i) c.addSeparatorComponents(divider());
    c.addTextDisplayComponents(text(block));
  });
  if (n === pages.length - 1 && s.outro) {
    c.addSeparatorComponents(divider(true));
    c.addTextDisplayComponents(text(`-# ${s.outro}`));
  }

  c.addSeparatorComponents(divider(true));
  if (pages.length > 1) {
    c.addActionRowComponents(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`gl:page:${key}:${n - 1}`).setLabel('Previous').setStyle(ButtonStyle.Secondary).setDisabled(n === 0),
      new ButtonBuilder().setCustomId('gl:noop').setLabel(`${n + 1} / ${pages.length}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
      new ButtonBuilder().setCustomId(`gl:page:${key}:${n + 1}`).setLabel('Next').setStyle(ButtonStyle.Primary).setDisabled(n === pages.length - 1),
    ));
  }
  c.addActionRowComponents(menu(s.group, key));
  return { components: [c], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } };
}

// ---------------------------------------------------------------- main panel
// One row per section: emoji + name + a short line, with a Read button on the right.
function blurb(s) {
  if (s.rules) return `${s.rules.length} rules`;
  const items = s.sections.reduce((n, [, body]) => n + body.split('\n').filter((l) => l.startsWith('- ')).length, 0);
  return `${items} ${s.label.split(' ').pop().toLowerCase()}`;
}

function row(key) {
  const s = sections[key];
  return new SectionBuilder()
    .addTextDisplayComponents(text(`**:${s.emoji}: ${s.label}**\n-# ${blurb(s)}`))
    .setButtonAccessory(new ButtonBuilder().setCustomId(`gl:open:${key}`).setLabel('Read').setStyle(ButtonStyle.Secondary));
}

function mainPayload() {
  const keys = (group) => Object.keys(sections).filter((k) => sections[k].group === group);
  const c = new ContainerBuilder().setAccentColor(ACCENT)
    .addMediaGalleryComponents(new MediaGalleryBuilder().addItems((i) => i.setURL('attachment://banner-guidelines.png')))
    .addTextDisplayComponents(text(`# :${main.emoji}: ${main.title}\n${main.intro}`))
    .addSeparatorComponents(divider(true))
    .addTextDisplayComponents(text(`-# :${main.regulations.emoji}: ${main.regulations.title.toUpperCase()}`));
  for (const k of keys('reg')) c.addSectionComponents(row(k));
  c.addSeparatorComponents(divider(true))
    .addTextDisplayComponents(text(`-# :${main.banned.emoji}: ${main.banned.title.toUpperCase()}`));
  for (const k of keys('ban')) c.addSectionComponents(row(k));
  c.addSeparatorComponents(divider(true))
    .addTextDisplayComponents(text('-# Every page opens privately, so only you can see it.'));
  return {
    components: [c], files: [file('banner-guidelines.png')],
    flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] },
  };
}

// ---------------------------------------------------------------- interactions
async function onMenu(interaction) {
  return show(interaction, interaction.values[0], 0);
}
async function onButton(interaction) {
  const [, kind, key, page] = interaction.customId.split(':');
  if (kind === 'open') return show(interaction, key, 0);
  if (kind !== 'page') return interaction.deferUpdate();
  return show(interaction, key, Number(page));
}
async function show(interaction, key, page) {
  if (!sections[key]) return interaction.reply({ content: 'That section no longer exists.', flags: MessageFlags.Ephemeral });
  const payload = pagePayload(key, page);
  // Inside a private page, switch it in place; from the public panel, open a new private page.
  if (interaction.message?.flags?.has(MessageFlags.Ephemeral)) return interaction.update(payload);
  return interaction.reply({ ...payload, flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
}

// ---------------------------------------------------------------- posting
async function post(channel) {
  const msg = await channel.send(mainPayload());
  kvSet('panel_guidelines', { channelId: channel.id, messageId: msg.id });
  return msg;
}

// Re-renders the posted panel (e.g. after emojis were re-uploaded with new IDs).
async function refresh(client) {
  const ref = kvGet('panel_guidelines');
  if (!ref) return;
  const ch = await client.channels.fetch(ref.channelId).catch(() => null);
  const msg = await ch?.messages.fetch(ref.messageId).catch(() => null);
  if (!msg) return kvSet('panel_guidelines', null);
  await msg.edit({ ...mainPayload(), attachments: [] }).catch((err) => console.warn('[guidelines]', err.message));
}

module.exports = { sections, pagesOf, mainPayload, pagePayload, post, refresh, onMenu, onButton };
