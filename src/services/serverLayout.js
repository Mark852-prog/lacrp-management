// Server layout backup / audit / restore and channel re-ordering, run by the bot itself (it already
// holds the token). Triggered by a job file, data/layout-job.json, checked on startup:
//   { "action": "backup" }  - backup + readable report only (changes nothing)
//   { "action": "order", "plan": {...} }
//                           - backup, then re-order categories/channels in ONE bulk call, then verify
//   { "action": "restore", "file": "server-backup-<time>.json", "apply": false, "parts": ["order", "overwrites", "roles"] }
//                           - compare the server with a backup; with "apply": true put it back
// Every action first writes data/server-backup-<time>.json: every category and channel (name, type,
// position, parent, all permission overwrites) and every role (name, position, permissions).
// Other output (in data/): layout-report.txt (channels in order, roles, bot audit), layout-current.json
// (the current order as an editable plan) and layout-result.txt (what changed, re-read from Discord).
// Nothing is ever created, renamed or deleted, and nobody's roles are changed.
const fs = require('node:fs');
const path = require('node:path');
const { PermissionFlagsBits: P, PermissionsBitField, ChannelType } = require('discord.js');

const DATA = path.join(__dirname, '..', '..', 'data');
const JOB = path.join(DATA, 'layout-job.json');
const out = (name, text) => fs.writeFileSync(path.join(DATA, name), text);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const VOICE = [ChannelType.GuildVoice, ChannelType.GuildStageVoice];
const KEY_PERMS = ['Administrator', 'ManageGuild', 'ManageRoles', 'ManageChannels', 'ManageWebhooks', 'KickMembers', 'BanMembers',
  'ModerateMembers', 'ManageMessages', 'ManageNicknames', 'MentionEveryone', 'ViewAuditLog', 'ViewChannel', 'SendMessages',
  'EmbedLinks', 'AttachFiles', 'ReadMessageHistory'];
const BOT_NEEDS = ['ViewChannel', 'SendMessages', 'EmbedLinks', 'ReadMessageHistory'];
const WATCHED_BOTS = /wick|circle|dyno|lacrp management/i;
const LOG_NAME = /log/i;

const permNames = (bits) => new PermissionsBitField(BigInt(bits)).toArray();
const keyPerms = (bits) => {
  const all = permNames(bits);
  return all.includes('Administrator') ? ['Administrator (all)'] : KEY_PERMS.filter((k) => all.includes(k));
};
const typeName = (t) => ChannelType[t] ?? String(t);
const roleLabel = (guild, id) => (id === guild.id ? '@everyone' : guild.roles.cache.get(id)?.name ?? `unknown role ${id}`);

// Channels in the order Discord shows them: category by position, inside it text-like first, then voice.
function displayOrder(guild) {
  const chans = [...guild.channels.cache.values()].filter((c) => !c.isThread());
  const byPos = (a, b) => a.rawPosition - b.rawPosition || (BigInt(a.id) < BigInt(b.id) ? -1 : 1);
  const inside = (parentId) => {
    const list = chans.filter((c) => c.type !== ChannelType.GuildCategory && (c.parentId ?? null) === parentId);
    return [...list.filter((c) => !VOICE.includes(c.type)).sort(byPos), ...list.filter((c) => VOICE.includes(c.type)).sort(byPos)];
  };
  const cats = chans.filter((c) => c.type === ChannelType.GuildCategory).sort(byPos);
  return [{ category: null, channels: inside(null) }, ...cats.map((cat) => ({ category: cat, channels: inside(cat.id) }))];
}

