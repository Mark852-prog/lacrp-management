// Role permission & channel access audit/fixes, run by the bot itself (it already holds the token).
// Triggered by a job file, data/perm-job.json, checked on startup:
//   { "action": "audit" }  - write the report only
//   { "action": "perks" }  - backup, apply the chat-perk setup, verify, then write the report
// Add "dryRun": true to any job to PREVIEW it: perm-result.txt lists what would change and nothing
// is changed on Discord.
// Extra rules go in "ops" (see the functions below):
//   ops.uploads  - channels/categories where everyone may upload files
//   ops.commands - only the listed channels allow slash commands (public channels get a deny)
//   ops.mentions - only Supervisor+ may ping roles/@everyone, and no role is pingable by others
//   ops.roles / ops.overwrites / ops.threads - explicit changes (applyOps)
// Output (in data/): perm-backup-<time>.json (everything needed to undo), perm-report.txt (readable
// summary, names only) and perm-result.txt (what was changed and whether each change took effect).
// Never touched: managed (bot/integration) roles, Administrator roles, roles at or above the bot's
// highest role. Nothing is deleted and nobody's roles are changed.
const fs = require('node:fs');
const path = require('node:path');
const { PermissionFlagsBits: P, PermissionsBitField, ChannelType } = require('discord.js');
const { role: slotRole } = require('../lib/guildConfig');

const DATA = path.join(__dirname, '..', '..', 'data');
const JOB = path.join(DATA, 'perm-job.json');
const out = (name, text) => fs.writeFileSync(path.join(DATA, name), text);

