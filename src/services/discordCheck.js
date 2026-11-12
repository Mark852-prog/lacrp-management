// Automatic Discord check: PMs in-game players who are not in the Discord server.
//
// Uses the same Bloxlink lookup as /server-check. Nobody is kicked - this only sends the in-game PM.
//  - Players staff already confirmed with ":log dc <name> yes" are skipped.
//    (A "no" keeps the player on the list, so they keep getting the reminder.)
//  - Players Bloxlink can't answer for right now (no key, daily budget spent, API error) are skipped, never guessed.
//  - Each player gets the PM when first seen, then a reminder every `repeatSeconds` (default 90) while they stay in-game.
//    When they leave and rejoin they get it again straight away.
// Optional settings.json block (defaults shown): "discordCheckPm": { "enabled": true, "repeatSeconds": 90 }
const { get } = require('../lib/db');
const { config } = require('../lib/config');
const erlc = require('../lib/erlc');
const { robloxToDiscord, UNKNOWN } = require('../lib/bloxlink');

const MESSAGE = 'NOTICE You are not in our communitey! Join with code LACRLA to keep playing, or you will be kicked.';

const CHECK_EVERY_MS = 30_000; // how often the player list is checked
const MAX_PMS_PER_RUN = 8; // keeps the in-game command queue short
const ABSENT_CACHE_MS = 10 * 60_000; // remember "linked but not in this server" so we don't ask Discord every minute

const lastPm = new Map(); // roblox id -> ms of the last PM
const absentUntil = new Map(); // discord id -> ms until we ask Discord again
let lastRun = 0;
let busy = false;
let lastUnknownWarn = 0;
let announced = false;

async function inGuild(guild, discordId) {
  if (guild.members.cache.has(discordId)) return true;
  if ((absentUntil.get(discordId) ?? 0) > Date.now()) return false;
  const member = await guild.members.fetch(discordId).catch(() => null);
  if (!member) absentUntil.set(discordId, Date.now() + ABSENT_CACHE_MS);
  return Boolean(member);
}

// Second opinion that doesn't rely on Bloxlink: verified members are nicknamed with their exact Roblox
// username, so anyone in the Discord whose nickname / display name / username contains the player's
// name (as a whole word) counts as "in the server". Prevents PMs to members Bloxlink can't match.
let lastFullFetch = 0;
async function refreshMembers(guild) {
  if (Date.now() - lastFullFetch < 10 * 60_000) return;
  lastFullFetch = Date.now();
  await guild.members.fetch().catch((err) => console.warn('[discord check] member list refresh failed:', err.message));
}
const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function nameInGuild(guild, name) {
  const re = new RegExp(`(^|[^A-Za-z0-9_])${esc(name)}($|[^A-Za-z0-9_])`, 'i');
  return guild.members.cache.some((m) => !m.user?.bot && [m.nickname, m.displayName, m.user?.username, m.user?.globalName].some((n) => n && re.test(n)));
}

async function update(client, server) {
  const cfg = config.settings.discordCheckPm ?? {};
  if (cfg.enabled === false || busy || Date.now() - lastRun < CHECK_EVERY_MS) return;
  const guild = client?.guilds.cache.get(process.env.GUILD_ID);
  if (!guild) return;
  busy = true;
  lastRun = Date.now();
  if (!announced) { announced = true; console.log('[discord check] running: players not in the Discord get an in-game PM (checked every 30 seconds, reminder about every 90 seconds)'); }
  try {
    await refreshMembers(guild);
    const repeatMs = Math.max(30, Number(cfg.repeatSeconds) || 90) * 1000;
    const players = (server.Players ?? []).map((p) => erlc.parsePlayer(p.Player)).filter((p) => p.id && p.name);

    // Forget players who left, so they're PM'd again when they come back.
    const present = new Set(players.map((p) => p.id));
    for (const id of lastPm.keys()) if (!present.has(id)) lastPm.delete(id);

    let sent = 0;
    let unknown = 0;
    for (const p of players) {
      if (sent >= MAX_PMS_PER_RUN) break;
      if (Date.now() - (lastPm.get(p.id) ?? 0) < repeatMs) continue;
      if (get("SELECT 1 FROM dc_status WHERE roblox_id = ? AND status = 'confirmed'", p.id)) continue;

      if (nameInGuild(guild, p.name)) continue;
      const discordId = await robloxToDiscord(p.id);
      if (discordId === UNKNOWN) { unknown += 1; continue; }
      if (discordId && (await inGuild(guild, discordId))) continue;

      lastPm.set(p.id, Date.now());
      sent += 1;
      await erlc.runCommand(`:pm ${p.name} ${MESSAGE}`)
        .then(() => console.log(`[discord check] PM sent to ${p.name}`))
        .catch((err) => console.warn(`[discord check] PM to ${p.name} failed: ${err.message}`));
    }
    // Bloxlink couldn't answer (no BLOXLINK_API_KEY, daily limit reached, or an API error): nobody is PM'd for those players.
    if (unknown && Date.now() - lastUnknownWarn > 10 * 60_000) {
      lastUnknownWarn = Date.now();
      console.warn(`[discord check] Bloxlink couldn't be checked for ${unknown} player(s), so they were skipped. Check BLOXLINK_API_KEY in .env and the daily limit.`);
    }
  } finally {
    busy = false;
  }
}

module.exports = { update, MESSAGE };
