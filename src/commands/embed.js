// /embed - build custom embeds in Discord (bot owner only). The same embeds can be edited in the web editor.
const {
  SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags, EmbedBuilder, ActionRowBuilder,
  ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ChannelSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle,
} = require('discord.js');
const { guard, can } = require('../lib/permissions');
const { BRAND_COLOR } = require('../lib/embeds');
const ce = require('../lib/customEmbeds');
const web = require('../services/webEditor');

const nameOpt = (o, desc = 'Saved embed') => o.setName('name').setDescription(desc).setRequired(true).setAutocomplete(true);

// Server tool: hidden from everyone without Administrator; the code still only lets the bot owner run it.
const data = new SlashCommandBuilder()
  .setDefaultMemberPermissions(0)
  .setName('embed')
  .setDescription('Build custom embeds with images, buttons and menus (bot owner only).')
  .addSubcommand((s) => s.setName('create').setDescription('Start a new embed and open the builder.')
    .addStringOption((o) => o.setName('name').setDescription('A name so you can find it later, e.g. "rules"').setRequired(true).setMaxLength(50)))
  .addSubcommand((s) => s.setName('edit').setDescription('Open the builder for a saved embed.').addStringOption((o) => nameOpt(o)))
  .addSubcommand((s) => s.setName('post').setDescription('Post a saved embed in a channel.').addStringOption((o) => nameOpt(o))
    .addChannelOption((o) => o.setName('channel').setDescription('Where (default: here)').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)))
  .addSubcommand((s) => s.setName('image').setDescription('Upload your own top/bottom image for an embed.').addStringOption((o) => nameOpt(o))
    .addStringOption((o) => o.setName('where').setDescription('Which image').setRequired(true).addChoices({ name: 'Top image', value: 'topImage' }, { name: 'Bottom image', value: 'bottomImage' }))
    .addAttachmentOption((o) => o.setName('file').setDescription('PNG, JPG, GIF or WEBP (max 8 MB)').setRequired(true)))
  .addSubcommand((s) => s.setName('rename').setDescription('Rename a saved embed.').addStringOption((o) => nameOpt(o))
    .addStringOption((o) => o.setName('new_name').setDescription('New name').setRequired(true).setMaxLength(50)))
  .addSubcommand((s) => s.setName('list').setDescription('List saved embeds.'))
  .addSubcommand((s) => s.setName('delete').setDescription('Delete a saved embed (posted copies stay, but their buttons stop working).').addStringOption((o) => nameOpt(o)))
  .addSubcommand((s) => s.setName('web').setDescription('Get a private link to the web editor.'));

// ---------- builder panel ----------
const ACTIONS = [
  ['text', '✏️ Title, text, footer & colour'],
  ['topImage', '🖼️ Top image'],
  ['bottomImage', '🖼️ Bottom image'],
  ['add_field', '➕ Add a field'],
  ['remove_field', '➖ Remove a field'],
  ['add_link', '🔗 Add a link button (website or channel)'],
  ['add_button', '➕ Add a hidden-reply button'],
  ['extras', '🧩 Reply page extras (footer, image, links)'],
  ['remove_button', '➖ Remove a button'],
  ['menu', '📋 Menu placeholder text'],
  ['add_option', '➕ Add a menu option'],
  ['remove_option', '➖ Remove a menu option'],
];

