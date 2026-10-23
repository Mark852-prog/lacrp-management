// One-off check of who can use which command. Triggered by data/diag-job.json at startup; writes
// data/diag-result.txt: Discord's own per-command permission overrides (Server Settings > Integrations)
// and every Supervisor / High Rank / Senior High Rank member the bot's levels would refuse.
const fs = require('node:fs');
const path = require('node:path');
const { can } = require('../lib/permissions');
const { role } = require('../lib/guildConfig');

const DATA = path.join(__dirname, '..', '..', 'data');
const JOB = path.join(DATA, 'diag-job.json');
const OUT = path.join(DATA, 'diag-result.txt');

async function runJob(client) {
  if (!fs.existsSync(JOB)) return;
  fs.rmSync(JOB, { force: true });
  const lines = [];
  const guild = await client.guilds.fetch(process.env.GUILD_ID);
  await Promise.all([guild.roles.fetch(), guild.members.fetch()]);
  const name = (id) => (id === guild.id ? '@everyone' : guild.roles.cache.get(id)?.name ?? guild.channels.cache.get(id)?.name ?? `user ${id}`);

  lines.push('== Discord command permission overrides (Integrations) ==');
  const commands = await guild.commands.fetch();
  try {
    const perms = await client.rest.get(`/applications/${client.application.id}/guilds/${guild.id}/commands/permissions`);
    if (!perms.length) lines.push('none');
    for (const p of perms) {
      const cmd = p.id === client.application.id ? 'ALL COMMANDS (bot-wide)' : `/${commands.get(p.id)?.name ?? p.id}`;
      lines.push(`${cmd}: ${p.permissions.map((x) => `${x.permission ? 'ALLOW' : 'DENY'} ${x.type === 1 ? 'role' : x.type === 2 ? 'user' : 'channel'} ${name(x.id)}`).join(', ')}`);
    }
  } catch (err) {
    lines.push(`could not read: ${err.message}`);
  }
  lines.push('', '== Default member permissions ==');
  for (const c of commands.values()) if (c.defaultMemberPermissions !== null) lines.push(`/${c.name}: ${c.defaultMemberPermissions.toArray().join(',') || 'hidden (0)'}`);

  lines.push('', '== Members refused by the bot ==');
  const slots = ['supervisor', 'high_rank', 'senior_high_rank'].map((s) => [s, role(s)]);
  lines.push(`slots: ${slots.map(([s, id]) => `${s}=${id ? name(id) : 'NOT SET'}`).join(' | ')}`);
  const expected = { supervisor: 'supervisor', high_rank: 'highRank', senior_high_rank: 'highRank' };
  let checked = 0;
  for (const m of guild.members.cache.values()) {
    if (m.user.bot) continue;
    for (const [slot, id] of slots) {
      if (!id || !m.roles.cache.has(id)) continue;
      checked += 1;
      const res = ['staff', 'supervisor', 'highRank'].map((l) => `${l}=${can(m, l) ? 'yes' : 'NO'}`).join(' ');
      if (!can(m, expected[slot]) || !can(m, 'staff')) lines.push(`${m.user.tag} (${slot}): ${res} | top role ${m.roles.highest.name}`);
    }
  }
  lines.push(`checked ${checked} rank memberships`);

  // Webhooks: which channel each one posts in and who made it (no tokens or URLs are written).
  lines.push('', '== Webhooks ==');
  try {
    const hooks = await guild.fetchWebhooks();
    for (const w of hooks.values()) {
      lines.push(`${w.name} -> #${w.channel?.name ?? w.channelId} | type ${w.type} | made by ${w.owner?.username ?? w.owner?.name ?? 'unknown'}${w.applicationId ? ` | app ${w.applicationId}` : ''} | created ${w.createdAt.toISOString().slice(0, 10)}`);
    }
    if (!hooks.size) lines.push('none');
  } catch (err) {
    lines.push(`could not read: ${err.message}`);
  }

  // Last commands ER:LC reported (from the bot's own copy of the command logs).
  lines.push('', '== Last 20 in-game commands seen by the bot ==');
  const { all } = require('../lib/db');
  for (const c of all('SELECT ts, player, command FROM command_logs ORDER BY ts DESC LIMIT 20')) {
    lines.push(`${new Date(c.ts * 1000).toISOString().slice(0, 16).replace('T', ' ')} | ${c.player} | ${c.command.slice(0, 80)}`);
  }
  fs.writeFileSync(OUT, lines.join('\n'));
  console.log('[diag] wrote data/diag-result.txt');
}

module.exports = { runJob };