// ---------------------------------------------------------------- backup
function backup(guild) {
  const data = {
    guild: { id: guild.id, name: guild.name },
    takenAt: new Date().toISOString(),
    roles: [...guild.roles.cache.values()].sort((a, b) => b.position - a.position).map((r) => ({
      id: r.id, name: r.name, position: r.position, permissions: r.permissions.bitfield.toString(),
      permissionNames: permNames(r.permissions.bitfield), managed: r.managed, botId: r.tags?.botId ?? null,
      hoist: r.hoist, mentionable: r.mentionable,
    })),
    channels: displayOrder(guild).flatMap(({ category, channels }) => [...(category ? [category] : []), ...channels]).map((c) => ({
      id: c.id, name: c.name, type: c.type, typeName: typeName(c.type), position: c.rawPosition,
      parentId: c.parentId ?? null, parentName: c.parent?.name ?? null, permissionsLocked: c.permissionsLocked ?? null,
      overwrites: [...(c.permissionOverwrites?.cache.values() ?? [])].map((o) => ({
        id: o.id, type: o.type, target: o.type === 0 ? roleLabel(guild, o.id) : (guild.members.cache.get(o.id)?.user.tag ?? `member ${o.id}`),
        allow: o.allow.bitfield.toString(), deny: o.deny.bitfield.toString(),
      })),
    })),
  };
  const file = `server-backup-${data.takenAt.replace(/[:.]/g, '-')}.json`;
  out(file, JSON.stringify(data, null, 2));
  return file;
}

// ---------------------------------------------------------------- report
function report(guild) {
  const L = [];
  const me = guild.members.me;
  L.push(`SERVER: ${guild.name} | roles: ${guild.roles.cache.size} | channels: ${guild.channels.cache.filter((c) => !c.isThread()).size}`);
  L.push(`Our bot's top role: ${me.roles.highest.name} (position ${me.roles.highest.position})`);

  L.push('', '=== CATEGORIES AND CHANNELS (current order, top to bottom) ===');
  for (const { category, channels } of displayOrder(guild)) {
    if (!category && !channels.length) continue;
    L.push('', category ? `## ${category.name}  [category id ${category.id}, position ${category.rawPosition}]` : '## (no category)');
    channels.forEach((c, i) => L.push(`  ${i + 1}. ${c.name}  [${typeName(c.type)}, id ${c.id}, position ${c.rawPosition}${c.permissionsLocked === false ? ', perms NOT synced with category' : ''}]`));
  }

  L.push('', '=== ROLES (top to bottom) ===', 'position | name | members | bot role? | key permissions');
  for (const r of [...guild.roles.cache.values()].sort((a, b) => b.position - a.position)) {
    const bot = r.tags?.botId ? `bot role of ${guild.members.cache.get(r.tags.botId)?.user.tag ?? r.tags.botId}` : r.managed ? 'integration' : '-';
    L.push(`${r.position} | ${r.name} | ${r.id === guild.id ? 'all' : r.members.size} | ${bot} | ${keyPerms(r.permissions.bitfield).join(', ') || '-'}`);
  }

  L.push('', '=== BOTS ===');
  const bots = [...guild.members.cache.values()].filter((m) => m.user.bot).sort((a, b) => b.roles.highest.position - a.roles.highest.position);
  for (const b of bots) L.push(`- ${b.user.tag} | top role: ${b.roles.highest.name} (position ${b.roles.highest.position}) | ${keyPerms(b.permissions.bitfield).join(', ') || '-'}`);

  const everyone = guild.roles.everyone;
  for (const b of bots.filter((m) => WATCHED_BOTS.test(m.user.username) || WATCHED_BOTS.test(m.displayName))) {
    const top = b.roles.highest;
    L.push('', `## ${b.user.tag} (id ${b.id})`);
    L.push(`Roles: ${b.roles.cache.filter((r) => r.id !== guild.id).map((r) => `${r.name} (pos ${r.position}${r.managed ? ', managed' : ''})`).join(', ') || 'none'}`);
    L.push(`Server permissions: ${permNames(b.permissions.bitfield).join(', ') || 'none'}`);
    const above = guild.roles.cache.filter((r) => r.position > top.position).sort((a, c) => c.position - a.position);
    L.push(`Roles ABOVE its top role (it cannot act on members holding these): ${above.map((r) => r.name).join(', ') || 'none'}`);

    const ow = [];
    const hidden = [];
    const logs = [];
    for (const c of guild.channels.cache.values()) {
      if (c.isThread()) continue;
      for (const o of c.permissionOverwrites?.cache.values() ?? []) {
        if (o.id !== b.id && !b.roles.cache.has(o.id)) continue;
        if (o.id === guild.id) continue; // @everyone overwrites are listed per channel in the main audit
        const a = permNames(o.allow.bitfield); const d = permNames(o.deny.bitfield);
        ow.push(`  #${c.name} for ${o.id === b.id ? 'the bot itself' : roleLabel(guild, o.id)}: ${a.length ? `ALLOW ${a.join(', ')}` : ''}${a.length && d.length ? ' ; ' : ''}${d.length ? `DENY ${d.join(', ')}` : ''}`);
      }
      if (c.type === ChannelType.GuildCategory) continue;
      const perms = c.permissionsFor(b);
      if (!perms?.has(P.ViewChannel)) hidden.push(`#${c.name}`);
      if (LOG_NAME.test(c.name)) {
        const missing = BOT_NEEDS.filter((k) => !perms?.has(P[k]));
        logs.push(`  #${c.name}: ${missing.length ? `MISSING ${missing.join(', ')}` : 'can view/send/embed/read history'}`);
      }
    }
    L.push(`Channel overwrites for this bot or its roles (${ow.length}):`, ...(ow.length ? ow : ['  none']));
    L.push(`Channels it CANNOT see (${hidden.length}): ${hidden.join(', ') || 'none'}`);
    L.push('Log-type channels (name contains "log"):', ...(logs.length ? logs : ['  none']));
  }

  L.push('', '=== LOG-TYPE CHANNELS: visible to regular members? ===');
  for (const c of guild.channels.cache.filter((x) => !x.isThread() && x.type !== ChannelType.GuildCategory && LOG_NAME.test(x.name)).values()) {
    L.push(`- #${c.name}${c.parent ? ` (in ${c.parent.name})` : ''}: @everyone ${c.permissionsFor(everyone).has(P.ViewChannel) ? 'CAN SEE IT' : 'hidden'}`);
  }
  return L.join('\n');
}