function builder(e, picker = null, note = '') {
  const d = e.data;
  const preview = ce.render(e.id, d);
  const summary = new EmbedBuilder().setColor(BRAND_COLOR)
    .setTitle(`🛠️ Editing "${e.name}"`)
    .setDescription(
      (note ? `${note}\n\n` : '') +
      `**Buttons (${d.buttons.length}/10):** ${d.buttons.map((b) => `\`${b.action === 'link' ? '🔗 ' : ''}${b.label}\``).join(' ') || '*none*'}\n` +
      `**Menu options (${d.menu?.options.length ?? 0}/25):** ${d.menu?.options.map((o) => `\`${o.label}\``).join(' ') || '*none*'}\n` +
      `**Posted copies:** ${e.posts.length} (they update automatically when you change things)\n\n` +
      '-# Everything saves instantly. Upload your own images with `/embed image`, or use `/embed web` for the web editor.',
    );

  const rows = [new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
    .setCustomId(`ceb:${e.id}:do`).setPlaceholder('What do you want to change?')
    .addOptions(ACTIONS.map(([value, label]) => ({ value, label }))))];

  if (picker === 'topImage' || picker === 'bottomImage') {
    rows.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
      .setCustomId(`ceb:${e.id}:img:${picker}`).setPlaceholder(picker === 'topImage' ? 'Pick the top image' : 'Pick the bottom image')
      .addOptions([{ label: 'No image', value: 'none' }, ...ce.listImages().slice(0, 24).map((i) => ({ label: i.label.slice(0, 100), value: i.key, default: d[picker] === i.key }))])));
  }
  if (picker === 'extras') {
    const targets = [
      ...d.buttons.map((b, i) => (b.action === 'reply' ? { label: `Button: ${b.label}`, value: `b:${i}` } : null)).filter(Boolean),
      ...(d.menu?.options ?? []).map((o, i) => ({ label: `Menu option: ${o.label}`, value: `o:${i}` })),
    ];
    if (targets.length) {
      rows.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
        .setCustomId(`ceb:${e.id}:extras`).setPlaceholder('Which reply page?')
        .addOptions(targets.slice(0, 25).map((t) => ({ ...t, label: t.label.slice(0, 100) })))));
    }
  }
  const removable = { remove_field: d.fields.map((f) => f.name), remove_button: d.buttons.map((b) => b.label), remove_option: (d.menu?.options ?? []).map((o) => o.label) }[picker];
  if (removable?.length) {
    rows.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
      .setCustomId(`ceb:${e.id}:rm:${picker}`).setPlaceholder('Pick what to remove')
      .addOptions(removable.slice(0, 25).map((label, i) => ({ label: `${i + 1}. ${label}`.slice(0, 100), value: String(i) })))));
  }
  if (picker === 'post') {
    rows.push(new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder()
      .setCustomId(`ceb:${e.id}:postto`).setPlaceholder('Pick the channel to post in')
      .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)));
  }
  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`ceb:${e.id}:post`).setLabel('Post…').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`ceb:${e.id}:done`).setLabel('Done').setStyle(ButtonStyle.Secondary),
  ));

  return {
    embeds: [...preview.embeds, summary].slice(0, 10),
    files: preview.files,
    attachments: [],
    components: rows,
    allowedMentions: { parse: [] },
  };
}

// ---------- modals ----------
const input = (id, label, { style = TextInputStyle.Short, value = '', required = false, max = 4000, placeholder } = {}) => {
  const t = new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style).setRequired(required).setMaxLength(max);
  if (value) t.setValue(String(value).slice(0, max));
  if (placeholder) t.setPlaceholder(placeholder);
  return new ActionRowBuilder().addComponents(t);
};

function modalFor(e, kind) {
  const d = e.data;
  const m = new ModalBuilder().setCustomId(`cebm:${e.id}:${kind}`);
  if (kind === 'text') {
    return m.setTitle('Title, text, footer & colour').addComponents(
      input('title', 'Title (bold line at the top)', { value: d.title, max: 256 }),
      input('description', 'Text', { style: TextInputStyle.Paragraph, value: d.description, max: 4000 }),
      input('footer', 'Footer (small text at the bottom)', { value: d.footer, max: 2048 }),
      input('color', 'Side colour (hex, e.g. #e67e22)', { value: d.color, max: 7 }),
    );
  }
  if (kind === 'add_field') {
    return m.setTitle('Add a field').addComponents(
      input('name', 'Field title', { required: true, max: 256 }),
      input('value', 'Field text', { style: TextInputStyle.Paragraph, required: true, max: 1024 }),
      input('inline', 'Side by side with other fields? (yes/no)', { value: 'no', max: 3 }),
    );
  }
  const replyInputs = [
    input('reply_title', 'Hidden reply: title', { max: 256 }),
    input('reply_text', 'Hidden reply: text (only the clicker sees it)', { style: TextInputStyle.Paragraph, required: true, max: 4000 }),
  ];
  if (kind === 'add_link') {
    return m.setTitle('Add a link button').addComponents(
      input('label', 'Button text', { required: true, max: 80 }),
      input('emoji', 'Emoji (optional)', { max: 64 }),
      input('url', 'Website link or #channel', { required: true, max: 512, placeholder: 'https://… or #staff-training' }),
    );
  }
  if (kind.startsWith('extras:')) {
    const [, type, i] = kind.split(':');
    const reply = (type === 'b' ? d.buttons[Number(i)] : d.menu?.options[Number(i)])?.reply ?? {};
    const linkLine = (l) => (l ? `${l.label} | ${l.url}` : '');
    return m.setTitle('Reply page extras').addComponents(
      input('footer', 'Footer (small text + server icon)', { value: reply.footer, max: 2048 }),
      input('image', 'Bottom image: sessions, commands, la, la_small', { value: reply.image?.startsWith('upload:') ? reply.image : (reply.image ?? ''), max: 60 }),
      input('link1', 'Link button 1:  Text | https://… or #channel', { value: linkLine(reply.links?.[0]), max: 600 }),
      input('link2', 'Link button 2 (optional)', { value: linkLine(reply.links?.[1]), max: 600 }),
      input('link3', 'Link button 3 (optional)', { value: linkLine(reply.links?.[2]), max: 600 }),
    );
  }
  if (kind === 'add_button') {
    return m.setTitle('Add a button').addComponents(
      input('label', 'Button text', { required: true, max: 80 }),
      input('emoji', 'Emoji (optional, e.g. 📜)', { max: 64 }),
      input('style', 'Colour: grey, blue, green or red', { value: 'grey', max: 5 }),
      ...replyInputs,
    );
  }
  if (kind === 'menu') {
    return m.setTitle('Menu placeholder').addComponents(input('placeholder', 'Text shown before anything is picked', { value: d.menu?.placeholder ?? 'Select an option…', required: true, max: 150 }));
  }
  if (kind === 'add_option') {
    return m.setTitle('Add a menu option').addComponents(
      input('label', 'Option name', { required: true, max: 100 }),
      input('description', 'Small text under the option (optional)', { max: 100 }),
      input('emoji', 'Emoji (optional)', { max: 64 }),
      ...replyInputs,
    );
  }
  return null;
}

// "https://…" stays as-is; "#name", "<#id>" or a channel ID becomes a link that jumps to that channel.
function resolveLink(guild, text) {
  const t = String(text ?? '').trim();
  if (/^(https?|discord):\/\/\S+$/i.test(t)) return t;
  const id = t.match(/^<#(\d+)>$/)?.[1] ?? (/^\d{15,21}$/.test(t) ? t : null);
  const name = !id && t.replace(/^#/, '').toLowerCase();
  const ch = id ? guild?.channels.cache.get(id)
    : guild?.channels.cache.find((c) => c.name.toLowerCase() === name || c.name.toLowerCase().replace(/[^\w-]/g, '') === name.replace(/[^\w-]/g, ''));
  return ch ? `https://discord.com/channels/${guild.id}/${ch.id}` : null;
}

