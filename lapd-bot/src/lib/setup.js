// Makes a server match layout.js. Missing roles/channels are created, existing ones (matched by name) are
// moved, renamed and given the layout's permissions, and everything is put in order. Channels left over in
// the [LAPD] categories are deleted only if nobody ever posted in them; anything with messages is kept.
const { ChannelType, PermissionFlagsBits: P, PermissionsBitField, OverwriteType } = require('discord.js');
const { ROLES, ACCESS, CATEGORIES, channelName, normalize, isLine, OWNED_CATEGORY } = require('./layout');

// What the bot needs to build everything. Channel overwrites can only grant permissions the bot has itself.
const REQUIRED = [
  P.ManageRoles, P.ManageChannels, P.ViewChannel, P.SendMessages, P.SendMessagesInThreads,
  P.CreatePublicThreads, P.EmbedLinks, P.AttachFiles, P.Connect, P.Speak,
];

const missingPermissions = (me) => new PermissionsBitField(REQUIRED).remove(me.permissions).toArray();

const inviteLink = (appId) =>
  `https://discord.com/oauth2/authorize?client_id=${appId}&scope=bot+applications.commands&permissions=${new PermissionsBitField(REQUIRED).bitfield}`;

const isCategory = (c) => c.type === ChannelType.GuildCategory;
const isEmpty = (c) => !c.lastMessageId && !(c.members?.size);

// Works out what to create, change and remove, without touching anything.
function plan(guild) {
  const all = guild.channels.cache;
  const used = new Set();
  const roles = ROLES.map((spec) => ({
    spec,
    existing: guild.roles.cache.find((r) => normalize(r.name) === normalize(spec.name)) ?? null,
  }));

  const categories = CATEGORIES.map((spec) => {
    const existing = all.find((c) => isCategory(c) && normalize(c.name) === normalize(spec.name)) ?? null;
    if (existing) used.add(existing.id);
    // Dividers all share a name, so reuse the ones already in this category, in order.
    const lines = existing
      ? [...all.filter((c) => c.parentId === existing.id && isLine(c.name)).sort((a, b) => a.position - b.position).values()]
      : [];
    const channels = spec.channels.map((ch) => {
      const found = ch.type === 'line'
        ? lines.shift()
        : all.find((c) => !isCategory(c) && !isLine(c.name) && !used.has(c.id) && normalize(c.name) === normalize(ch.name));
      if (found) used.add(found.id);
      return { spec: ch, existing: found ?? null };
    });
    return { spec, existing, channels };
  });

  const leftover = all.filter((c) => !used.has(c.id)
    && (isCategory(c) ? OWNED_CATEGORY.test(c.name) : OWNED_CATEGORY.test(c.parent?.name ?? '')));
  const removable = (c) => (isCategory(c)
    ? all.filter((k) => k.parentId === c.id).every((k) => used.has(k.id) || isEmpty(k))
    : isEmpty(c));
  const removals = [...leftover.values()].map((c) => ({ channel: c, remove: removable(c) }));

  return { roles, categories, removals };
}

function describe({ roles, categories, removals }) {
  const lines = ['+ create   ~ move or rename   = already right   - remove (empty)   ! kept (has messages)', '', 'ROLES'];
  for (const r of roles) lines.push(`  ${r.existing ? '=' : '+'} ${r.spec.name}`);
  for (const cat of categories) {
    lines.push('', `${cat.existing ? '=' : '+'} ${cat.spec.name}  (seen by: ${cat.spec.view})`);
    for (const ch of cat.channels) {
      const mark = !ch.existing ? '+' : isMoved(cat, ch) ? '~' : '=';
      lines.push(`    ${mark} ${channelName(ch.spec)}`);
    }
  }
  if (removals.length) {
    lines.push('', 'LEFT OVER');
    for (const r of removals) lines.push(`  ${r.remove ? '-' : '!'} ${r.channel.name}`);
  }
  return lines.join('\n');
}

const isMoved = (cat, ch) => ch.existing && (ch.existing.name !== channelName(ch.spec) || ch.existing.parentId !== cat.existing?.id);

function summary({ roles, categories, removals }) {
  const items = categories.flatMap((c) => c.channels);
  return {
    roles: roles.filter((r) => !r.existing).length,
    categories: categories.filter((c) => !c.existing).length,
    channels: items.filter((c) => !c.existing).length,
    moved: categories.flatMap((cat) => cat.channels.filter((ch) => isMoved(cat, ch))).length,
    removed: removals.filter((r) => r.remove).length,
    kept: removals.filter((r) => !r.remove).length,
  };
}

// Permission overwrites for one category or channel.
function overwrites(guild, roleIds, { view, post, type }) {
  const viewRoles = ACCESS[view];
  const postRoles = post !== view ? ACCESS[post] : null; // null = same as view, nothing extra to lock
  const sendPerms = type === 'voice' ? [P.Speak] : [P.SendMessages, P.SendMessagesInThreads, P.CreatePublicThreads];
  const byId = new Map();
  const add = (id, list, perms) => {
    const entry = byId.get(id) ?? { id, type: OverwriteType.Role, allow: [], deny: [] };
    entry[list].push(...perms);
    byId.set(id, entry);
  };

  if (viewRoles) {
    add(guild.id, 'deny', [P.ViewChannel]);
    for (const name of viewRoles) add(roleIds.get(name), 'allow', [P.ViewChannel, P.Connect]);
  }
  if (postRoles) {
    add(guild.id, 'deny', sendPerms);
    for (const name of postRoles) add(roleIds.get(name), 'allow', sendPerms);
  }
  if (byId.size) {
    byId.set(guild.members.me.id, {
      id: guild.members.me.id, type: OverwriteType.Member,
      allow: [P.ViewChannel, P.SendMessages, P.EmbedLinks, P.AttachFiles, P.Connect], deny: [],
    });
  }
  return [...byId.values()].filter((o) => o.id);
}

