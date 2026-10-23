// Role permission & channel access audit/fixes, run by the bot itself (it already holds the token).
// Triggered by a job file, data/perm-job.json, checked on startup:
//   { "action": "audit" }  - write the report only
//   { "action": "perks" }  - backup, apply the chat-perk setup, verify, then write the report
// Output (in data/): perm-backup-<time>.json (everything needed to undo), perm-report.txt (readable
// summary, names only) and perm-result.txt (what was changed and whether each change took effect).
// Never touched: managed (bot/integration) roles, Administrator roles, roles at or above the bot's
// highest role. Nothing is deleted and nobody's roles are changed.
const fs = require('node:fs');
const path = require('node:path');
const { PermissionFlagsBits: P, PermissionsBitField, ChannelType } = require('discord.js');

const DATA = path.join(__dirname, '..', '..', 'data');
const JOB = path.join(DATA, 'perm-job.json');
const out = (name, text) => fs.writeFileSync(path.join(DATA, name), text);

const PERKS = { AttachFiles: P.AttachFiles, EmbedLinks: P.EmbedLinks, UseExternalEmojis: P.UseExternalEmojis, UseExternalStickers: P.UseExternalStickers };
const PERK_NAMES = { AttachFiles: 'Attach Files', EmbedLinks: 'Embed Links (GIFs)', UseExternalEmojis: 'External Emojis', UseExternalStickers: 'External Stickers' };
// What each tier should have at server level (everything else of the four is removed).
const TIERS = {
  communitymember: [],
  premium: ['AttachFiles'],
  vip: ['AttachFiles', 'UseExternalEmojis'],
  executive: ['AttachFiles', 'EmbedLinks', 'UseExternalEmojis', 'UseExternalStickers'],
};
const RISKY = {
  Administrator: P.Administrator, BanMembers: P.BanMembers, KickMembers: P.KickMembers, ManageRoles: P.ManageRoles,
  ManageChannels: P.ManageChannels, ManageWebhooks: P.ManageWebhooks, MentionEveryone: P.MentionEveryone,
  ManageGuild: P.ManageGuild, ManageMessages: P.ManageMessages, ModerateMembers: P.ModerateMembers,
};
const CHAT_TYPES = [ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum, ChannelType.GuildVoice, ChannelType.GuildStageVoice];
const MEDIA_NAME = /media|photo|picture|screenshot|clip|art|gif|meme|image|showcase|livery|liveries|gallery|suggest/i;

