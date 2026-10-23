// Keeps Verified and Unverified apart: whoever gets the Verified role (Bloxlink, /verify, or by hand)
// loses the Unverified role. A sweep on startup and every hour fixes anyone who still has both.
const { role } = require('../lib/guildConfig');

const SWEEP_MS = 60 * 60 * 1000;
const REASON = 'Verified: Unverified role removed';

const unverifiedRole = (guild) => guild.roles.cache.find((r) => /^unverified$/i.test(r.name.replace(/[^a-z]/gi, '')));

async function fix(member) {
  const verified = role('verified');
  const unverified = unverifiedRole(member.guild);
  if (!verified || !unverified || !member.roles.cache.has(verified) || !member.roles.cache.has(unverified.id)) return false;
  await member.roles.remove(unverified, REASON);
  return true;
}

async function sweep(guild) {
  const verified = role('verified');
  const unverified = unverifiedRole(guild);
  if (!verified || !unverified) {
    console.warn(`[verified roles] ${!verified ? 'Verified role not set (/setup roles verified)' : 'no role named Unverified'} - nothing to do`);
    return null;
  }
  // Other services load the member list at startup too; Discord rate limits that, so wait and retry.
  let members;
  for (let attempt = 1; !members; attempt += 1) {
    try {
      members = await guild.members.fetch();
    } catch (err) {
      const wait = Number(/after ([\d.]+)/.exec(err.message)?.[1] ?? 10);
      if (attempt >= 6) throw err;
      await new Promise((r) => setTimeout(r, (wait + 2) * 1000));
    }
  }
  const counts = { fixed: 0, failed: 0, verified: 0, unverified: 0, neither: 0 };
  for (const m of members.values()) {
    if (m.user.bot) continue;
    const v = m.roles.cache.has(verified);
    const u = m.roles.cache.has(unverified.id);
    if (v) counts.verified += 1;
    if (u && !v) counts.unverified += 1;
    if (!v && !u) counts.neither += 1;
    if (v && u) {
      await m.roles.remove(unverified, REASON).then(() => { counts.fixed += 1; }, () => { counts.failed += 1; });
      await new Promise((r) => setTimeout(r, 400));
    }
  }
  console.log('[verified roles] sweep', counts);
  return counts;
}

function attach(client) {
  client.on('guildMemberUpdate', (before, after) => {
    if (after.guild.id !== process.env.GUILD_ID) return;
    const verified = role('verified');
    if (verified && !before.roles?.cache.has(verified) && after.roles.cache.has(verified)) {
      fix(after).catch((err) => console.warn('[verified roles]', after.user.tag, err.message));
    }
  });
  const run = () => {
    const guild = client.guilds.cache.get(process.env.GUILD_ID);
    if (guild) sweep(guild).catch((err) => console.warn('[verified roles] sweep failed:', err.message));
  };
  setTimeout(run, 90_000); // attach() runs once the bot is ready; start after the other startup member loads
  setInterval(run, SWEEP_MS);
}

module.exports = { attach, fix, sweep, unverifiedRole };