// The current order as an editable plan (same shape the "order" action takes).
function currentPlan(guild) {
  const groups = displayOrder(guild);
  return {
    categoryOrder: groups.filter((g) => g.category).map((g) => ({ id: g.category.id, name: g.category.name })),
    categories: groups.map((g) => ({
      id: g.category?.id ?? null, name: g.category?.name ?? '(no category)',
      channels: g.channels.map((c) => ({ id: c.id, name: c.name })),
    })),
  };
}

// ---------------------------------------------------------------- order
// plan.categoryOrder: [id | {id}] - optional, the categories top to bottom (unlisted ones keep their place at the end)
// plan.categories:    [{ id, channels: [id | {id}] }] - wanted order inside a category (id null = no category).
// Channels are never moved to another category. Unlisted channels stay, after the listed ones.
async function applyOrder(guild, plan) {
  const lines = [];
  const idOf = (x) => (typeof x === 'string' ? x : x?.id ?? null);
  const groups = displayOrder(guild);

  let cats = groups.filter((g) => g.category).map((g) => g.category);
  if (plan.categoryOrder?.length) {
    const wanted = plan.categoryOrder.map(idOf);
    for (const id of wanted) if (!cats.some((c) => c.id === id)) lines.push(`SKIPPED category ${id}: not found`);
    const listed = wanted.map((id) => cats.find((c) => c.id === id)).filter(Boolean);
    const rest = cats.filter((c) => !wanted.includes(c.id));
    if (rest.length) lines.push(`NOTE categories not in the plan stay at the bottom in their current order: ${rest.map((c) => c.name).join(', ')}`);
    cats = [...listed, ...rest];
  }

  const want = new Map(groups.map((g) => [g.category?.id ?? null, g.channels]));
  for (const p of plan.categories ?? []) {
    const key = p.id ?? null;
    const current = want.get(key);
    if (!current) { lines.push(`SKIPPED category ${p.name ?? key}: not found`); continue; }
    const ids = (p.channels ?? []).map(idOf);
    for (const id of ids) {
      if (!current.some((c) => c.id === id)) lines.push(`SKIPPED channel ${id} in ${p.name ?? key}: not in that category (channels are never moved between categories)`);
    }
    const listed = ids.map((id) => current.find((c) => c.id === id)).filter(Boolean);
    const rest = current.filter((c) => !ids.includes(c.id));
    if (rest.length) lines.push(`NOTE ${p.name ?? key}: not in the plan, kept after the listed channels: ${rest.map((c) => c.name).join(', ')}`);
    const merged = [...listed, ...rest];
    want.set(key, [...merged.filter((c) => !VOICE.includes(c.type)), ...merged.filter((c) => VOICE.includes(c.type))]);
  }

  // Renumber everything top to bottom (like dragging in the client), send only what changes, in one call.
  const updates = [];
  cats.forEach((cat, i) => { if (cat.rawPosition !== i) updates.push({ channel: cat.id, position: i }); });
  let n = 0;
  for (const key of [null, ...cats.map((c) => c.id)]) {
    for (const c of want.get(key) ?? []) {
      if (c.rawPosition !== n) updates.push({ channel: c.id, position: n, lockPermissions: false });
      n += 1;
    }
  }
  if (!updates.length) {
    lines.push('Nothing to change - the order already matches the plan.');
    return lines;
  }
  await guild.channels.setPositions(updates);
  lines.push(`Sent ${updates.length} position updates in one bulk request.`);

  await sleep(1500);
  await guild.channels.fetch(undefined, { force: true });
  const after = displayOrder(guild);
  const wantCats = cats.map((c) => c.id).join(',');
  const gotCats = after.filter((g) => g.category).map((g) => g.category.id).join(',');
  lines.push(`${wantCats === gotCats ? 'OK ' : 'FAILED'} category order`);
  for (const g of after) {
    const key = g.category?.id ?? null;
    const ok = (want.get(key) ?? []).map((c) => c.id).join(',') === g.channels.map((c) => c.id).join(',');
    if (!g.channels.length) continue;
    lines.push(`${ok ? 'OK ' : 'FAILED'} ${g.category?.name ?? '(no category)'}: ${g.channels.map((c) => c.name).join(' | ')}`);
  }
  return lines;
}

