// Manual Roblox <-> Discord links (/manual-verify). Stored in manual_links; bloxlink.js reads them first.
const fs = require('node:fs');
const path = require('node:path');
const { run, get, dbPath, now } = require('./db');

const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;

// Exact account lookup by username. Returns { id, name } (name = the correct capitalisation) or null.
// Throws if Roblox can't be reached.
async function lookupRobloxUser(username) {
  const res = await fetch('https://users.roblox.com/v1/usernames/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usernames: [username], excludeBannedUsers: false }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Roblox answered ${res.status}`);
  const hit = (await res.json())?.data?.[0];
  return hit ? { id: Number(hit.id), name: hit.name } : null;
}

const byDiscord = (discordId) => get('SELECT * FROM manual_links WHERE discord_id = ?', discordId);
const byRoblox = (robloxId) => get('SELECT * FROM manual_links WHERE roblox_id = ?', robloxId);

function link({ discordId, robloxId, robloxName, by }) {
  run(`INSERT INTO manual_links(discord_id, roblox_id, roblox_name, linked_by, linked_at) VALUES(?, ?, ?, ?, ?)
       ON CONFLICT(discord_id) DO UPDATE SET roblox_id = excluded.roblox_id, roblox_name = excluded.roblox_name,
         linked_by = excluded.linked_by, linked_at = excluded.linked_at`,
  discordId, robloxId, robloxName, by, now());
}

const unlink = (discordId) => run('DELETE FROM manual_links WHERE discord_id = ?', discordId).changes > 0;

// One-time import of links made before this table existed: data/manual-links-restore.json
// [{ discord_id, roblox_id, roblox_name, linked_by, linked_at }]. Existing links are never overwritten.
function restore() {
  const file = path.join(path.dirname(dbPath), 'manual-links-restore.json');
  if (!fs.existsSync(file)) return;
  let rows;
  try {
    rows = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(rows)) throw new Error('expected a list');
  } catch (err) {
    console.warn('[manual links] could not read data/manual-links-restore.json:', err.message);
    return;
  }
  let added = 0;
  for (const r of rows) {
    if (!r.discord_id || !Number.isInteger(Number(r.roblox_id))) continue;
    added += run('INSERT OR IGNORE INTO manual_links(discord_id, roblox_id, roblox_name, linked_by, linked_at) VALUES(?, ?, ?, ?, ?)',
      String(r.discord_id), Number(r.roblox_id), r.roblox_name ?? null, String(r.linked_by ?? 'import'), Number(r.linked_at) || now()).changes;
  }
  console.log(`[manual links] restored ${added} of ${rows.length}`);
  fs.renameSync(file, path.join(path.dirname(file), 'manual-links-restore.done.json'));
}

module.exports = { USERNAME_RE, lookupRobloxUser, byDiscord, byRoblox, link, unlink, restore };