function access(cat, ch) {
  if (ch.type === 'line') return { view: cat.view, post: 'nobody', type: 'text' };
  const view = ch.view ?? cat.view;
  return { view, post: ch.post ?? cat.post ?? view, type: ch.type };
}

// Applies the plan. `progress` is called with a short status line now and then.
async function build(guild, progress = async () => {}) {
  await guild.roles.fetch();
  await guild.channels.fetch();
  const current = plan(guild);
  const errors = [];
  const done = { roles: 0, categories: 0, channels: 0, moved: 0, removed: 0 };
  const reason = 'LAPD server setup (/setup)';
  const attempt = async (label, fn) => {
    try { return await fn(); } catch (err) { errors.push(`${label}: ${err.message}`); return null; }
  };

  // Roles, highest first. New roles land at the bottom of the list, so creating top-down keeps them in order.
  await progress('Creating roles...');
  const roleIds = new Map();
  for (const r of current.roles) {
    if (r.existing) { roleIds.set(r.spec.name, r.existing.id); continue; }
    const role = await attempt(`Role "${r.spec.name}"`, () => guild.roles.create({
      name: r.spec.name, color: r.spec.color, hoist: r.spec.hoist, permissions: [], reason,
    }));
    if (role) { roleIds.set(r.spec.name, role.id); done.roles++; }
  }

  // Put our roles in chain-of-command order, reusing the slots they already occupy (other roles don't move).
  const ours = ROLES.map((spec) => guild.roles.cache.get(roleIds.get(spec.name))).filter((r) => r?.editable);
  const slots = ours.map((r) => r.position).sort((a, b) => b - a);
  if (ours.some((r, i) => r.position !== slots[i])) {
    await attempt('Ordering roles', () => guild.roles.setPositions(ours.map((role, i) => ({ role, position: slots[i] }))));
  }

  const order = [];
  for (const cat of current.categories) {
    await progress(`Building ${cat.spec.name}...`);
    const catPerms = overwrites(guild, roleIds, { view: cat.spec.view, post: cat.spec.post ?? cat.spec.view, type: 'text' });
    let parent = cat.existing;
    if (parent) {
      await attempt(`Category "${cat.spec.name}"`, () => parent.edit({ permissionOverwrites: catPerms, reason }));
    } else {
      parent = await attempt(`Category "${cat.spec.name}"`, () => guild.channels.create({
        name: cat.spec.name, type: ChannelType.GuildCategory, permissionOverwrites: catPerms, reason,
      }));
      if (!parent) continue;
      done.categories++;
    }
    order.push({ channel: parent, items: [] });

    for (const ch of cat.channels) {
      const name = channelName(ch.spec);
      const permissionOverwrites = overwrites(guild, roleIds, access(cat.spec, ch.spec));
      let channel = ch.existing;
      if (channel) {
        // Only send the name when it changes: Discord allows just two renames per channel every 10 minutes.
        const patch = { parent: parent.id, permissionOverwrites, lockPermissions: false, reason };
        if (channel.name !== name) patch.name = name;
        channel = await attempt(`Channel "${name}"`, () => channel.edit(patch));
        if (channel) done.moved++;
      } else {
        channel = await attempt(`Channel "${name}"`, () => guild.channels.create({
          name, parent: parent.id, permissionOverwrites, reason,
          type: ch.spec.type === 'voice' ? ChannelType.GuildVoice : ChannelType.GuildText,
        }));
        if (channel) done.channels++;
      }
      if (channel) order.at(-1).items.push(channel);
    }
  }

  // Our categories go after any others, each in layout order.
  await progress('Putting everything in order...');
  const others = guild.channels.cache.filter((c) => isCategory(c) && !order.some((o) => o.channel.id === c.id));
  const base = Math.max(-1, ...others.map((c) => c.position)) + 1;
  const positions = order.flatMap((o, i) => [
    { channel: o.channel.id, position: base + i },
    ...o.items.map((c, j) => ({ channel: c.id, position: j, parent: o.channel.id, lockPermissions: false })),
  ]);
  await attempt('Ordering channels', () => guild.channels.setPositions(positions));

  await progress('Removing empty leftovers...');
  const removals = current.removals.filter((r) => r.remove).sort((a, b) => isCategory(a.channel) - isCategory(b.channel));
  for (const { channel } of removals) {
    const gone = await attempt(`Removing "${channel.name}"`, () => channel.delete(reason));
    if (gone) done.removed++;
  }
  const kept = current.removals.filter((r) => !r.remove).map((r) => r.channel.name);
  return { done, kept, errors };
}

module.exports = { plan, describe, summary, build, missingPermissions, inviteLink, overwrites };
