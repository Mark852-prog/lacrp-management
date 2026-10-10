// Swaps standard emojis for the server's custom emojis (config/emojis.json) in every message the bot sends.
// Also turns :name: shortcodes of the server's own emojis (e.g. :o_rules:) into the emoji, looked up by name
// at send time - texts written that way keep working when an emoji is re-uploaded with a new ID.
// Hooked into discord.js's MessagePayload, so replies, edits, channel posts and buttons are all covered.
const { MessagePayload } = require('discord.js');
const { config } = require('./config');

let client;

// A mapped value is an emoji ID or a server emoji name (e.g. o_bell). Unknown names -> null (keep the standard emoji).
function resolve(value) {
  if (!value) return null;
  if (/^d{15,21}$/.test(value)) {
    const e = client?.emojis.cache.get(value);
    return { id: value, name: e?.name ?? 'e', animated: Boolean(e?.animated) };
  }
  const e = byName(value);
  return e ? { id: e.id, name: e.name, animated: e.animated } : null;
}
function markup(value, fallback) {
  const e = resolve(value);
  return e ? `<${e.animated ? 'a' : ''}:${e.name}:${e.id}>` : fallback;
}

// The server's custom emoji with this name (falls back to any emoji the bot can use).
function byName(name) {
  const all = client?.emojis.cache;
  if (!all) return null;
  return all.find((e) => e.name === name && e.guild?.id === process.env.GUILD_ID)
    ?? client.application?.emojis?.cache.find((e) => e.name === name) // the bot's own emojis
    ?? all.find((e) => e.name === name) ?? null;
}
const SHORTCODE = /(?<!<a?):(\w{2,32}):(?!\d)/g;

function pattern() {
  const keys = Object.keys(config.emojis?.replace ?? {});
  if (!keys.length) return null;
  // Longest first; the optional U+FE0F variation selector after an emoji is swallowed too.
  const alt = keys.sort((a, b) => b.length - a.length).map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  return new RegExp(`(?:${alt})\\uFE0F?`, 'gu');
}

// Code blocks/spans are left untouched: they hold copy-paste text (e.g. in-game :h commands).
function swap(text, re) {
  if (typeof text !== 'string') return text;
  return text
    .split(/(```[\s\S]*?```|`[^`\n]*`)/)
    .map((part, i) => {
      if (i % 2) return part;
      const out = re ? part.replace(re, (m) => markup(config.emojis.replace[m.replace(/️$/, '')], m)) : part;
      return out.replace(SHORTCODE, (m, name) => {
        const e = byName(name);
        return e ? `<${e.animated ? 'a' : ''}:${e.name}:${e.id}>` : m;
      });
    })
    .join('');
}

// Component emoji: a custom emoji given by name (o_rules or :o_rules:) or a standard one listed in emojis.json.
function componentEmoji(emoji) {
  if (!emoji?.name || emoji.id) return emoji;
  const plain = emoji.name.replace(/️$/, '');
  const mapped = config.emojis?.replace?.[plain];
  const resolved = resolve(mapped);
  if (resolved) return resolved;
  const custom = byName(plain.replace(/^:|:$/g, ''));
  if (custom) return { id: custom.id, name: custom.name, animated: custom.animated };
  // An unknown name (e.g. an emoji that was deleted) would make Discord reject the whole message.
  return /^:?\w+:?$/.test(plain) ? undefined : emoji;
}

// Only places where Discord renders custom emojis (not embed author/footer).
function transformBody(body) {
  const re = pattern();
  body.content = swap(body.content, re);
  if (Array.isArray(body.embeds)) {
    body.embeds = body.embeds.map((e) => ({
      ...e,
      title: swap(e.title, re),
      description: swap(e.description, re),
      fields: e.fields?.map((f) => ({ ...f, name: swap(f.name, re), value: swap(f.value, re) })),
    }));
  }
  walk(body.components ?? [], re);
}

// Action rows and Components V2 layouts (containers, sections, text displays) nest components.
function walk(components, re) {
  for (const c of components) {
    if (c.type === 10) c.content = swap(c.content, re); // text display
    if (c.emoji) c.emoji = componentEmoji(c.emoji);
    for (const o of c.options ?? []) if (o.emoji) o.emoji = componentEmoji(o.emoji);
    if (Array.isArray(c.components)) walk(c.components, re);
    if (c.accessory) walk([c.accessory], re);
  }
}

function install(discordClient) {
  client = discordClient;
  const original = MessagePayload.prototype.resolveBody;
  MessagePayload.prototype.resolveBody = function resolveBody(...args) {
    const alreadyResolved = Boolean(this.body);
    const out = original.apply(this, args);
    if (!alreadyResolved && this.body) {
      try {
        transformBody(this.body);
      } catch (err) {
        console.warn('[emojis]', err.message);
      }
    }
    return out;
  };
}

module.exports = { install, transformBody };
