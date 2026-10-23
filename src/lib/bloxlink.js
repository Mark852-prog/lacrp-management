// Roblox <-> Discord account links via the Bloxlink server API (v4).
// The free server key allows ~500 requests/day, so every answer is cached in SQLite and a
// daily budget stops us before Bloxlink starts rejecting requests.
const { config } = require('./config');
const { run, get, kvGet, kvSet, now } = require('./db');

const BASE = 'https://api.blox.link/v4/public/guilds';
const UNKNOWN = Symbol('unknown'); // lookup not possible right now (no key, budget spent, API error)

function takeBudget() {
  const day = new Date().toISOString().slice(0, 10);
  const usage = kvGet('bloxlink_usage', { day, count: 0 });
  if (usage.day !== day) Object.assign(usage, { day, count: 0 });
  if (usage.count >= config.settings.bloxlink.dailyRequestBudget) return false;
  usage.count += 1;
  kvSet('bloxlink_usage', usage);
  return true;
}

async function call(path) {
  const key = process.env.BLOXLINK_API_KEY;
  if (!key || !takeBudget()) return UNKNOWN;
  try {
    const res = await fetch(`${BASE}/${process.env.GUILD_ID}/${path}`, {
      headers: { Authorization: key },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 404) return null;
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      // Bloxlink answers "user not found / not linked" with an error body on some versions.
      if (res.status === 400 && /not.*(found|linked|verified)/i.test(data?.error ?? '')) return null;
      console.warn(`[bloxlink] ${res.status} ${data?.error ?? ''}`);
      return UNKNOWN;
    }
    return data;
  } catch (err) {
    console.warn('[bloxlink]', err.message);
    return UNKNOWN;
  }
}

function fresh(row) {
  if (!row) return false;
  const { linkedCacheHours, unlinkedCacheHours } = config.settings.bloxlink;
  const hours = row.discord_id || row.roblox_id ? linkedCacheHours : unlinkedCacheHours;
  return now() - row.fetched_at < hours * 3600;
}

// Roblox user ID -> Discord user ID (only members of this server), null if not linked, UNKNOWN if we can't tell.
async function robloxToDiscord(robloxId) {
  if (!robloxId) return null;
  const manual = get('SELECT discord_id FROM manual_links WHERE roblox_id = ?', robloxId);
  if (manual) return manual.discord_id;
  const cached = get('SELECT discord_id, fetched_at FROM roblox_links WHERE roblox_id = ?', robloxId);
  if (fresh(cached)) return cached.discord_id;

  const data = await call(`roblox-to-discord/${robloxId}`);
  if (data === UNKNOWN) return cached ? cached.discord_id : UNKNOWN;
  const discordId = data?.discordIDs?.[0] ?? null;
  run(
    'INSERT INTO roblox_links(roblox_id, discord_id, fetched_at) VALUES(?, ?, ?) ON CONFLICT(roblox_id) DO UPDATE SET discord_id = excluded.discord_id, fetched_at = excluded.fetched_at',
    robloxId, discordId, now(),
  );
  return discordId;
}

// Discord user ID -> Roblox user ID, null if not linked, UNKNOWN if we can't tell.
// force: skip the cache (e.g. right after someone verifies).
async function discordToRoblox(discordId, { force = false } = {}) {
  const manual = get('SELECT roblox_id FROM manual_links WHERE discord_id = ?', discordId);
  if (manual) return manual.roblox_id;
  const cached = get('SELECT roblox_id, fetched_at FROM discord_links WHERE discord_id = ?', discordId);
  if (!force && fresh(cached)) return cached.roblox_id;

  const data = await call(`discord-to-roblox/${discordId}`);
  if (data === UNKNOWN) return cached ? cached.roblox_id : UNKNOWN;
  const robloxId = data?.robloxID ? Number(data.robloxID) : null;
  run(
    'INSERT INTO discord_links(discord_id, roblox_id, fetched_at) VALUES(?, ?, ?) ON CONFLICT(discord_id) DO UPDATE SET roblox_id = excluded.roblox_id, fetched_at = excluded.fetched_at',
    discordId, robloxId, now(),
  );
  return robloxId;
}

module.exports = { robloxToDiscord, discordToRoblox, UNKNOWN };
