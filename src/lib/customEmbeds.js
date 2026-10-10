// Custom embeds: storage, validation, rendering, and the hidden replies behind their buttons/menus.
// Shared by the /embed builder in Discord and the web editor.
//
// Design (the "data" JSON):
// {
//   color: '#e67e22', topImage: 'sessions' | 'upload:<file>' | null, bottomImage: same,
//   title, description, footer, fields: [{ name, value, inline }],
//   buttons: [{ label, emoji, style: 'primary'|'secondary'|'success'|'danger', reply }],   // max 10
//   menu: { placeholder, options: [{ label, description, emoji, reply }] } | null,       // max 25 options
// }
// reply = { title, text, image }  -> shown only to the person who clicked.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { EmbedBuilder, AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const { run, get, all, now, dbPath } = require('./db');

const ASSETS = path.join(__dirname, '..', '..', 'assets');
const UPLOADS = path.join(path.dirname(dbPath), 'uploads');
fs.mkdirSync(UPLOADS, { recursive: true });

const PRESETS = {
  sessions: { label: 'SESSIONS banner', file: 'banner-sessions.png' },
  commands: { label: 'COMMANDS banner', file: 'banner-commands.png' },
  la: { label: 'LOS ANGELES banner (big)', file: 'banner-la.png' },
  la_small: { label: 'Los Angeles wordmark (small)', file: 'banner-general.png' },
};
const STYLES = { primary: ButtonStyle.Primary, secondary: ButtonStyle.Secondary, success: ButtonStyle.Success, danger: ButtonStyle.Danger };
const DEFAULT_COLOR = '#e67e22';

// ---------- images ----------
function imagePath(key) {
  if (!key) return null;
  if (PRESETS[key]) return path.join(ASSETS, PRESETS[key].file);
  const m = String(key).match(/^upload:([a-f0-9]{16}\.(?:png|jpe?g|gif|webp))$/);
  return m ? path.join(UPLOADS, m[1]) : null;
}

function listImages() {
  const uploads = fs.readdirSync(UPLOADS).filter((f) => /^[a-f0-9]{16}\.(png|jpe?g|gif|webp)$/.test(f))
    .map((f) => ({ key: `upload:${f}`, label: `Uploaded image ${f.slice(0, 6)}` }));
  return [...Object.entries(PRESETS).map(([key, p]) => ({ key, label: p.label })), ...uploads];
}

const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };
function saveUpload(buffer, contentType) {
  const ext = EXT[String(contentType).split(';')[0].trim()];
  if (!ext) throw new Error('Only PNG, JPG, GIF or WEBP images can be uploaded.');
  if (buffer.length > 8 * 1024 * 1024) throw new Error('Images must be under 8 MB.');
  const file = `${crypto.randomBytes(8).toString('hex')}.${ext}`;
  fs.writeFileSync(path.join(UPLOADS, file), buffer);
  return `upload:${file}`;
}

// ---------- validation ----------
const str = (v, max) => (v == null ? '' : String(v)).slice(0, max);
const imageKey = (v) => (v && imagePath(v) && fs.existsSync(imagePath(v)) ? v : null);

// Links must be http(s) or discord:// (Discord's rule for link buttons). Channel links are https://discord.com/channels/...
const cleanUrl = (u) => (/^(https?|discord):\/\/\S+$/i.test(String(u ?? '').trim()) ? String(u).trim().slice(0, 512) : '');
const cleanLink = (l = {}) => ({ label: str(l.label, 80) || 'Open', emoji: str(l.emoji, 64), url: cleanUrl(l.url) });

function cleanReply(r = {}) {
  return {
    title: str(r.title, 256),
    text: str(r.text, 4000),
    image: imageKey(r.image),
    footer: str(r.footer, 2048),
    links: (Array.isArray(r.links) ? r.links : []).map(cleanLink).filter((l) => l.url).slice(0, 5),
  };
}