const STYLE_WORDS = { grey: 'secondary', gray: 'secondary', blue: 'primary', green: 'success', red: 'danger' };

// ---------- handlers ----------
async function afterChange(interaction, e, note) {
  const updated = ce.byId(e.id);
  if (updated.posts.length) ce.refreshPosts(interaction.client, e.id).catch(() => {});
  return interaction.update(builder(updated, null, note));
}

async function execute(interaction) {
  if (!(await guard(interaction, 'owner'))) return;
  const sub = interaction.options.getSubcommand();
  const eph = { flags: MessageFlags.Ephemeral };

  if (sub === 'list') {
    const rows = ce.list();
    return interaction.reply({ ...eph, content: rows.length ? rows.map((r) => `• **${r.name}**`).join('\n') : 'No embeds yet — start one with `/embed create`.' });
  }
  if (sub === 'web') {
    const url = web.loginLink();
    if (!url) return interaction.reply({ ...eph, content: '⚠️ The web editor isn\'t running (no port available on this host).' });
    return interaction.reply({ ...eph, content: `🌐 **Web editor:** <${url}>\n-# This link is just for you, works once, and expires in 15 minutes. Don't share it.` });
  }
  if (sub === 'create') {
    try {
      const e = ce.create(interaction.options.getString('name'));
      return interaction.reply({ ...eph, ...builder(e, null, '✨ New embed created with the SESSIONS banner on top and the Los Angeles wordmark at the bottom — change anything below.') });
    } catch (err) {
      return interaction.reply({ ...eph, content: `⚠️ ${err.message}` });
    }
  }

  const e = ce.byName(interaction.options.getString('name'));
  if (!e) return interaction.reply({ ...eph, content: '⚠️ No saved embed with that name. See `/embed list`.' });

  if (sub === 'edit') return interaction.reply({ ...eph, ...builder(e) });
  if (sub === 'post') {
    const channel = interaction.options.getChannel('channel') ?? interaction.channel;
    await ce.post(channel, e.id);
    return interaction.reply({ ...eph, content: `✅ Posted **${e.name}** in ${channel}. Edits will update it automatically.` });
  }
  if (sub === 'rename') {
    try {
      ce.rename(e.id, interaction.options.getString('new_name'));
      return interaction.reply({ ...eph, content: '✏️ Renamed.' });
    } catch (err) {
      return interaction.reply({ ...eph, content: `⚠️ ${err.message}` });
    }
  }
  if (sub === 'delete') {
    ce.remove(e.id);
    return interaction.reply({ ...eph, content: `🗑️ Deleted **${e.name}**. Already-posted copies stay, but their buttons/menu will stop answering.` });
  }
  if (sub === 'image') {
    const file = interaction.options.getAttachment('file');
    await interaction.deferReply(eph);
    try {
      const res = await fetch(file.url);
      const key = ce.saveUpload(Buffer.from(await res.arrayBuffer()), file.contentType ?? res.headers.get('content-type'));
      ce.save(e.id, { ...e.data, [interaction.options.getString('where')]: key });
      if (e.posts.length) await ce.refreshPosts(interaction.client, e.id);
      return interaction.editReply({ ...builder(ce.byId(e.id), null, '🖼️ Image uploaded and set.') });
    } catch (err) {
      return interaction.editReply(`⚠️ ${err.message}`);
    }
  }
}

