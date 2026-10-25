// Builds the layout from layout.js on a server. Only adds what's missing: it never deletes or renames
// anything, and channels/roles that already exist (matched by name) are left exactly as they are.
const { ChannelType, PermissionFlagsBits: P, PermissionsBitField, OverwriteType } = require('discord.js');
const { ROLES, ACCESS, CATEGORIES, channelName, normalize } = require('./layout');

// What the bot needs to build everything. Channel overwrites can only grant permissions the bot has itself.
const REQUIRED = [
  P.ManageRoles, P.ManageChannels, P.ViewChannel, P.SendMessages, P.SendMessagesInThreads,
  P.CreatePublicThreads, P.EmbedLinks, P.AttachFiles, P.Connect, P.Speak,
];

const missingPermissions = (me) => new PermissionsBitField(REQUIRED).remove(me.permissions).toArray();

const inviteLink = (appId) =>
  `https://discord.com/oauth2/authorize?client_id=${appId}&scope=bot+applications.commands&permissions=${new PermissionsBitField(REQUIRED).bitfield}`;

// Works out what exists and what would be created, without changing anything.
function plan(guild) {
  const roles = ROLES.map((spec) => ({
    spec,
    existing: guild.roles.cache.find((r) => normalize(r.name) === normalize(spec.name)) ?? null,
  }));
  const nonCategory = guild.channels.cache.filter((c) => c.type !== ChannelType.GuildCategory);
  const categories = CATEGORIES.map((spec) => ({
    spec,
    existing: guild.channels.cache.find((c) => c.type === ChannelType.GuildCategory && normalize(c.name) === normalize(spec.name)) ?? null,
    channels: spec.channels.map((ch) => ({
      spec: ch,
      existing: nonCategory.find((c) => normalize(c.name) === normalize(ch.name)) ?? null,
    })),
  }));
  return { roles, categories };
}

function describe({ roles, categories }) {
  const mark = (item) => (item.existing ? '  = ' : '  + ');
  const lines = ['+ will be created    = already exists, left alone', '', 'ROLES'];
  for (const r of roles) lines.push(`${mark(r)}${r.spec.name}`);
  for (const cat of categories) {
    lines.push('', `${mark(cat).trim()} ${cat.spec.name}  (seen by: ${cat.spec.view})`);
    for (const ch of cat.channels) {
      const where = ch.existing?.parent && ch.existing.parentId !== cat.existing?.id ? `  (exists in "${ch.existing.parent.name}")` : '';
      lines.push(`  ${mark(ch)}${channelName(ch.spec)}${where}`);
    }
  }
  return lines.join('\n');
}

function countNew({ roles, categories }) {
  return {
    roles: roles.filter((r) => !r.existing).length,
    categories: categories.filter((c) => !c.existing).length,
    channels: categories.flatMap((c) => c.channels).filter((c) => !c.existing).length,
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

// Creates everything missing. `progress` is called with a short status line now and then.
async function build(guild, progress = async () => {}) {
  await guild.roles.fetch();
  await guild.channels.fetch();
  const current = plan(guild);
  const errors = [];
  const created = { roles: 0, categories: 0, channels: 0 };
  const reason = 'LAPD server setup (/setup)';

  // Roles, highest first. New roles land at the bottom of the list, so creating top-down keeps them in order.
  await progress('Creating roles...');
  const roleIds = new Map();
  for (const r of current.roles) {
    if (r.existing) { roleIds.set(r.spec.name, r.existing.id); continue; }
    try {
      const role = await guild.roles.create({ name: r.spec.name, color: r.spec.color, hoist: r.spec.hoist, permissions: [], reason });
      roleIds.set(r.spec.name, role.id);
      created.roles++;
    } catch (err) {
      errors.push(`Role "${r.spec.name}": ${err.message}`);
    }
  }

  // Put our roles in chain-of-command order, reusing the slots they already occupy (other roles don't move).
  const ours = ROLES.map((spec) => guild.roles.cache.get(roleIds.get(spec.name))).filter((r) => r?.editable);
  const slots = ours.map((r) => r.position).sort((a, b) => b - a);
  if (ours.some((r, i) => r.position !== slots[i])) {
    try {
      await guild.roles.setPositions(ours.map((role, i) => ({ role, position: slots[i] })));
    } catch (err) {
      errors.push(`Ordering roles: ${err.message}`);
    }
  }

  for (const cat of current.categories) {
    await progress(`Building ${cat.spec.name}...`);
    let parent = cat.existing;
    if (!parent) {
      try {
        parent = await guild.channels.create({
          name: cat.spec.name, type: ChannelType.GuildCategory, reason,
          permissionOverwrites: overwrites(guild, roleIds, { view: cat.spec.view, post: cat.spec.post ?? cat.spec.view, type: 'text' }),
        });
        created.categories++;
      } catch (err) {
        errors.push(`Category "${cat.spec.name}": ${err.message}`);
        continue;
      }
    }
    for (const ch of cat.channels) {
      if (ch.existing) continue;
      const view = ch.spec.view ?? cat.spec.view;
      const post = ch.spec.post ?? cat.spec.post ?? view;
      try {
        await guild.channels.create({
          name: channelName(ch.spec), parent: parent.id, reason,
          type: ch.spec.type === 'voice' ? ChannelType.GuildVoice : ChannelType.GuildText,
          permissionOverwrites: overwrites(guild, roleIds, { view, post, type: ch.spec.type }),
        });
        created.channels++;
      } catch (err) {
        errors.push(`Channel "${ch.spec.name}": ${err.message}`);
      }
    }
  }
  return { created, errors };
}

module.exports = { plan, describe, countNew, build, missingPermissions, inviteLink, overwrites };
