// Gradient role colours (Discord's enhanced role styles, boost level 2+). Triggered by
// data/role-colors-job.json at startup:
//   { "action": "gradient" } - every coloured role (except pings, strikes, verification, bots) gets a
//                              two-tone gradient made from its own colour
//   { "action": "restore" }  - put back the colours saved in data/role-colors-backup.json
// Result: data/role-colors-result.txt.
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const JOB = path.join(ROOT, 'data', 'role-colors-job.json');
const BACKUP = path.join(ROOT, 'data', 'role-colors-backup.json');
const SKIP = /ping|strike|warning|verified|community member|quarantine|blacklist|bot\b|in game|^test$|server booster/i;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function toHsl(n) {
  const r = ((n >> 16) & 255) / 255; const g = ((n >> 8) & 255) / 255; const b = (n & 255) / 255;
  const max = Math.max(r, g, b); const min = Math.min(r, g, b); const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min; const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}
function fromHsl([h, s, l]) {
  const f = (p, q, t) => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  if (s === 0) { const v = Math.round(l * 255); return (v << 16) | (v << 8) | v; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s; const p = 2 * l - q;
  return [f(p, q, h + 1 / 3), f(p, q, h), f(p, q, h - 1 / 3)].reduce((acc, v) => (acc << 8) | Math.round(v * 255), 0);
}
// Gradient from the role's own colour: a readable mid tone fading to a brighter tone of the same hue
// (very dark colours are lifted so names stay readable on Discord's dark theme).
function gradientFor(color) {
  const [h, s, l] = toHsl(color);
  const sat = s < 0.08 ? s : Math.min(1, Math.max(s, 0.55));
  const start = Math.min(0.55, Math.max(0.34, l));
  const end = Math.min(0.82, start + 0.26);
  return [fromHsl([h, sat, start]), fromHsl([h, sat, end])];
}
const secondTone = (c) => gradientFor(c)[1];

async function runJob(client) {
  if (!fs.existsSync(JOB)) return;
  const job = JSON.parse(fs.readFileSync(JOB, 'utf8'));
  fs.rmSync(JOB, { force: true });
  const guild = await client.guilds.fetch(process.env.GUILD_ID);
  await guild.roles.fetch();
  const lines = [];
  if (!guild.features.includes('ENHANCED_ROLE_COLORS')) {
    lines.push('This server does not have gradient role colours unlocked (needs boost level 2+). Nothing changed.');
  } else {
    const top = guild.members.me.roles.highest.position;
    const editable = (r) => !r.managed && r.position < top && r.id !== guild.id;
    // "set": [{ match, primary, secondary }] - give matching roles an exact gradient (hex colours).
    for (const s of job.set ?? []) {
      const re = new RegExp(s.match, 'i');
      for (const r of guild.roles.cache.filter((x) => editable(x) && re.test(x.name)).values()) {
        const primaryColor = parseInt(s.primary.replace('#', ''), 16);
        const secondaryColor = s.secondary ? parseInt(s.secondary.replace('#', ''), 16) : null;
        await r.setColors({ primaryColor, secondaryColor }, 'Role colour (owner request)')
          .then(() => lines.push(`OK  ${r.name}: ${s.primary} -> ${s.secondary ?? 'solid'}`)).catch((e) => lines.push(`FAILED ${r.name}: ${e.message}`));
        await sleep(800);
      }
    }
    if (job.action === 'restore') {
      const saved = JSON.parse(fs.readFileSync(BACKUP, 'utf8'));
      // Optional "match": only restore roles whose name matches this pattern (case ignored).
      const only = job.match ? new RegExp(job.match, 'i') : null;
      for (const [id, c] of Object.entries(saved)) {
        const r = guild.roles.cache.get(id);
        if (!r || !editable(r)) continue;
        if (only && !only.test(r.name)) continue;
        await r.setColors({ primaryColor: c.primaryColor, secondaryColor: c.secondaryColor ?? null, tertiaryColor: c.tertiaryColor ?? null }, 'Restore role colours').then(() => lines.push(`OK  ${r.name} restored`)).catch((e) => lines.push(`FAILED ${r.name}: ${e.message}`));
        await sleep(800);
      }
    } else if (job.action === 'gradient') {
      const backup = fs.existsSync(BACKUP) ? JSON.parse(fs.readFileSync(BACKUP, 'utf8')) : {};
      const targets = guild.roles.cache.filter((r) => editable(r) && r.colors.primaryColor && !SKIP.test(r.name))
        .sort((a, b) => b.position - a.position);
      for (const r of targets.values()) {
        if (!backup[r.id]) backup[r.id] = { name: r.name, ...r.colors };
        fs.writeFileSync(BACKUP, JSON.stringify(backup, null, 1));
        const [primary, secondary] = gradientFor(r.colors.primaryColor);
        try {
          await r.setColors({ primaryColor: primary, secondaryColor: secondary }, 'Gradient role colours (owner request)');
          lines.push(`OK  ${r.name}: #${primary.toString(16).padStart(6, '0')} -> #${secondary.toString(16).padStart(6, '0')}`);
        } catch (e) {
          lines.push(`FAILED ${r.name}: ${e.message.split('\n')[0]}`);
        }
        await sleep(800);
      }
    }
  }
  fs.writeFileSync(path.join(ROOT, 'data', 'role-colors-result.txt'), lines.join('\n'));
  console.log(`[role colors] done - ${lines.filter((l) => l.startsWith('OK')).length} changed`);
}

module.exports = { runJob, gradientFor, secondTone };