// ---------------------------------------------------------------- restore
// Compares the server with a backup. With apply=true: channel order/parents in one bulk call, each
// changed channel's overwrites replaced as a whole, role permissions and role order (only roles below
// our bot's top role - Discord doesn't allow more). Missing channels/roles are reported, never recreated.
async function restore(guild, file, { apply = false, parts = ['order', 'overwrites', 'roles'] } = {}) {
  const saved = JSON.parse(fs.readFileSync(path.join(DATA, path.basename(file)), 'utf8'));
  if (saved.guild?.id !== guild.id) throw new Error(`${file} is a backup of another server`);
  const lines = [`Restore from ${file} (taken ${saved.takenAt}) - ${apply ? 'APPLYING' : 'DRY RUN, nothing changed'}`];
  const top = guild.members.me.roles.highest.position;
  const sortKey = (list) => JSON.stringify([...list].map((o) => [o.id, String(o.type), String(o.allow), String(o.deny)]).sort());

  if (parts.includes('order')) {
    const updates = [];
    for (const s of saved.channels) {
      const c = guild.channels.cache.get(s.id);
      if (!c) { lines.push(`MISSING channel ${s.name} (${s.id}) - not recreated`); continue; }
      const moved = (c.parentId ?? null) !== s.parentId;
      if (c.rawPosition !== s.position || moved) {
        lines.push(`order: ${c.name} position ${c.rawPosition} -> ${s.position}${moved ? `, category -> ${s.parentName ?? 'none'}` : ''}`);
        updates.push({ channel: c.id, position: s.position, ...(moved ? { parent: s.parentId } : {}), lockPermissions: false });
      }
    }
    if (apply && updates.length) { await guild.channels.setPositions(updates); await sleep(1500); }
  }

  if (parts.includes('overwrites')) {
    for (const s of saved.channels) {
      const c = guild.channels.cache.get(s.id);
      if (!c?.permissionOverwrites) continue;
      const now = [...c.permissionOverwrites.cache.values()].map((o) => ({ id: o.id, type: o.type, allow: o.allow.bitfield, deny: o.deny.bitfield }));
      if (sortKey(now) === sortKey(s.overwrites)) continue;
      lines.push(`overwrites: #${c.name} differs from the backup`);
      if (apply) {
        await c.permissionOverwrites.set(s.overwrites.map((o) => ({ id: o.id, type: o.type, allow: BigInt(o.allow), deny: BigInt(o.deny) })), 'Restore from backup (owner request)');
        await sleep(500);
      }
    }
  }

  if (parts.includes('roles')) {
    const positions = [];
    for (const s of saved.roles) {
      const r = guild.roles.cache.get(s.id);
      if (!r) { lines.push(`MISSING role ${s.name} - not recreated`); continue; }
      if (r.position >= top) { if (r.permissions.bitfield.toString() !== s.permissions) lines.push(`SKIPPED role ${r.name}: at or above our bot's role`); continue; }
      if (r.permissions.bitfield.toString() !== s.permissions) {
        lines.push(`role ${r.name}: permissions -> ${permNames(s.permissions).join(', ') || 'none'}`);
        if (apply) { await r.setPermissions(BigInt(s.permissions), 'Restore from backup (owner request)'); await sleep(500); }
      }
      if (r.id !== guild.id && r.position !== s.position && s.position < top) {
        lines.push(`role ${r.name}: position ${r.position} -> ${s.position}`);
        positions.push({ role: r.id, position: s.position });
      }
    }
    if (apply && positions.length) await guild.roles.setPositions(positions);
  }
  if (lines.length === 1) lines.push('The server already matches the backup.');
  return lines;
}