// Builder buttons + selects: ceb:<id>:<action>[:arg]
async function component(interaction) {
  if (!can(interaction.member, 'owner')) return interaction.reply({ content: '🔒 Only the bot owner can edit embeds.', flags: MessageFlags.Ephemeral });
  const [, id, action, arg] = interaction.customId.split(':');
  const e = ce.byId(id);
  if (!e) return interaction.update({ content: 'This embed was deleted.', embeds: [], components: [], attachments: [] });

  if (action === 'done') return interaction.update({ content: '✅ Saved. Reopen any time with `/embed edit`.', embeds: [], components: [], attachments: [] });
  if (action === 'post') return interaction.update(builder(e, 'post'));
  if (action === 'postto') {
    const channel = interaction.channels.first();
    await ce.post(channel, e.id);
    return interaction.update(builder(ce.byId(e.id), null, `✅ Posted in ${channel}.`));
  }
  if (action === 'img') {
    const value = interaction.values[0];
    ce.save(e.id, { ...e.data, [arg]: value === 'none' ? null : value });
    return afterChange(interaction, e, '🖼️ Image updated.');
  }
  if (action === 'extras') return interaction.showModal(modalFor(e, `extras:${interaction.values[0]}`));
  if (action === 'rm') {
    const i = Number(interaction.values[0]);
    const d = structuredClone(e.data);
    if (arg === 'remove_field') d.fields.splice(i, 1);
    if (arg === 'remove_button') d.buttons.splice(i, 1);
    if (arg === 'remove_option') {
      d.menu.options.splice(i, 1);
      if (!d.menu.options.length) d.menu = null;
    }
    ce.save(e.id, d);
    return afterChange(interaction, e, '➖ Removed.');
  }
  if (action === 'do') {
    const choice = interaction.values[0];
    if (choice === 'extras') {
      const none = !e.data.buttons.some((b) => b.action === 'reply') && !e.data.menu;
      return interaction.update(builder(e, 'extras', none ? '*Add a hidden-reply button or a menu option first.*' : ''));
    }
    if (choice === 'add_link' && e.data.buttons.length >= 10) return interaction.update(builder(e, null, '⚠️ Max 10 buttons.'));
    if (['topImage', 'bottomImage', 'remove_field', 'remove_button', 'remove_option'].includes(choice)) {
      const empty = { remove_field: !e.data.fields.length, remove_button: !e.data.buttons.length, remove_option: !e.data.menu }[choice];
      return interaction.update(builder(e, choice, empty ? '*Nothing to remove yet.*' : ''));
    }
    if (choice === 'add_button' && e.data.buttons.length >= 10) return interaction.update(builder(e, null, '⚠️ Max 10 buttons.'));
    if (choice === 'add_option' && (e.data.menu?.options.length ?? 0) >= 25) return interaction.update(builder(e, null, '⚠️ Max 25 menu options.'));
    return interaction.showModal(modalFor(e, choice));
  }
}

