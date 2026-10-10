// Keeps every member's server nickname equal to their exact Roblox username (via Bloxlink).
//   - on join, and when they get the Bloxlink "verified" role (/setup roles verified)
//   - if someone changes their own nickname, it's put back (Senior High Rank are exempt)
//   - a sweep every 6 hours catches anything missed; /setup nicknames does everyone right now
const { discordToRoblox, UNKNOWN } = require('../lib/bloxlink');
const { role } = require('../lib/guildConfig');

const SWEEP_MS = 6 * 60 * 60 * 1000;
const usernames = new Map(); // robloxId -> { name, at }

async function robloxUsername(robloxId) {
  const hit = usernames.get(robloxId);
  if (hit && Date.now() - hit.at < 24 * 3600 * 1000) return hit.name;
  try {
    const res = await fetch(`https://users.roblox.com/v1/users/${robloxId}`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const { name } = await res.json();
    if (name) usernames.set(robloxId, { name, at: Date.now() });
    return name ?? null;
  } catch {
    return null;
  }
}

// Members the bot leaves alone: bots, the server owner (Discord doesn't allow it), people ranked
// above the bot, and Senior High Rank (allowed to pick their own nickname).
function exempt(member) {
  if (member.user.bot || member.id === member.guild.ownerId || !member.manageable) return true;
  const shr = role('senior_high_rank');
  return Boolean(shr && member.roles.cache.has(shr));
}

// Returns 'renamed' | 'ok' | 'exempt' | 'unlinked' | 'unknown' | 'failed'
async function sync(member, { force = false, reason = 'Nickname = Roblox username' } = {}) {
  if (exempt(member)) return 'exempt';
  const robloxId = await discordToRoblox(member.id, { force });
  if (robloxId === UNKNOWN) return 'unknown';
  if (!robloxId) return 'unlinked';
  const name = await robloxUsername(robloxId);
  if (!name) return 'unknown';
  if (member.nickname === name) return 'ok';
  try {
    await member.setNickname(name, reason);
    return 'renamed';
  } catch (err) {
    console.warn(`[nicknames] ${member.user.tag}: ${err.message}`);
    return 'failed';
  }
}

async function syncAll(guild, { force = false } = {}) {
  const members = await guild.members.fetch();
  const counts = { renamed: 0, ok: 0, exempt: 0, unlinked: 0, unknown: 0, failed: 0 };
  for (const m of members.values()) {
    const result = await sync(m, { force });
    counts[result] += 1;
    if (result === 'renamed') await new Promise((r) => setTimeout(r, 400)); // gentle on Discord rate limits
  }
  return counts;
}

function attach(client) {
  client.on('guildMemberAdd', (member) => {
    if (member.guild.id === process.env.GUILD_ID) sync(member, { force: true, reason: 'Joined: nickname = Roblox username' }).catch(() => {});
  });

  client.on('guildMemberUpdate', async (before, after) => {
    if (after.guild.id !== process.env.GUILD_ID) return;
    // Just verified with Bloxlink -> look them up fresh.
    const verified = role('verified');
    if (verified && !before.roles?.cache.has(verified) && after.roles.cache.has(verified)) {
      await sync(after, { force: true, reason: 'Verified: nickname = Roblox username' }).catch(() => {});
      return;
    }
    // Changed their nickname -> put it back (cached lookup, no extra Bloxlink calls).
    if (before.nickname !== after.nickname) {
      await sync(after, { reason: 'Nicknames must match the Roblox username' }).catch(() => {});
    }
  });

  setInterval(async () => {
    const guild = client.guilds.cache.get(process.env.GUILD_ID);
    if (!guild) return;
    const counts = await syncAll(guild).catch(() => null);
    if (counts?.renamed) console.log('[nicknames] sweep', counts);
  }, SWEEP_MS);
}

module.exports = { attach, sync, syncAll, robloxUsername };
