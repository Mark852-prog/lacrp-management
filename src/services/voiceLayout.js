// Rebuilds the voice channels from config/voice-layout.json. Triggered by data/voice-job.json at startup
// ({ "dryRun": true } only writes the plan). Writes data/voice-result.txt. A permission backup is taken
// first. The source category becomes the first category; empty ⎯⎯⎯ divider channels in it are deleted.
const fs = require('node:fs');
const path = require('node:path');
const { ChannelType, OverwriteType, PermissionFlagsBits: P } = require('discord.js');
const { role } = require('../lib/guildConfig');
const { backup } = require('./permAudit');

const ROOT = path.join(__dirname, '..', '..');
const JOB = path.join(ROOT, 'data', 'voice-job.json');
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
// Wick quarantines anyone creating more than 4 channels a minute, so keep creations 20 s apart.
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
let lastCreate = 0;
async function pace() {
  const wait = lastCreate + 20_000 - Date.now();
  if (wait > 0) await sleep(wait);
  lastCreate = Date.now();
}
const REASON = 'Voice channel layout (requested by server owner)';

async function runJob(client) {
  if (!fs.existsSync(JOB)) return;
  const job = JSON.parse(fs.readFileSync(JOB, 'utf8') || '{}');
  fs.rmSync(JOB, { force: true });
  const dry = Boolean(job.dryRun);
  const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'voice-layout.json'), 'utf8'));
  const guild = await client.guilds.fetch(process.env.GUILD_ID);
  await Promise.all([guild.roles.fetch(), guild.channels.fetch()]);
  const lines = [dry ? '=== DRY RUN - nothing changed ===' : '=== APPLIED ==='];
  // { "orderOnly": true }: just put the layout's categories right after the first one, in order.
  if (job.orderOnly) {
    const cats = spec.categories.map((c) => guild.channels.cache.find((x) => x.type === ChannelType.GuildCategory && x.name === c.name));
    const order = () => [...guild.channels.cache.filter((x) => x.type === ChannelType.GuildCategory).sort((x, y) => x.position - y.position).values()].map((x) => `${x.position}:${x.name}`).join(' | ');
    lines.push(`before: ${order()}`);
    for (let i = 1; i < cats.length; i++) {
      if (!cats[i] || !cats[i - 1]) { lines.push(`missing category: ${spec.categories[i].name}`); continue; }
      await cats[i].setPosition(cats[i - 1].position + 1, { reason: REASON })
        .then(() => lines.push(`OK  ${cats[i].name} -> after ${cats[i - 1].name}`), (err) => lines.push(`FAILED ${cats[i].name}: ${err.message}`));
      await guild.channels.fetch();
    }
    lines.push(`after: ${order()}`);
    return finish(lines);
  }
  const problems = [];

  // Wick quarantine strips the bot's roles; nothing below works without Manage Channels.
  const me = await guild.members.fetchMe({ force: true });
  lines.push(`bot: top role ${me.roles.highest.name}, Manage Channels ${me.permissions.has('ManageChannels') ? 'yes' : 'NO'}${me.roles.cache.some((x) => /quarantin/i.test(x.name)) ? ', QUARANTINED' : ''}`);
  if (!me.permissions.has('ManageChannels') || me.roles.cache.some((x) => /quarantin/i.test(x.name))) problems.push('the bot is quarantined or lacks Manage Channels - release it in Wick first');

  const roleId = (key) => {
    if (key === '@everyone') return guild.id;
    if (key.startsWith('slot:')) return role(key.slice(5));
    let hit = guild.roles.cache.filter((r) => r.name === key);
    if (!hit.size) hit = guild.roles.cache.filter((r) => norm(r.name) === norm(key)); // ignore apostrophes, emojis, case
    return hit.size === 1 ? hit.first().id : null;
  };
  const toOverwrites = (...maps) => {
    const merged = new Map();
    for (const map of maps) for (const [key, rule] of Object.entries(map ?? {})) {
      const id = roleId(key);
      if (!id) { problems.push(`role not found: ${key}`); continue; }
      const bits = (names = []) => names.map((n) => { if (!(n in P)) problems.push(`unknown permission ${n}`); return P[n] ?? 0n; });
      merged.set(id, { id, type: OverwriteType.Role, allow: bits(rule.allow), deny: bits(rule.deny) });
    }
    return [...merged.values()];
  };

  const isCat = (c, name) => c.type === ChannelType.GuildCategory && c.name === name;
  const source = guild.channels.cache.find((c) => isCat(c, spec.sourceCategory)) ?? guild.channels.cache.find((c) => isCat(c, spec.categories[0].name));
  const isVoice = (c) => c.type === ChannelType.GuildVoice || c.type === ChannelType.GuildStageVoice;
  const divider = new RegExp(spec.dividerPattern);
  const used = new Set();

  // Resolve everything first so a dry run shows every problem.
  const plan = spec.categories.map((cat) => ({
    ...cat,
    overwrites: toOverwrites(spec.everywhere, cat.access),
    channels: cat.channels.map((ch) => {
      if (ch.divider) {
        const noJoin = Object.fromEntries(Object.entries(cat.access ?? {}).filter(([, rule]) => (rule.allow ?? []).includes('Connect')).map(([k]) => [k, { allow: k === '@everyone' ? [] : ['ViewChannel'], deny: ['Connect'] }]));
        return { ...ch, name: spec.dividerName, channel: null, overwrites: toOverwrites(spec.everywhere, cat.access, noJoin, { '@everyone': { deny: ['ViewChannel', 'Connect'] } }) };
      }
      const existing = ch.from ? guild.channels.cache.filter((c) => (ch.text ? c.type === ChannelType.GuildText : isVoice(c)) && [].concat(ch.from).includes(c.name)) : null;
      const done = guild.channels.cache.filter((c) => (ch.text ? c.type === ChannelType.GuildText : isVoice(c)) && c.name === ch.name);
      if (ch.from && existing.size === 0 && done.size === 1) { used.add(done.first().id); return { ...ch, channel: done.first(), overwrites: ch.access ? toOverwrites(spec.everywhere, cat.access, ch.access) : null }; }
      if (!ch.from && done.size === 1) { used.add(done.first().id); return { ...ch, channel: done.first(), overwrites: ch.access ? toOverwrites(spec.everywhere, cat.access, ch.access) : null }; }
      if (ch.from && existing.size > 1) problems.push(`channel "${[].concat(ch.from).join('" / "')}": several share this name`);
      const channel = existing?.size === 1 ? existing.first() : null;
      if (channel) used.add(channel.id);
      return { ...ch, channel, overwrites: ch.access ? toOverwrites(spec.everywhere, cat.access, ch.access) : null };
    }),
  }));
  const removals = [...guild.channels.cache.filter((c) => isVoice(c) && (spec.remove ?? []).includes(c.name)).values()];
  const dividers = source ? [...guild.channels.cache.filter((c) => c.parentId === source.id && isVoice(c) && divider.test(c.name)).values()] : [];
  const leftover = source ? [...guild.channels.cache.filter((c) => c.parentId === source.id && !used.has(c.id) && !dividers.includes(c)).values()] : [];

  for (const cat of plan) {
    const exists = guild.channels.cache.find((c) => isCat(c, cat.name)) ?? (cat === plan[0] ? source : null);
    lines.push('', `## ${cat.name}${exists ? (exists.name === cat.name ? ' (exists)' : ` (renamed from "${exists.name}")`) : ' (new category)'}`);
    for (const ch of cat.channels) {
      lines.push(`  ${ch.channel ? `move "${ch.channel.name}" ->` : 'create'} "${ch.name}"${ch.overwrites ? ' [own permissions]' : ' [synced to category]'}`);
    }
  }
  if (spec.removeCategories?.length) lines.push('', `delete these categories once empty: ${spec.removeCategories.join(', ')}`);
  if (removals.length) lines.push('', `delete (if empty): ${removals.map((c) => c.name).join(', ')}`);
  lines.push('', `delete ${dividers.length} empty divider channel(s)${dividers.some((d) => d.members?.size) ? ' (skipping any with people in them)' : ''}`);
  if (leftover.length) lines.push(`left in place (not in the layout): ${leftover.map((c) => c.name).join(', ')}`);
  if (problems.length) lines.push('', 'PROBLEMS:', ...[...new Set(problems)].map((p) => `  ${p}`));

  if (dry) {
    lines.push('', 'SERVER NOW:');
    for (const c of [...guild.channels.cache.filter((x) => x.type === ChannelType.GuildCategory).sort((a, b) => a.position - b.position).values()]) {
      const kids = [...guild.channels.cache.filter((x) => x.parentId === c.id).sort((a, b) => a.position - b.position).values()];
      lines.push(`[${c.name}] ${kids.map((k) => (isVoice(k) ? 'VC ' : '# ') + k.name).join(' | ') || '(empty)'}`);
    }
  }
  if (dry || problems.length) {
    if (!dry) lines.push('', 'Not applied because of the problems above.');
    return finish(lines);
  }

  lines.push('', `backup: ${backup(guild)}`);
  const categories = [];
  for (const [i, cat] of plan.entries()) {
    let category;
    if (i === 0 && source) {
      category = await source.edit({ name: cat.name, permissionOverwrites: cat.overwrites, reason: REASON });
    } else {
      category = guild.channels.cache.find((c) => isCat(c, cat.name));
      if (category) category = await category.edit({ permissionOverwrites: cat.overwrites, reason: REASON });
      else { await pace(); category = await guild.channels.create({ name: cat.name, type: ChannelType.GuildCategory, permissionOverwrites: cat.overwrites, reason: REASON }); }
    }
    categories.push(category);
    for (const [pos, ch] of cat.channels.entries()) {
      try {
        let channel = ch.channel;
        if (channel) {
          channel = await channel.edit({ name: ch.name, parent: category.id, lockPermissions: !ch.overwrites, reason: REASON });
          if (ch.overwrites) await channel.permissionOverwrites.set(ch.overwrites, REASON);
        } else {
          await pace();
          channel = await guild.channels.create({ name: ch.name, type: ch.text ? ChannelType.GuildText : ChannelType.GuildVoice, parent: category.id, permissionOverwrites: ch.overwrites ?? cat.overwrites, reason: REASON });
        }
        await channel.setPosition(pos, { reason: REASON }).catch(() => {});
        lines.push(`OK  ${cat.name} / ${ch.name}`);
      } catch (err) {
        lines.push(`FAILED ${cat.name} / ${ch.name}: ${err.message.split('\n')[0]}`);
      }
    }
  }
  // Keep the new categories together, right after the (renamed) source category.
  const anchor = spec.afterCategory && guild.channels.cache.find((c) => isCat(c, spec.afterCategory));
  for (const [i, c] of categories.entries()) {
    await guild.channels.fetch();
    const prev = i === 0 ? anchor : categories[i - 1];
    if (prev) await c.setPosition(guild.channels.cache.get(prev.id).position + 1, { reason: REASON }).catch((err) => lines.push(`ordering ${c.name} failed: ${err.message}`));
  }
  for (const d of removals) {
    if (d.members?.size) { lines.push(`kept ${d.name} (people inside)`); continue; }
    await pace();
    await d.delete(REASON).then(() => lines.push(`deleted ${d.name}`), (err) => lines.push(`FAILED deleting ${d.name}: ${err.message}`));
  }
  for (const d of dividers) {
    if (d.members?.size) { lines.push(`kept divider (people inside): ${d.name}`); continue; }
    await pace();
    await d.delete(REASON).then(() => lines.push('deleted divider'), (err) => lines.push(`FAILED deleting divider: ${err.message}`));
  }
  for (const name of spec.removeCategories ?? []) {
    await guild.channels.fetch();
    const c = guild.channels.cache.find((x) => isCat(x, name));
    if (!c) continue;
    if (guild.channels.cache.some((x) => x.parentId === c.id)) { lines.push(`kept category ${name} (not empty)`); continue; }
    await pace();
    await c.delete(REASON).then(() => lines.push(`deleted category ${name}`), (err) => lines.push(`FAILED deleting category ${name}: ${err.message}`));
  }
  return finish(lines);
}

function finish(lines) {
  fs.writeFileSync(path.join(ROOT, 'data', 'voice-result.txt'), lines.join('\n'));
  console.log('[voice layout] wrote data/voice-result.txt');
}

module.exports = { runJob };