const PERKS = { AttachFiles: P.AttachFiles, EmbedLinks: P.EmbedLinks, UseExternalEmojis: P.UseExternalEmojis, UseExternalStickers: P.UseExternalStickers };
const PERK_NAMES = { AttachFiles: 'Attach Files', EmbedLinks: 'Embed Links (GIFs)', UseExternalEmojis: 'External Emojis', UseExternalStickers: 'External Stickers' };
// What each tier should have at server level (everything else of the four is removed).
// Premium: external emojis. VIP: files + GIFs + external emojis. Executive: everything.
const TIERS = {
  communitymember: [],
  premium: ['UseExternalEmojis'],
  vip: ['AttachFiles', 'EmbedLinks', 'UseExternalEmojis'],
  executive: ['AttachFiles', 'EmbedLinks', 'UseExternalEmojis', 'UseExternalStickers'],
};
const SLOT_TIERS = new Set(['premium', 'vip', 'executive']); // found through /setup roles, not by name
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
    // premium / vip / executive come from /setup roles, so the real role names don't matter.
    const bySlot = SLOT_TIERS.has(tier) ? guild.roles.cache.get(slotRole(tier)) : null;
    if (bySlot) { found[tier] = bySlot; continue; }
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
// dry: only work out and list the changes. keep: channel ids where an @everyone Attach Files allow
// is wanted (the upload whitelist), so it isn't stripped here.
async function applyPerks(guild, plan = TIERS, { dry = false, keep = new Set() } = {}) {
  const { untouchable } = guardInfo(guild);
  const { found, problems } = tierRoles(guild, plan);
  const everyone = guild.roles.everyone;
  const done = [];
  const skipped = [...problems];
  const perkMask = Object.values(PERKS).reduce((a, b) => a | b, 0n);
  const tierIds = new Set(Object.values(found).map((r) => r.id));
  const would = dry ? 'WOULD CHANGE: ' : '';

  // Other roles that only had images through @everyone lose them now - list them for the owner.
  if (has(everyone.permissions.bitfield, P.AttachFiles)) {
    const losing = guild.roles.cache.filter((r) => r.id !== everyone.id && !tierIds.has(r.id) && !r.managed
      && !r.permissions.has(P.Administrator) && !r.permissions.has(P.AttachFiles) && r.members.size > 0);
    if (losing.size) skipped.push(`These roles have no Attach Files of their own, so members with only these roles can no longer send images: ${losing.map((r) => clean(r.name)).join(', ')}`);
  }
  // Roles with chat perks of their own keep them everywhere - only the owner can decide about those.
  const keepers = guild.roles.cache.filter((r) => r.id !== everyone.id && !tierIds.has(r.id) && !r.managed
    && !r.permissions.has(P.Administrator) && r.members.size > 0 && (r.permissions.bitfield & perkMask) !== 0n);
  if (keepers.size) skipped.push(`These roles have chat perks of their own, so their members keep them everywhere (not changed): ${keepers.map((r) => `${clean(r.name)} (${perkList(r.permissions.bitfield).join(' / ')})`).join(', ')}`);

  // 1) Server-level role permissions. @everyone gets the Community Member tier (no perks).
  const targets = [[everyone, TIERS.communitymember], ...Object.entries(found).map(([t, r]) => [r, plan[t]])];
  for (const [role, want] of targets) {
    const why = role.id === everyone.id ? null : untouchable(role);
    if (why) { skipped.push(`${label(role)}: ${why} - not changed`); continue; }
    const wantBits = want.reduce((a, k) => a | PERKS[k], 0n);
    const before = role.permissions.bitfield;
    const after = (before & ~perkMask) | wantBits;
    if (after === before) { done.push({ what: `${label(role)} server perks already correct (${perkList(before).join(', ') || 'none'})`, check: null }); continue; }
    if (!dry) await role.setPermissions(after, 'Chat perk setup (approved by server owner)');
    done.push({ what: `${would}${label(role)} server perks: ${perkList(before).join(', ') || 'none'}  ->  ${perkList(after).join(', ') || 'none'}`, check: dry ? null : { kind: 'role', id: role.id, bits: after.toString() } });
  }

  // 2) Channel overwrites that hand a perk to a tier that shouldn't have it (e.g. green Attach Files for
  //    @everyone). The allow is set back to neutral. Media-style channels are reported, not changed.
  const tierFor = new Map([[everyone.id, "@everyone"], ...Object.entries(found).map(([t, r]) => [r.id, t])]);
  for (const c of guild.channels.cache.values()) {
    if (!CHAT_TYPES.includes(c.type) || !c.permissionOverwrites) continue;
    for (const o of c.permissionOverwrites.cache.values()) {
      const tier = tierFor.get(o.id);
      if (!tier) continue;
      let extra = Object.entries(PERKS).filter(([k, f]) => has(o.allow.bitfield, f) && !(tier === "@everyone" ? TIERS.communitymember : plan[tier]).includes(k));
      if (keep.has(c.id)) extra = extra.filter(([k]) => k !== 'AttachFiles'); // upload-whitelisted channel
      if (!extra.length) continue;
      const names = extra.map(([k]) => PERK_NAMES[k]).join(', ');
      const who = o.id === everyone.id ? '@everyone' : clean(guild.roles.cache.get(o.id).name);
      if (MEDIA_NAME.test(c.name)) { skipped.push(`#${clean(c.name)}: ${who} is allowed ${names} - looks like a media channel, left as is`); continue; }
      const edit = Object.fromEntries(extra.map(([k]) => [k, null]));
      if (!dry) await c.permissionOverwrites.edit(o.id, edit, { reason: 'Chat perk setup (approved by server owner)' });
      const allowAfter = o.allow.bitfield & ~extra.reduce((a, [, f]) => a | f, 0n);
      done.push({ what: `${would}#${clean(c.name)}: removed the green ${names} for ${who} (now neutral)`, check: dry ? null : { kind: 'overwrite', channel: c.id, id: o.id, notAllowed: extra.map(([k]) => k), allowAfter: allowAfter.toString() } });
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
  return lines;
}

// ---------------------------------------------------------------- upload / commands / ping rules
const listNames = (items, max = 40) => {
  const names = [...items].map((c) => `#${clean(c.name)}`);
  return names.slice(0, max).join(', ') + (names.length > max ? ` +${names.length - max} more` : '');
};

// Sets one role's overwrite on a channel (true = green, false = red, null = neutral), only when
// something differs. Returns true when a change was (or, in a preview, would be) made.
async function ensureOverwrite(c, targetId, set, dry, reason, checks) {
  const o = c.permissionOverwrites.cache.get(targetId);
  const state = (k) => (o && has(o.allow.bitfield, P[k]) ? true : o && has(o.deny.bitfield, P[k]) ? false : null);
  if (Object.entries(set).every(([k, v]) => state(k) === v)) return false;
  if (!dry) {
    await c.permissionOverwrites.edit(targetId, set, { reason });
    checks.push({ channel: c.id, target: targetId, set });
  }
  return true;
}

// After a forced re-fetch: the checks whose overwrite doesn't read back as intended.
function failedOverwrites(guild, checks) {
  return checks.filter(({ channel, target, set }) => {
    const o = guild.channels.cache.get(channel)?.permissionOverwrites.cache.get(target);
    return !Object.entries(set).every(([k, v]) => {
      const a = Boolean(o) && has(o.allow.bitfield, P[k]);
      const d = Boolean(o) && has(o.deny.bitfield, P[k]);
      return v === true ? a : v === false ? d : !a && !d;
    });
  });
}

// Channels/categories matched by name (letters only, case and emojis ignored). Every match counts:
// "announcements" covers each channel with that name. A category covers all channels inside it.
function uploadTargets(guild, cfg = {}) {
  const lines = [];
  const targets = new Map();
  const isCat = (c) => c.type === ChannelType.GuildCategory;
  for (const name of cfg.channels ?? []) {
    const m = guild.channels.cache.filter((c) => !isCat(c) && norm(name) && norm(c.name) === norm(name));
    if (!m.size) lines.push(`NOT FOUND: channel "${name}"`);
    for (const c of m.values()) targets.set(c.id, c);
  }
  const cats = new Map();
  for (const name of cfg.categories ?? []) {
    const m = guild.channels.cache.filter((c) => isCat(c) && norm(name) && norm(c.name) === norm(name));
    if (!m.size) lines.push(`NOT FOUND: category "${name}"`);
    for (const c of m.values()) cats.set(c.id, c);
  }
  for (const part of cfg.categoryContains ?? []) {
    const m = guild.channels.cache.filter((c) => isCat(c) && norm(part) && norm(c.name).includes(norm(part)));
    if (!m.size) lines.push(`NOT FOUND: any category with "${part}" in its name`);
    for (const c of m.values()) cats.set(c.id, c);
  }
  for (const cat of cats.values()) {
    targets.set(cat.id, cat);
    for (const c of guild.channels.cache.filter((ch) => ch.parentId === cat.id).values()) targets.set(c.id, c);
  }
  return { targets, categories: cats, lines };
}

// ops.uploads: { channels: [names], categories: [names], categoryContains: [text] }
// Everyone may upload files in these channels (Attach Files green for @everyone).
async function applyUploads(guild, cfg, dry, checks) {
  const { targets, lines } = uploadTargets(guild, cfg);
  let changed = 0;
  for (const c of targets.values()) {
    if (await ensureOverwrite(c, guild.roles.everyone.id, { AttachFiles: true }, dry, 'Upload whitelist (approved by server owner)', checks)) changed += 1;
  }
  lines.push(`${dry ? 'WOULD ALLOW' : 'ALLOWED'} file uploads for everyone in ${targets.size} channels/categories (${changed} to change, ${targets.size - changed} already set): ${listNames(targets.values())}`);
  return lines;
}

// ops.commands: { allowChannels: [names], publicOnly: true }
// Slash commands are denied for @everyone in every public channel except the allowed ones, where they
// are explicitly allowed. publicOnly (default) leaves channels @everyone can't see (staff areas,
// tickets) alone so staff can still use commands there. Administrator roles always bypass overwrites.
async function applyCommands(guild, cfg, dry, checks) {
  const everyone = guild.roles.everyone;
  const lines = [];
  const allowed = new Map();
  for (const name of cfg.allowChannels ?? []) {
    const m = guild.channels.cache.filter((c) => c.type !== ChannelType.GuildCategory && norm(name) && norm(c.name) === norm(name));
    if (!m.size) lines.push(`NOT FOUND: commands channel "${name}"`);
    for (const c of m.values()) allowed.set(c.id, c);
  }
  if (!allowed.size) return [...lines, 'SKIPPED commands rule: no commands channel found, so nothing was changed (it would block commands everywhere)'];
  const denied = [];
  let privateSkipped = 0;
  let changed = 0;
  for (const c of guild.channels.cache.filter((ch) => CHAT_TYPES.includes(ch.type)).values()) {
    if (allowed.has(c.id)) {
      if (await ensureOverwrite(c, everyone.id, { UseApplicationCommands: true }, dry, 'Commands only in the commands channel (approved by server owner)', checks)) changed += 1;
      continue;
    }
    if (cfg.publicOnly !== false && !c.permissionsFor(everyone)?.has(P.ViewChannel)) { privateSkipped += 1; continue; }
    denied.push(c);
    if (await ensureOverwrite(c, everyone.id, { UseApplicationCommands: false }, dry, 'Commands only in the commands channel (approved by server owner)', checks)) changed += 1;
  }
  lines.push(`${dry ? 'WOULD ALLOW' : 'ALLOWED'} commands in: ${listNames(allowed.values())}`);
  lines.push(`${dry ? 'WOULD BLOCK' : 'BLOCKED'} commands for @everyone in ${denied.length} public channels: ${listNames(denied)}`);
  lines.push(`${changed} overwrite(s) ${dry ? 'to change' : 'changed'}; ${privateSkipped} private channels (staff areas, tickets) left alone`);
  return lines;
}

// ops.mentions: { aboveRole: "supervisor" }   (a /setup roles slot name or a role name)
// Only that role and the roles above it keep Mention Everyone (= ping roles, @everyone and @here);
// everyone below loses it, no role stays "mentionable" by anyone, and channel-level Mention Everyone
// allows for @everyone / lower roles are cleared. The bot's own role needs Mention Everyone to ping
// the Session Pings role (a managed role, so it's only checked here).
async function applyMentions(guild, cfg, dry) {
  const lines = [];
  const everyone = guild.roles.everyone;
  const { top } = guardInfo(guild);
  const spec = cfg.aboveRole ?? 'supervisor';
  const bySlot = guild.roles.cache.get(slotRole(spec));
  const byName = guild.roles.cache.filter((r) => norm(r.name) === norm(spec));
  const threshold = bySlot ?? (byName.size === 1 ? byName.first() : null);
  if (!threshold) return [`SKIPPED ping rule: couldn't find the "${spec}" role (set it with /setup roles supervisor)`];
  const touchable = (r) => !r.managed && r.position < top && !r.permissions.has(P.Administrator);
  lines.push(`Ping rule: Supervisor+ means "${clean(threshold.name)}" and every role above it (position ${threshold.position} and up)`);

  const lose = [everyone, ...guild.roles.cache.filter((r) => r.id !== everyone.id && r.position < threshold.position && touchable(r)).values()]
    .filter((r) => has(r.permissions.bitfield, P.MentionEveryone));
  for (const r of lose) if (!dry) await r.setPermissions(r.permissions.bitfield & ~P.MentionEveryone, 'Only Supervisor+ may ping (approved by server owner)');
  lines.push(`${dry ? 'WOULD REMOVE' : 'REMOVED'} Mention Everyone from ${lose.length} role(s): ${lose.map((r) => (r.id === everyone.id ? '@everyone' : clean(r.name))).join(', ') || 'none'}`);

  if (touchable(threshold) && !has(threshold.permissions.bitfield, P.MentionEveryone)) {
    if (!dry) await threshold.setPermissions(threshold.permissions.bitfield | P.MentionEveryone, 'Only Supervisor+ may ping (approved by server owner)');
    lines.push(`${dry ? 'WOULD GIVE' : 'GAVE'} Mention Everyone to ${clean(threshold.name)}`);
  }
  const lacking = guild.roles.cache.filter((r) => r.position > threshold.position && !r.managed && !r.permissions.has(P.Administrator) && !has(r.permissions.bitfield, P.MentionEveryone));
  if (lacking.size) lines.push(`NOTE: these roles above ${clean(threshold.name)} can NOT ping (no Mention Everyone, not Administrator): ${lacking.map((r) => clean(r.name)).join(', ')}`);

  const pingable = guild.roles.cache.filter((r) => r.id !== everyone.id && r.mentionable && !r.managed && r.position < top);
  for (const r of pingable.values()) if (!dry) await r.setMentionable(false, 'Only Supervisor+ may ping (approved by server owner)');
  lines.push(`${dry ? 'WOULD MAKE' : 'MADE'} ${pingable.size} role(s) not mentionable by regular members: ${pingable.map((r) => clean(r.name)).join(', ') || 'none'}`);

  const checks = [];
  const belowIds = new Set([everyone.id, ...guild.roles.cache.filter((r) => r.position < threshold.position).keys()]);
  let cleared = 0;
  for (const c of guild.channels.cache.values()) {
    for (const o of c.permissionOverwrites?.cache.values() ?? []) {
      if (!belowIds.has(o.id) || !has(o.allow.bitfield, P.MentionEveryone)) continue;
      if (await ensureOverwrite(c, o.id, { MentionEveryone: null }, dry, 'Only Supervisor+ may ping (approved by server owner)', checks)) cleared += 1;
    }
  }
  lines.push(`${dry ? 'WOULD CLEAR' : 'CLEARED'} ${cleared} channel overwrite(s) that allowed pinging for lower roles`);

  if (!guild.members.me.permissions.has(P.MentionEveryone) && !guild.members.me.permissions.has(P.Administrator)) {
    lines.push('WARNING: the LACRP Management bot role does NOT have Mention Everyone. Tick it in Server Settings > Roles, or the Session Pings role can no longer be pinged by the bot.');
  }
  if (!dry) {
    await guild.roles.fetch(undefined, { force: true });
    await guild.channels.fetch(undefined, { force: true });
    const stillRole = guild.roles.cache.filter((r) => (r.id === everyone.id || (r.position < threshold.position && touchable(r))) && has(r.permissions.bitfield, P.MentionEveryone));
    const stillMentionable = guild.roles.cache.filter((r) => r.id !== everyone.id && r.mentionable && !r.managed && r.position < top);
    const bad = failedOverwrites(guild, checks);
    lines.push(stillRole.size || stillMentionable.size || bad.length
      ? `FAILED ping rule check - still pingable: ${[...stillRole.values(), ...stillMentionable.values()].map((r) => clean(r.name)).join(', ') || 'none'}; ${bad.length} channel overwrite(s) not applied`
      : 'OK  ping rule re-read from Discord: lower roles can no longer ping and no role is mentionable');
  }
  return lines;
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
  const dry = job.dryRun === true;
  console.log(`[perm audit] running "${job.action}"${dry ? ' (preview only)' : ''}`);
  const file = backup(guild);
  const lines = [];
  if (dry) lines.push('*** PREVIEW ONLY: nothing was changed on Discord. Remove "dryRun" from the job to apply. ***', '');
  lines.push(`Backup saved: data/${file}`);
  const ops = job.ops ?? {};
  if (job.action === 'perks') {
    // The upload whitelist's @everyone Attach Files allows must survive the perk clean-up.
    const keep = new Set(ops.uploads ? uploadTargets(guild, ops.uploads).targets.keys() : []);
    const { done, skipped } = await applyPerks(guild, job.roles ?? TIERS, { dry, keep });
    const checked = dry ? done.map((d) => d.what) : await verify(guild, done);
    lines.push('', dry ? '=== CHANGES THAT WOULD BE MADE ===' : '=== CHANGES (re-read from Discord afterwards) ===', ...(checked.length ? checked : ['none']), '', '=== SKIPPED / NOTES ===', ...(skipped.length ? skipped : ['none']));
  }
  const rules = [['uploads', 'FILE UPLOAD WHITELIST', applyUploads], ['commands', 'COMMANDS ONLY IN THE COMMANDS CHANNEL', applyCommands], ['mentions', 'PINGS (SUPERVISOR+ ONLY)', applyMentions]];
  const checks = [];
  for (const [key, title, fn] of rules) {
    if (!ops[key]) continue;
    lines.push('', `=== ${title} ===`);
    try {
      lines.push(...(await fn(guild, ops[key], dry, checks)));
    } catch (err) {
      lines.push(`FAILED: ${err.message}${err.code === 50013 ? ' (the bot role needs Manage Roles and must sit above the roles it changes)' : ''}`);
    }
  }
  if (checks.length) {
    await guild.channels.fetch(undefined, { force: true });
    const bad = failedOverwrites(guild, checks);
    lines.push('', bad.length
      ? `FAILED: ${bad.length} of ${checks.length} channel overwrite(s) did not read back as intended: ${bad.slice(0, 10).map((b) => `#${clean(guild.channels.cache.get(b.channel)?.name ?? b.channel)}`).join(', ')}`
      : `OK  all ${checks.length} channel overwrite(s) re-read from Discord and confirmed`);
  }
  if (ops.roles || ops.overwrites || ops.threads) {
    lines.push('', '=== EXPLICIT CHANGES (each re-read from Discord) ===', ...(dry ? ['(not previewed - these only run when the job is applied)'] : await applyOps(guild, ops)));
  }
  out('perm-result.txt', lines.join('\n'));
  // Role colours (used to design matching role icons). null = no colour set.
  out('role-colors.json', JSON.stringify(guild.roles.cache
    .sort((a, b) => b.position - a.position)
    .map((r) => ({ name: r.name, color: r.color ? r.hexColor : null, members: r.members.size, managed: r.managed, icon: Boolean(r.icon || r.unicodeEmoji) })), null, 1));
  out('guild-features.json', JSON.stringify({ premiumTier: guild.premiumTier, features: guild.features }));
  out('perm-report.txt', report(guild));
  console.log(`[perm audit] done - see data/perm-report.txt and data/perm-result.txt`);
}

module.exports = { runJob, report, backup, applyPerks, verify, applyUploads, applyCommands, applyMentions, uploadTargets, TIERS };
