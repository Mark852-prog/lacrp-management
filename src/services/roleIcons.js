// Role icons (the small picture next to a role, needs server boost level 2).
// config/role-icons.json maps role names to images in assets/role-icons. Applied when the job file
// data/role-icons-job.json exists at startup; the result is written to data/role-icons-result.txt.
// Bot/integration roles and roles at or above the bot's own role are skipped.
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const JOB = path.join(ROOT, 'data', 'role-icons-job.json');
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');

async function runJob(client) {
  if (!fs.existsSync(JOB)) return;
  // Optional { "only": [role names] } limits the run to those roles (no removals).
  const job = JSON.parse(fs.readFileSync(JOB, 'utf8') || '{}');
  fs.rmSync(JOB, { force: true }); // run once
  const only = Array.isArray(job.only) ? new Set(job.only.map(norm)) : null;
  const guild = await client.guilds.fetch(process.env.GUILD_ID);
  await guild.roles.fetch();
  const lines = [];
  if (!guild.features.includes('ROLE_ICONS')) {
    lines.push('Role icons need server boost level 2 - nothing changed.');
  } else {
    const { icons, remove = [] } = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'role-icons.json'), 'utf8'));
    const top = guild.members.me.roles.highest.position;
    // Roles listed under "remove" get their icon cleared.
    for (const name of only ? [] : remove) {
      const matches = guild.roles.cache.filter((r) => norm(r.name) === norm(name));
      if (matches.size !== 1) { lines.push(`SKIPPED removing ${name}: ${matches.size ? 'several roles share this name' : 'role not found'}`); continue; }
      const role = matches.first();
      if (!role.icon) { lines.push(`OK  ${name}: no icon`); continue; }
      if (role.managed || role.position >= top) { lines.push(`SKIPPED removing ${name}: ${role.managed ? 'bot/integration role' : "above the bot's role"}`); continue; }
      try {
        await role.setIcon(null, 'Role icons (requested by server owner)');
        const fresh = await guild.roles.fetch(role.id, { force: true });
        lines.push(`${fresh?.icon ? 'FAILED' : 'OK '} ${name}: icon removed`);
      } catch (err) {
        lines.push(`FAILED removing ${name}: ${err.message.split('\n')[0]}`);
      }
    }
    for (const [name, file] of Object.entries(icons).filter(([n]) => !only || only.has(norm(n)))) {
      const matches = guild.roles.cache.filter((r) => norm(r.name) === norm(name));
      if (matches.size !== 1) { lines.push(`SKIPPED ${name}: ${matches.size ? 'several roles share this name' : 'role not found'}`); continue; }
      const role = matches.first();
      if (role.managed || role.position >= top) { lines.push(`SKIPPED ${name}: ${role.managed ? 'bot/integration role' : "above the bot's role"}`); continue; }
      try {
        await role.setIcon(fs.readFileSync(path.join(ROOT, 'assets', 'role-icons', file)), 'Role icons (requested by server owner)');
        const fresh = await guild.roles.fetch(role.id, { force: true });
        lines.push(`${fresh?.icon ? 'OK ' : 'FAILED'} ${name}`);
      } catch (err) {
        lines.push(`FAILED ${name}: ${err.message.split('\n')[0]}`);
      }
    }
  }
  fs.writeFileSync(path.join(ROOT, 'data', 'role-icons-result.txt'), lines.join('\n'));
  console.log(`[role icons] done - ${lines.filter((l) => l.startsWith('OK')).length} set`);
}

module.exports = { runJob };