// ---------------------------------------------------------------- job runner (startup)
async function runJob(client) {
  if (!fs.existsSync(JOB)) return;
  let job;
  try { job = JSON.parse(fs.readFileSync(JOB, 'utf8')); } catch { job = { action: 'backup' }; }
  fs.rmSync(JOB, { force: true }); // run once
  const guild = await client.guilds.fetch(process.env.GUILD_ID);
  await guild.roles.fetch();
  await guild.channels.fetch();
  await guild.members.fetch();
  console.log(`[layout] running "${job.action}"`);
  const file = backup(guild);
  const lines = [`Backup saved: data/${file}`];
  try {
    if (job.action === 'order') lines.push('', '=== RE-ORDER (re-read from Discord afterwards) ===', ...(await applyOrder(guild, job.plan ?? {})));
    if (job.action === 'restore') lines.push('', ...(await restore(guild, job.file, job)));
  } catch (err) {
    lines.push('', `ERROR: ${err.message}`);
  }
  await guild.channels.fetch(undefined, { force: true });
  out('layout-result.txt', lines.join('\n'));
  out('layout-current.json', JSON.stringify(currentPlan(guild), null, 2));
  out('layout-report.txt', report(guild));
  console.log('[layout] done - see data/layout-report.txt and data/layout-result.txt');
}

module.exports = { runJob, backup, report, applyOrder, restore, displayOrder };