const norm = (s) => String(s).toLowerCase().replace(/[^a-z]/g, '');
const clean = (s) => String(s).replace(/[^\p{L}\p{N} &'()./+-]/gu, '').replace(/\s+/g, ' ').trim() || String(s);
const has = (bits, flag) => (BigInt(bits) & flag) === flag;
const perkList = (bits) => Object.entries(PERKS).filter(([, f]) => has(bits, f)).map(([k]) => PERK_NAMES[k]);

function guardInfo(guild) {
  const me = guild.members.me;
  const top = me.roles.highest.position;
  const untouchable = (role) => {
    if (role.managed) return 'bot/integration role';
    if (role.permissions.has(P.Administrator)) return 'has Administrator';
    if (role.position >= top) return 'at or above the bot\'s role';
    return null;
  };
  return { top, untouchable };
}

// Roles for the perk tiers, found by name (letters only, case ignored). @everyone is handled separately.
// plan: { "Role Name": [perk keys] } - defaults to TIERS.
function tierRoles(guild, plan) {
  const found = {};
  const problems = [];
  for (const tier of Object.keys(plan)) {
    const matches = guild.roles.cache.filter((r) => norm(r.name) === norm(tier));
    if (matches.size === 1) found[tier] = matches.first();
    else problems.push(matches.size ? `${tier}: ${matches.size} roles share this name - skipped` : `${tier}: no role with this name found`);
  }
  return { found, problems };
}

// ---------------------------------------------------------------- backup
function backup(guild) {
  const data = {
    guild: { id: guild.id, name: guild.name }, takenAt: new Date().toISOString(),
    roles: guild.roles.cache.map((r) => ({ id: r.id, name: r.name, position: r.position, permissions: r.permissions.bitfield.toString(), managed: r.managed })),
    channels: guild.channels.cache.map((c) => ({
      id: c.id, name: c.name, type: c.type, parentId: c.parentId ?? null,
      overwrites: c.permissionOverwrites?.cache.map((o) => ({ id: o.id, type: o.type, allow: o.allow.bitfield.toString(), deny: o.deny.bitfield.toString() })) ?? [],
    })),
  };
  const file = `perm-backup-${data.takenAt.replace(/[:.]/g, '-')}.json`;
  out(file, JSON.stringify(data, null, 2));
  return file;
}

// ---------------------------------------------------------------- report
function report(guild) {
  const { top, untouchable } = guardInfo(guild);
  const everyone = guild.roles.everyone;
  const roles = [...guild.roles.cache.values()].sort((a, b) => b.position - a.position);
  const L = [];
  L.push(`SERVER: ${clean(guild.name)} | roles: ${roles.length} | channels: ${guild.channels.cache.size} | bot's top role position: ${top}`);
  L.push('', '=== ROLES (top to bottom) ===', 'name | members | notes | chat perks | risky permissions');
  for (const r of roles) {
    const risky = Object.entries(RISKY).filter(([, f]) => r.permissions.has(f, false)).map(([k]) => k);
    const note = [untouchable(r), r.id === everyone.id ? '@everyone' : null].filter(Boolean).join(', ');
    L.push(`${clean(r.name)} | ${r.id === everyone.id ? 'all' : r.members.size} | ${note || '-'} | ${perkList(r.permissions.bitfield).join(', ') || '-'} | ${risky.join(', ') || '-'}`);
  }

  // Channels by category: who can see / type (admin roles left out - they see everything).
  const plain = roles.filter((r) => !r.permissions.has(P.Administrator) && !r.managed);
  const label = (r) => (r.id === everyone.id ? '@everyone' : clean(r.name));
  L.push('', '=== CHANNELS (by category) ===', 'For each channel: who can SEE it, who can TYPE in it (Administrator and bot roles left out).');
  const cats = guild.channels.cache.filter((c) => c.type === ChannelType.GuildCategory).sort((a, b) => a.position - b.position);
  const groups = [[null, 'NO CATEGORY'], ...cats.map((c) => [c.id, clean(c.name)])];
  for (const [catId, catName] of groups) {
    const chans = guild.channels.cache.filter((c) => c.parentId === catId && c.type !== ChannelType.GuildCategory).sort((a, b) => a.position - b.position);
    if (!chans.size) continue;
    L.push('', `## ${catName}`);
    for (const c of chans.values()) {
      const seeAll = c.permissionsFor(everyone).has(P.ViewChannel);
      const see = plain.filter((r) => c.permissionsFor(r).has(P.ViewChannel));
      const send = see.filter((r) => c.permissionsFor(r).has(c.type === ChannelType.GuildForum ? P.SendMessagesInThreads : P.SendMessages));
      const shortList = (list) => (list.length > 12 ? `${list.slice(0, 12).map(label).join(', ')} +${list.length - 12} more` : list.map(label).join(', ') || 'nobody');
      L.push(`- ${clean(c.name)} [${ChannelType[c.type]}] SEE: ${seeAll ? 'everyone' : shortList(see)} | TYPE: ${send.some((r) => r.id === everyone.id) ? 'everyone' : shortList(send)}`);
      const perkOverwrites = c.permissionOverwrites?.cache.filter((o) => Object.values(PERKS).some((f) => has(o.allow.bitfield, f) || has(o.deny.bitfield, f))) ?? [];
      for (const o of perkOverwrites.values()) {
        const who = o.id === everyone.id ? '@everyone' : clean(guild.roles.cache.get(o.id)?.name ?? (o.type === 1 ? 'a member' : 'unknown role'));
        const a = perkList(o.allow.bitfield); const d = perkList(o.deny.bitfield);
        L.push(`    perk overwrite for ${who}: ${a.length ? `ALLOW ${a.join(', ')}` : ''}${a.length && d.length ? ' ; ' : ''}${d.length ? `DENY ${d.join(', ')}` : ''}`);
      }
    }
  }
  return L.join('\n');
}

// ---------------------------------------------------------------- part A: chat perks
async function applyPerks(guild, plan = TIERS) {
  const { untouchable } = guardInfo(guild);
  const { found, problems } = tierRoles(guild, plan);
  const everyone = guild.roles.everyone;
  const done = [];
  const skipped = [...problems];
  const perkMask = Object.values(PERKS).reduce((a, b) => a | b, 0n);

  // Other roles that only had images through @everyone lose them now - list them for the owner.
  if (has(everyone.permissions.bitfield, P.AttachFiles)) {
    const tierIds = new Set(Object.values(found).map((r) => r.id));
    const losing = guild.roles.cache.filter((r) => r.id !== everyone.id && !tierIds.has(r.id) && !r.managed
      && !r.permissions.has(P.Administrator) && !r.permissions.has(P.AttachFiles) && r.members.size > 0);
    if (losing.size) skipped.push(`These roles have no Attach Files of their own, so members with only these roles can no longer send images: ${losing.map((r) => clean(r.name)).join(', ')}`);
  }

  // 1) Server-level role permissions. @everyone gets the Community Member tier (no perks).
  const targets = [[everyone, TIERS.communitymember], ...Object.entries(found).map(([t, r]) => [r, plan[t]])];
  for (const [role, want] of targets) {
    const why = role.id === everyone.id ? null : untouchable(role);
    if (why) { skipped.push(`${label(role)}: ${why} - not changed`); continue; }
    const wantBits = want.reduce((a, k) => a | PERKS[k], 0n);
    const before = role.permissions.bitfield;
    const after = (before & ~perkMask) | wantBits;
    if (after === before) { done.push({ what: `${label(role)} server perks already correct (${perkList(before).join(', ') || 'none'})`, check: null }); continue; }
    await role.setPermissions(after, 'Chat perk setup (approved by server owner)');
    done.push({ what: `${label(role)} server perks: ${perkList(before).join(', ') || 'none'}  ->  ${perkList(after).join(', ') || 'none'}`, check: { kind: 'role', id: role.id, bits: after.toString() } });
  }

  // 2) Channel overwrites that hand a perk to a tier that shouldn't have it (e.g. green Attach Files for
  //    @everyone). The allow is set back to neutral. Media-style channels are reported, not changed.
  const tierFor = new Map([[everyone.id, "@everyone"], ...Object.entries(found).map(([t, r]) => [r.id, t])]);
  for (const c of guild.channels.cache.values()) {
    if (!CHAT_TYPES.includes(c.type) || !c.permissionOverwrites) continue;
    for (const o of c.permissionOverwrites.cache.values()) {
      const tier = tierFor.get(o.id);
      if (!tier) continue;
      const extra = Object.entries(PERKS).filter(([k, f]) => has(o.allow.bitfield, f) && !(tier === "@everyone" ? TIERS.communitymember : plan[tier]).includes(k));
      if (!extra.length) continue;
      const names = extra.map(([k]) => PERK_NAMES[k]).join(', ');
      const who = o.id === everyone.id ? '@everyone' : clean(guild.roles.cache.get(o.id).name);
      if (MEDIA_NAME.test(c.name)) { skipped.push(`#${clean(c.name)}: ${who} is allowed ${names} - looks like a media channel, left as is`); continue; }
      const edit = Object.fromEntries(extra.map(([k]) => [k, null]));
      await c.permissionOverwrites.edit(o.id, edit, { reason: 'Chat perk setup (approved by server owner)' });
      const allowAfter = o.allow.bitfield & ~extra.reduce((a, [, f]) => a | f, 0n);
      done.push({ what: `#${clean(c.name)}: removed the green ${names} for ${who} (now neutral)`, check: { kind: 'overwrite', channel: c.id, id: o.id, notAllowed: extra.map(([k]) => k), allowAfter: allowAfter.toString() } });
    }
  }
  return { done, skipped };

  function label(r) { return r.id === everyone.id ? '@everyone' : clean(r.name); }
}

// Re-read everything from Discord and confirm each change stuck.
async function verify(guild, done) {
  await guild.roles.fetch(undefined, { force: true });
  await guild.channels.fetch(undefined, { force: true });
  return done.map((d) => {
    if (!d.check) return `OK  ${d.what}`;
    if (d.check.kind === 'role') {
      const r = guild.roles.cache.get(d.check.id);
      const ok = r && (r.permissions.bitfield & Object.values(PERKS).reduce((a, b) => a | b, 0n)) === (BigInt(d.check.bits) & Object.values(PERKS).reduce((a, b) => a | b, 0n));
      return `${ok ? 'OK ' : 'FAILED'} ${d.what}`;
    }
    const c = guild.channels.cache.get(d.check.channel);
    const o = c?.permissionOverwrites.cache.get(d.check.id);
    const ok = !o || d.check.notAllowed.every((k) => !has(o.allow.bitfield, PERKS[k]));
    return `${ok ? 'OK ' : 'FAILED'} ${d.what}`;
  });
}

// ---------------------------------------------------------------- explicit changes
// ops.roles:      [{ name, add: [perm], remove: [perm] }]                 - server-level role permissions
// ops.overwrites: [{ category?, channels: [name], target: role name | '@everyone', set: { Perm: true|false|null } }]
//                 true = green allow, false = red deny, null = neutral. Names match ignoring emojis/case.
async function applyOps(guild, ops) {
  const { untouchable } = guardInfo(guild);
  const everyone = guild.roles.everyone;
  const lines = [];
  const findRole = (name) => {
    if (name === '@everyone') return everyone;
    const m = guild.roles.cache.filter((r) => norm(r.name) === norm(name));
    return m.size === 1 ? m.first() : null;
  };
  const bit = (k) => {
    if (!(k in P)) throw new Error(`unknown permission ${k}`);
    return P[k];
  };

  for (const op of ops.roles ?? []) {
    const role = findRole(op.name);
    if (!role) { lines.push(`SKIPPED role "${op.name}": not found (or several share the name)`); continue; }
    const why = role.id === everyone.id ? null : untouchable(role);
    if (why) { lines.push(`SKIPPED role "${op.name}": ${why}`); continue; }
    const before = role.permissions.bitfield;
    let after = before;
    for (const k of op.add ?? []) after |= bit(k);
    for (const k of op.remove ?? []) after &= ~bit(k);
    if (after !== before) await role.setPermissions(after, 'Permission setup (approved by server owner)');
    await guild.roles.fetch(role.id, { force: true });
    const now = guild.roles.cache.get(role.id).permissions.bitfield;
    const ok = (op.add ?? []).every((k) => has(now, bit(k))) && (op.remove ?? []).every((k) => !has(now, bit(k)));
    lines.push(`${ok ? 'OK ' : 'FAILED'} role ${clean(role.name)}: ${op.add?.length ? `added ${op.add.join(', ')}` : ''}${op.add?.length && op.remove?.length ? '; ' : ''}${op.remove?.length ? `removed ${op.remove.join(', ')}` : ''}`);
  }

  for (const op of ops.overwrites ?? []) {
    const target = findRole(op.target);
    if (!target) { lines.push(`SKIPPED overwrite for "${op.target}": role not found`); continue; }
    const cat = op.category ? guild.channels.cache.find((c) => c.type === ChannelType.GuildCategory && norm(c.name) === norm(op.category)) : null;
    if (op.category && !cat) { lines.push(`SKIPPED category "${op.category}": not found`); continue; }
    for (const name of op.channels) {
      const matches = guild.channels.cache.filter((c) => c.type !== ChannelType.GuildCategory && norm(c.name) === norm(name) && (!cat || c.parentId === cat.id));
      if (matches.size !== 1) { lines.push(`SKIPPED #${name}${op.category ? ` in ${op.category}` : ''}: ${matches.size ? 'several channels share this name' : 'not found'}`); continue; }
      const c = matches.first();
      const set = Object.fromEntries(Object.entries(op.set).map(([k, v]) => { bit(k); return [k, v]; }));
      await c.permissionOverwrites.edit(target.id, set, { reason: 'Permission setup (approved by server owner)' });
      const fresh = await guild.channels.fetch(c.id, { force: true });
      const o = fresh.permissionOverwrites.cache.get(target.id);
      const ok = Object.entries(set).every(([k, v]) => {
        const a = o ? has(o.allow.bitfield, P[k]) : false;
        const d = o ? has(o.deny.bitfield, P[k]) : false;
        return v === true ? a : v === false ? d : !a && !d;
      });
      const desc = Object.entries(set).map(([k, v]) => `${k} ${v === true ? 'allow' : v === false ? 'deny' : 'neutral'}`).join(', ');
      lines.push(`${ok ? 'OK ' : 'FAILED'} #${clean(c.name)} for ${target.id === everyone.id ? '@everyone' : clean(target.name)}: ${desc}`);
    }
  }
  // ops.threads: [{ categories?: [name], nameContains?: [text], allow: [role names] }]
  // Thread creation off for everyone in the matching channels except the allowed roles
  // (Administrator roles always can). Other roles' green thread allows are reset to neutral.
  const THREADS = ['CreatePublicThreads', 'CreatePrivateThreads'];
  const threadBits = P.CreatePublicThreads | P.CreatePrivateThreads;
  for (const op of ops.threads ?? []) {
    const allowRoles = (op.allow ?? []).map((n) => [n, findRole(n)]);
    for (const [n, r] of allowRoles) if (!r) lines.push(`SKIPPED thread allow for "${n}": role not found`);
    const allowIds = new Set(allowRoles.filter(([, r]) => r).map(([, r]) => r.id));
    const catIds = new Set((op.categories ?? []).map((name) => {
      const cat = guild.channels.cache.find((c) => c.type === ChannelType.GuildCategory && norm(c.name) === norm(name));
      if (!cat) lines.push(`SKIPPED category "${name}": not found`);
      return cat?.id;
    }).filter(Boolean));
    const chans = guild.channels.cache.filter((c) => [ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(c.type)
      && (catIds.has(c.parentId) || (op.nameContains ?? []).some((t) => norm(c.name).includes(norm(t)))));
    for (const c of chans.values()) {
      const neutral = Object.fromEntries(THREADS.map((k) => [k, null]));
      await c.permissionOverwrites.edit(everyone.id, Object.fromEntries(THREADS.map((k) => [k, false])), { reason: 'Thread lock (approved by server owner)' });
      for (const o of c.permissionOverwrites.cache.values()) {
        if (o.id === everyone.id || allowIds.has(o.id)) continue;
        if (o.allow.bitfield & threadBits) await c.permissionOverwrites.edit(o.id, neutral, { reason: 'Thread lock (approved by server owner)' });
      }
      for (const id of allowIds) await c.permissionOverwrites.edit(id, Object.fromEntries(THREADS.map((k) => [k, true])), { reason: 'Thread lock (approved by server owner)' });
      // Verify: which non-admin, non-bot roles can still start threads here?
      const fresh = await guild.channels.fetch(c.id, { force: true });
      const can = guild.roles.cache.filter((r) => !r.managed && !r.permissions.has(P.Administrator)
        && fresh.permissionsFor(r).has(P.ViewChannel) && (fresh.permissionsFor(r).has(P.CreatePublicThreads) || fresh.permissionsFor(r).has(P.CreatePrivateThreads)));
      const unexpected = can.filter((r) => !allowIds.has(r.id));
      lines.push(`${unexpected.size ? 'FAILED' : 'OK '} #${clean(c.name)} threads: ${can.size ? `only ${can.map((r) => clean(r.name)).join(', ')}` : 'nobody'} (+ Administrator roles)${unexpected.size ? ` - unexpected: ${unexpected.map((r) => clean(r.name)).join(', ')}` : ''}`);
    }
  }
  // ops.rename: { "current exact name": "new name" } - renames channels (names saved in the backup first).
  for (const [from, to] of Object.entries(ops.rename ?? {})) {
    const matches = guild.channels.cache.filter((c) => c.name === from);
    if (matches.size !== 1) { lines.push(`SKIPPED ${from}: ${matches.size ? 'several channels share this name' : 'not found'}`); continue; }
    await matches.first().setName(to, 'Channel restyle (owner request)')
      .then(() => lines.push(`OK  ${from}  ->  ${to}`))
      .catch((e) => lines.push(`FAILED ${from}: ${e.message}`));
    await new Promise((r) => setTimeout(r, 1200));
  }

  // ops.create: [{ category, name, topic?, roles: [role names] }] - private text channels only the listed
  // roles (plus Administrator roles) can see. The category is created if missing; existing channels
  // with the same name in that category are left alone.
  for (const op of ops.create ?? []) {
    let cat = guild.channels.cache.find((c) => c.type === ChannelType.GuildCategory && norm(c.name) === norm(op.category));
    if (!cat) {
      cat = await guild.channels.create({
        name: op.category, type: ChannelType.GuildCategory, reason: 'Membership channels (owner request)',
        permissionOverwrites: [{ id: everyone.id, deny: [P.ViewChannel] }],
      });
      lines.push(`OK  created category ${clean(cat.name)}`);
    }
    if (guild.channels.cache.some((c) => c.parentId === cat.id && norm(c.name) === norm(op.name))) {
      lines.push(`SKIPPED #${op.name}: already exists`);
      continue;
    }
    const roles = op.roles.map((n) => [n, findRole(n)]);
    for (const [n, r] of roles) if (!r) lines.push(`SKIPPED role "${n}" for #${op.name}: not found`);
    const ch = await guild.channels.create({
      name: op.name, type: ChannelType.GuildText, parent: cat.id, topic: op.topic, reason: 'Membership channels (owner request)',
      permissionOverwrites: [
        { id: everyone.id, deny: [P.ViewChannel] },
        { id: guild.members.me.id, allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory] },
        ...roles.filter(([, r]) => r).map(([, r]) => ({ id: r.id, allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory] })),
      ],
    });
    const fresh = await guild.channels.fetch(ch.id, { force: true });
    const see = guild.roles.cache.filter((r) => !r.managed && !r.permissions.has(P.Administrator) && fresh.permissionsFor(r).has(P.ViewChannel));
    lines.push(`OK  created #${clean(ch.name)} in ${clean(cat.name)} - visible to: ${see.map((r) => clean(r.name)).join(', ') || 'nobody'} (+ Administrator roles)`);
  }
  return lines;
}

// ---------------------------------------------------------------- perk matrix
// For every channel @everyone can type in: which of the four perks a member holding only the given
// role (plus @everyone) actually gets there. Letters: A attach, G gifs/embeds, E ext emojis, S ext stickers.
function perkMatrix(guild, roleNames) {
  const everyone = guild.roles.everyone;
  const cols = [['everyone', everyone], ...roleNames.map((n) => [n, guild.roles.cache.find((r) => norm(r.name) === norm(n))])];
  const letters = (perms) => ['AttachFiles', 'EmbedLinks', 'UseExternalEmojis', 'UseExternalStickers']
    .map((k, i) => (perms.has(PERKS[k]) ? 'AGES'[i] : '.')).join('');
  const L = [`columns: ${cols.map(([n, r]) => `${n}${r ? '' : ' (NOT FOUND)'}`).join(' / ')}`];
  // Channels a member with only the first listed role (e.g. Verified) can type in.
  const base = cols[1]?.[1] ?? everyone;
  const chans = guild.channels.cache.filter((c) => [ChannelType.GuildText, ChannelType.GuildForum, ChannelType.GuildVoice].includes(c.type)
    && c.permissionsFor(base).has(P.ViewChannel) && c.permissionsFor(base).has(c.type === ChannelType.GuildForum ? P.SendMessagesInThreads : P.SendMessages))
    .sort((a, b) => (a.parent?.position ?? -1) - (b.parent?.position ?? -1) || a.position - b.position);
  for (const c of chans.values()) {
    // X = @everyone has a red perk deny here (it overrides the paid roles' server-level perks).
    const ow = c.permissionOverwrites?.cache.get(everyone.id);
    const denied = ow ? perkList(ow.deny.bitfield).length : 0;
    L.push(`${clean(c.name).slice(0, 24).padEnd(24)} ${denied ? 'X' : ' '} ${cols.map(([, r]) => (r ? letters(c.permissionsFor(r)) : '----')).join(' ')}`);
  }
  return L.join('\n');
}

// Where members of the given roles get their chat perks from: every role they hold that grants a
// perk at server level (or Administrator), and the channels with a perk overwrite for those roles.
// sources: { roles: [names], channel: name to test in, e.g. "general" }
function perkSources(guild, { roles: names, channel: chName }) {
  const L = [];
  const ch = guild.channels.cache.find((c) => norm(c.name) === norm(chName ?? 'general'));
  const perkMask = Object.values(PERKS).reduce((a, b) => a | b, 0n);
  const short = (bits) => perkList(bits).map((p) => p.split(' ')[0]).join('+') || '-';
  const granting = new Map();
  for (const n of names) {
    const role = guild.roles.cache.find((r) => norm(r.name) === norm(n));
    if (!role) { L.push(`${n}: NOT FOUND`); continue; }
    L.push(`## ${clean(role.name)} (${role.members.size} members)`);
    for (const m of role.members.values()) {
      const eff = ch ? ch.permissionsFor(m) : m.permissions;
      const from = m.roles.cache.filter((r) => r.id !== guild.id && (r.permissions.has(P.Administrator) || (r.permissions.bitfield & perkMask)));
      for (const r of from.values()) granting.set(r.id, r);
      L.push(`${clean(m.user.username)}: in #${ch ? clean(ch.name) : '?'} gets ${eff.has(P.Administrator) ? 'EVERYTHING (Administrator)' : short(eff.bitfield)} | from roles: ${from.map((r) => `${clean(r.name)}${r.permissions.has(P.Administrator) ? '[ADMIN]' : `[${short(r.permissions.bitfield)}]`}`).join(', ') || 'none'}`);
    }
  }
  L.push('', '## Roles granting perks to these members, and their member counts');
  for (const r of granting.values()) L.push(`${clean(r.name)} | ${r.members.size} members | ${r.permissions.has(P.Administrator) ? 'Administrator' : short(r.permissions.bitfield)} | managed: ${r.managed}`);
  return L.join('\n');
}

// ---------------------------------------------------------------- job runner (startup)
async function runJob(client) {
  if (!fs.existsSync(JOB)) return;
  let job;
  try { job = JSON.parse(fs.readFileSync(JOB, 'utf8')); } catch { job = { action: 'audit' }; }
  fs.rmSync(JOB, { force: true }); // run once
  const guild = await client.guilds.fetch(process.env.GUILD_ID);
  await guild.roles.fetch();
  await guild.channels.fetch();
  await guild.members.fetch(); // member counts per role
  console.log(`[perm audit] running "${job.action}"`);
  const file = backup(guild);
  const lines = [`Backup saved: data/${file}`];
  if (job.action === 'perks') {
    const { done, skipped } = await applyPerks(guild, job.roles ?? TIERS);
    const checked = await verify(guild, done);
    lines.push('', '=== CHANGES (re-read from Discord afterwards) ===', ...checked, '', '=== SKIPPED / NOTES ===', ...(skipped.length ? skipped : ['none']));
  }
  if (job.ops) lines.push('', '=== EXPLICIT CHANGES (each re-read from Discord) ===', ...(await applyOps(guild, job.ops)));
  if (job.matrix) out('perk-matrix.txt', perkMatrix(guild, job.matrix));
  if (job.sources) out('perk-sources.txt', perkSources(guild, job.sources));
  out('perm-result.txt', lines.join('\n'));
  // Role colours (used to design matching role icons). null = no colour set.
  out('role-colors.json', JSON.stringify(guild.roles.cache
    .sort((a, b) => b.position - a.position)
    .map((r) => ({ name: r.name, color: r.color ? r.hexColor : null, members: r.members.size, managed: r.managed, icon: Boolean(r.icon || r.unicodeEmoji) })), null, 1));
  // job.profile: { description?: text, splash?: 'assets/file.png', banner?: 'assets/file.png' } - server profile changes.
  if (job.profile) {
    const root = path.join(__dirname, '..', '..');
    const edit = {};
    if (job.profile.description !== undefined) edit.description = job.profile.description;
    if (job.profile.splash) edit.splash = path.join(root, job.profile.splash);
    if (job.profile.banner) edit.banner = path.join(root, job.profile.banner);
    await guild.edit({ ...edit, reason: 'Server profile (owner request)' })
      .then(() => lines.push(`OK  server profile updated: ${Object.keys(edit).join(', ')}`))
      .catch((e) => lines.push(`FAILED server profile: ${e.message}`));
    out('perm-result.txt', lines.join('\n'));
  }
  const fresh = await client.guilds.fetch({ guild: guild.id, force: true });
  out('guild-features.json', JSON.stringify({
    premiumTier: fresh.premiumTier, features: fresh.features, description: fresh.description, vanity: fresh.vanityURLCode,
    banner: fresh.bannerURL({ size: 1024 }), splash: fresh.splashURL({ size: 1024 }), discoverySplash: fresh.discoverySplashURL({ size: 1024 }),
  }, null, 1));
  out('perm-report.txt', report(guild));
  console.log(`[perm audit] done - see data/perm-report.txt and data/perm-result.txt`);
}

module.exports = { runJob, report, backup, applyPerks, verify };
