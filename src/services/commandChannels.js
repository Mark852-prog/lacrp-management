// Slash commands (every bot's) only in command channels. Triggered by data/command-channels-job.json at startup
// ({ "dryRun": true } only reports); writes data/command-channels-result.txt. A permission backup is taken first.
//   1. "Use Application Commands" is removed from @everyone and from every role that grants it server-wide.
//   2. It is allowed again (for @everyone) in channels whose name matches allowChannels, and in every channel
//      of categories whose name matches allowCategories (tickets).
// Administrators keep commands everywhere - Discord can't take that away from them.
const fs = require('node:fs');
const path = require('node:path');
const { ChannelType, PermissionFlagsBits: P } = require('discord.js');
const { backup } = require('./permAudit');

const ROOT = path.join(__dirname, '..', '..');
const JOB = path.join(ROOT, 'data', 'command-channels-job.json');
const REASON = 'Slash commands only in command channels (requested by server owner)';
const DEFAULTS = {
  allowChannels: ['commands?$', 'cmds$', 'verification'],
  allowCategories: ['ticket'],
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function runJob(client) {
  if (!fs.existsSync(JOB)) return;
  const job = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(JOB, 'utf8') || '{}') };
  fs.rmSync(JOB, { force: true });
  const dry = Boolean(job.dryRun);
  const guild = await client.guilds.fetch(process.env.GUILD_ID);
  await Promise.all([guild.roles.fetch(), guild.channels.fetch()]);
  const me = await guild.members.fetchMe();
  const top = me.roles.highest.position;
  const lines = [dry ? '=== DRY RUN - nothing changed ===' : '=== APPLIED ==='];

  const chanRe = job.allowChannels.map((s) => new RegExp(s, 'i'));
  const catRe = job.allowCategories.map((s) => new RegExp(s, 'i'));
  const isText = (c) => [ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum].includes(c.type);

  // Roles that hand out slash commands server-wide (skip Administrator roles, bot roles and roles above the bot).
  const roles = [...guild.roles.cache.filter((r) => r.permissions.has(P.UseApplicationCommands) && !r.permissions.has(P.Administrator) && !r.managed).values()]
    .sort((a, b) => b.position - a.position);
  const blocked = roles.filter((r) => r.id !== guild.id && r.position >= top);
  lines.push('', `REMOVE "Use Application Commands" from ${roles.length - blocked.length} role(s): ${roles.filter((r) => !blocked.includes(r)).map((r) => (r.id === guild.id ? '@everyone' : r.name)).join(', ') || 'none'}`);
  if (blocked.length) lines.push(`CAN'T CHANGE (above the bot): ${blocked.map((r) => r.name).join(', ')}`);

  // Channels where commands stay allowed.
  const allowed = [];
  for (const c of guild.channels.cache.values()) {
    if (!isText(c)) continue;
    const inTicketCat = c.parent && catRe.some((re) => re.test(c.parent.name));
    if (inTicketCat || chanRe.some((re) => re.test(c.name))) allowed.push(c);
  }
  const ticketCats = [...guild.channels.cache.filter((c) => c.type === ChannelType.GuildCategory && catRe.some((re) => re.test(c.name))).values()];
  lines.push('', `ALLOW commands in ${allowed.length} channel(s):`, ...allowed.map((c) => `  #${c.name}${c.parent ? ` (in ${c.parent.name})` : ''}`));
  if (ticketCats.length) lines.push(`ALLOW on ticket categories (new tickets inherit it): ${ticketCats.map((c) => c.name).join(', ')}`);

  // Channel overrides elsewhere that still allow commands for some role/member: clear them.
  const leaks = [];
  for (const c of guild.channels.cache.values()) {
    if (allowed.includes(c) || ticketCats.includes(c) || !c.permissionOverwrites) continue;
    for (const o of c.permissionOverwrites.cache.values()) if (o.allow.has(P.UseApplicationCommands)) leaks.push({ c, o });
  }
  if (leaks.length) lines.push('', `CLEAR ${leaks.length} override(s) that allow commands outside command channels:`, ...leaks.map(({ c, o }) => `  #${c.name}: ${guild.roles.cache.get(o.id)?.name ?? `member ${o.id}`}`));

  if (dry) return finish(lines);

  lines.push('', `backup: ${backup(guild)}`);
  for (const c of [...ticketCats, ...allowed]) {
    await c.permissionOverwrites.edit(guild.id, { UseApplicationCommands: true }, { reason: REASON })
      .then(() => lines.push(`OK  allowed in ${c.name}`), (err) => lines.push(`FAILED ${c.name}: ${err.message}`));
    await sleep(800);
  }
  for (const { c, o } of leaks) {
    await c.permissionOverwrites.edit(o.id, { UseApplicationCommands: null }, { reason: REASON })
      .then(() => lines.push(`OK  cleared override in ${c.name}`), (err) => lines.push(`FAILED clearing ${c.name}: ${err.message}`));
    await sleep(800);
  }
  // Roles last, so command channels already work the moment everything else stops.
  for (const r of roles.filter((x) => !blocked.includes(x))) {
    await r.setPermissions(r.permissions.remove(P.UseApplicationCommands), REASON)
      .then(() => lines.push(`OK  removed from ${r.id === guild.id ? '@everyone' : r.name}`), (err) => lines.push(`FAILED ${r.name}: ${err.message}`));
    await sleep(800);
  }
  return finish(lines);
}

function finish(lines) {
  fs.writeFileSync(path.join(ROOT, 'data', 'command-channels-result.txt'), lines.join('\n'));
  console.log('[command channels] wrote data/command-channels-result.txt');
}

module.exports = { runJob };