function sanitize(d = {}) {
  const color = /^#?[0-9a-f]{6}$/i.test(d.color ?? '') ? `#${String(d.color).replace('#', '')}` : DEFAULT_COLOR;
  const menu = d.menu && Array.isArray(d.menu.options) && d.menu.options.length
    ? {
      placeholder: str(d.menu.placeholder, 150) || 'Select an option…',
      options: d.menu.options.slice(0, 25).map((o) => ({
        label: str(o.label, 100) || 'Option', description: str(o.description, 100), emoji: str(o.emoji, 64), reply: cleanReply(o.reply),
      })),
    }
    : null;
  return {
    color,
    topImage: imageKey(d.topImage),
    bottomImage: imageKey(d.bottomImage),
    title: str(d.title, 256),
    description: str(d.description, 4000),
    footer: str(d.footer, 2048),
    fields: (Array.isArray(d.fields) ? d.fields : []).slice(0, 25)
      .map((f) => ({ name: str(f.name, 256) || '​', value: str(f.value, 1024) || '​', inline: Boolean(f.inline) })),
    // action 'link' opens a URL / Discord channel; 'reply' shows a hidden message.
    buttons: (Array.isArray(d.buttons) ? d.buttons : []).slice(0, 10).map((b) => {
      const url = cleanUrl(b.url);
      return {
        label: str(b.label, 80) || 'Button', emoji: str(b.emoji, 64), style: STYLES[b.style] ? b.style : 'secondary',
        action: b.action === 'link' && url ? 'link' : 'reply', url, reply: cleanReply(b.reply),
      };
    }),
    menu,
  };
}

// ---------- storage ----------
const parse = (row) => row && { ...row, data: sanitize(JSON.parse(row.data)), posts: JSON.parse(row.posts || '[]') };
const list = () => all('SELECT id, name, updated_at FROM custom_embeds ORDER BY name');
const byId = (id) => parse(get('SELECT * FROM custom_embeds WHERE id = ?', Number(id)));
const byName = (name) => parse(get('SELECT * FROM custom_embeds WHERE name = ?', String(name)));

function create(name, data = {}) {
  const clean = String(name).trim().slice(0, 50);
  if (!clean) throw new Error('Give the embed a name.');
  if (byName(clean)) throw new Error(`An embed called "${clean}" already exists.`);
  const starter = { title: 'New embed', description: 'Edit me!', topImage: 'sessions', bottomImage: 'la_small', ...data };
  const { lastInsertRowid } = run('INSERT INTO custom_embeds(name, data, updated_at) VALUES(?, ?, ?)', clean, JSON.stringify(sanitize(starter)), now());
  return byId(Number(lastInsertRowid));
}

function save(id, data) {
  run('UPDATE custom_embeds SET data = ?, updated_at = ? WHERE id = ?', JSON.stringify(sanitize(data)), now(), Number(id));
  return byId(id);
}

function rename(id, name) {
  const clean = String(name).trim().slice(0, 50);
  const other = byName(clean);
  if (!clean || (other && other.id !== Number(id))) throw new Error('That name is empty or already used.');
  run('UPDATE custom_embeds SET name = ?, updated_at = ? WHERE id = ?', clean, now(), Number(id));
}

const remove = (id) => run('DELETE FROM custom_embeds WHERE id = ?', Number(id)).changes > 0;
const setPosts = (id, posts) => run('UPDATE custom_embeds SET posts = ? WHERE id = ?', JSON.stringify(posts), Number(id));

// ---------- rendering ----------
// Accepts a normal emoji (📜), a custom server emoji (<:name:id> / <a:name:id>) or a bare emoji ID.
function emojiObject(e) {
  const t = String(e).trim();
  const custom = t.match(/^<(a?):(\w{1,32}):(\d{15,21})>$/);
  if (custom) return { id: custom[3], name: custom[2], animated: Boolean(custom[1]) };
  if (/^\d{15,21}$/.test(t)) return { id: t };
  return { name: t };
}
function attachmentFor(key, name) {
  const p = imagePath(key);
  return p && fs.existsSync(p) ? new AttachmentBuilder(p, { name }) : null;
}
const fileName = (key, slot) => `${slot}.${(imagePath(key) ?? '').split('.').pop() || 'png'}`;