// Builder modals: cebm:<id>:<kind>
async function modal(interaction) {
  const [, id, ...rest] = interaction.customId.split(':');
  const kind = rest.join(':');
  const e = ce.byId(id);
  if (!e) return interaction.reply({ content: 'This embed was deleted.', flags: MessageFlags.Ephemeral });
  const v = (k) => { try { return interaction.fields.getTextInputValue(k).trim(); } catch { return ''; } };
  const d = structuredClone(e.data);
  const reply = () => ({ title: v('reply_title'), text: v('reply_text') });

  if (kind === 'text') Object.assign(d, { title: v('title'), description: v('description'), footer: v('footer'), color: v('color') || d.color });
  if (kind === 'add_field') d.fields.push({ name: v('name'), value: v('value'), inline: /^y/i.test(v('inline')) });
  if (kind === 'add_link') {
    const url = resolveLink(interaction.guild, v('url'));
    if (!url) return interaction.update(builder(e, null, '⚠️ That link didn\'t work. Use a full web address (https://…) or a channel like #staff-training.'));
    d.buttons.push({ label: v('label'), emoji: v('emoji'), action: 'link', url });
  }
  if (kind.startsWith('extras:')) {
    const [, type, i] = kind.split(':');
    const target = type === 'b' ? d.buttons[Number(i)] : d.menu?.options[Number(i)];
    if (target) {
      const bad = [];
      const links = ['link1', 'link2', 'link3'].map((k) => v(k)).filter(Boolean).map((line) => {
        const [label, ...urlParts] = line.split('|');
        const url = resolveLink(interaction.guild, urlParts.join('|').trim());
        if (!url) bad.push(line);
        return { label: label.trim(), url };
      }).filter((l) => l.url);
      const image = v('image').toLowerCase().replace(/\s+/g, '_');
      target.reply = { ...target.reply, footer: v('footer'), image: image && image !== 'none' ? (ce.PRESETS[image] ? image : v('image')) : null, links };
      if (bad.length) {
        ce.save(e.id, d);
        return interaction.update(builder(ce.byId(e.id), null, `⚠️ Saved, but these links were skipped (use "Text | https://…" or "Text | #channel"): ${bad.map((b) => `\`${b.slice(0, 60)}\``).join(', ')}`));
      }
    }
  }
  if (kind === 'add_button') d.buttons.push({ label: v('label'), emoji: v('emoji'), style: STYLE_WORDS[v('style').toLowerCase()] ?? 'secondary', reply: reply() });
  if (kind === 'menu') d.menu = { placeholder: v('placeholder'), options: d.menu?.options ?? [] };
  if (kind === 'add_option') {
    d.menu = d.menu ?? { placeholder: 'Select an option…', options: [] };
    d.menu.options.push({ label: v('label'), description: v('description'), emoji: v('emoji'), reply: reply() });
  }
  if (kind === 'menu' && !d.menu.options.length) {
    ce.save(e.id, { ...d, menu: null });
    return interaction.update(builder(ce.byId(e.id), null, 'ℹ️ Placeholder noted — the menu appears once you add an option.'));
  }
  ce.save(e.id, d);
  try {
    return await afterChange(interaction, e, '✅ Saved.');
  } catch (err) {
    // Usually an invalid emoji: undo and explain.
    ce.save(e.id, e.data);
    return interaction.update(builder(ce.byId(e.id), null, `⚠️ Discord rejected that (${err.message.split('\n')[0]}). Check the emoji — use a normal emoji like 📜 or leave it empty.`)).catch(() => {});
  }
}

// Hidden replies on posted embeds: ce:<id>:b:<index> / ce:<id>:m
async function hiddenReply(interaction) {
  const [, id, kind, index] = interaction.customId.split(':');
  const e = ce.byId(id);
  if (!e) return interaction.reply({ content: 'This panel is no longer active.', flags: MessageFlags.Ephemeral });
  const selected = kind === 'm' ? Number(interaction.values?.[0]) : null;
  const item = kind === 'b' ? e.data.buttons[Number(index)] : e.data.menu?.options[selected];
  if (!item) return interaction.reply({ content: 'This option was removed.', flags: MessageFlags.Ephemeral });
  const payload = ce.replyPayload(e.data, item.reply, { id: e.id, guild: interaction.guild, selected });
  // Picking another page from the menu inside a hidden reply swaps that reply in place.
  if (interaction.message?.flags?.has(MessageFlags.Ephemeral)) return interaction.update({ ...payload, attachments: [] });
  return interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
}

async function autocomplete(interaction) {
  if (!can(interaction.member, 'owner')) return interaction.respond([]);
  const q = interaction.options.getFocused().toLowerCase();
  return interaction.respond(ce.list().filter((r) => r.name.toLowerCase().includes(q)).slice(0, 25).map((r) => ({ name: r.name, value: r.name })));
}

module.exports = {
  data, execute, autocomplete,
  buttons: { ceb: component, ce: hiddenReply },
  selects: { ceb: component, ce: hiddenReply },
  modals: { cebm: modal },
};