// Full message payload for an embed design. id is needed for the button/menu custom IDs.
function render(id, d) {
  const color = parseInt(d.color.replace('#', ''), 16);
  const embeds = [];
  const files = [];

  if (d.topImage) {
    const name = fileName(d.topImage, 'top');
    const file = attachmentFor(d.topImage, name);
    if (file) {
      files.push(file);
      embeds.push(new EmbedBuilder().setColor(color).setImage(`attachment://${name}`));
    }
  }

  const main = new EmbedBuilder().setColor(color);
  if (d.title) main.setTitle(d.title);
  if (d.description) main.setDescription(d.description);
  if (d.fields.length) main.addFields(d.fields);
  if (d.footer) main.setFooter({ text: d.footer });
  if (d.bottomImage) {
    const name = fileName(d.bottomImage, 'bottom');
    const file = attachmentFor(d.bottomImage, name);
    if (file) {
      files.push(file);
      main.setImage(`attachment://${name}`);
    }
  }
  if (d.title || d.description || d.fields.length || d.footer || main.data.image) embeds.push(main);
  if (!embeds.length) embeds.push(new EmbedBuilder().setColor(color).setDescription('​'));

  const components = [];
  for (let i = 0; i < d.buttons.length; i += 5) {
    components.push(new ActionRowBuilder().addComponents(d.buttons.slice(i, i + 5).map((b, j) => {
      const btn = b.action === 'link'
        ? new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(b.url).setLabel(b.label) // emoji added below
        : new ButtonBuilder().setCustomId(`ce:${id}:b:${i + j}`).setLabel(b.label).setStyle(STYLES[b.style]);
      if (b.emoji) btn.setEmoji(emojiObject(b.emoji));
      return btn;
    })));
  }
  if (d.menu) components.push(menuRow(id, d));
  return { embeds, files, components, allowedMentions: { parse: [] } };
}

function menuRow(id, d, selected = null) {
  return new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
    .setCustomId(`ce:${id}:m`)
    .setPlaceholder(d.menu.placeholder)
    .addOptions(d.menu.options.map((o, i) => {
      const opt = { label: o.label, value: String(i), default: i === selected };
      if (o.description) opt.description = o.description;
      if (o.emoji) opt.emoji = emojiObject(o.emoji);
      return opt;
    })));
}

function linkRow(links) {
  return new ActionRowBuilder().addComponents(links.map((l) => {
    const b = new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(l.url).setLabel(l.label);
    if (l.emoji) b.setEmoji(emojiObject(l.emoji));
    return b;
  }));
}

// The hidden message shown when someone clicks a button / picks a menu option.
// For menu options the menu is repeated underneath with that option ticked, so people can flip
// between pages inside the same hidden message. opts: { id, guild, selected }
function replyPayload(d, reply, opts = {}) {
  const color = parseInt(d.color.replace('#', ''), 16);
  const embed = new EmbedBuilder().setColor(color);
  if (reply.title) embed.setTitle(reply.title);
  if (reply.text) embed.setDescription(reply.text);
  if (reply.footer) embed.setFooter({ text: reply.footer, iconURL: opts.guild?.iconURL() ?? undefined });
  const files = [];
  if (reply.image) {
    const name = fileName(reply.image, 'reply');
    const file = attachmentFor(reply.image, name);
    if (file) {
      files.push(file);
      embed.setImage(`attachment://${name}`);
    }
  }
  if (!reply.title && !reply.text && !files.length) embed.setDescription('*(Nothing here yet.)*');
  const components = [];
  if (opts.selected != null && d.menu) components.push(menuRow(opts.id, d, opts.selected));
  if (reply.links?.length) components.push(linkRow(reply.links));
  return { embeds: [embed], files, components, allowedMentions: { parse: [] } };
}

// Re-renders every posted copy after an edit. Returns how many were updated.
async function refreshPosts(client, id) {
  const e = byId(id);
  if (!e) return 0;
  const alive = [];
  let updated = 0;
  for (const p of e.posts) {
    const ch = await client.channels.fetch(p.channelId).catch(() => null);
    const msg = await ch?.messages.fetch(p.messageId).catch(() => null);
    if (!msg) continue; // deleted - forget it
    alive.push(p);
    const payload = render(e.id, e.data);
    await msg.edit({ ...payload, attachments: [] }).then(() => { updated += 1; }).catch((err) => console.warn('[custom embed]', err.message));
  }
  setPosts(id, alive);
  return updated;
}

async function post(channel, id) {
  const e = byId(id);
  if (!e) throw new Error('Embed not found.');
  const msg = await channel.send(render(e.id, e.data));
  setPosts(id, [...e.posts, { channelId: channel.id, messageId: msg.id }]);
  return msg;
}

module.exports = {
  PRESETS, STYLES, DEFAULT_COLOR, imagePath, listImages, saveUpload, sanitize,
  list, byId, byName, create, save, rename, remove, render, replyPayload, refreshPosts, post,
};
