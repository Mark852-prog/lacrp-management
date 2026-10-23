// Automatic Discord reminder: players in-game who aren't in the Discord get a private in-game
// message telling them to join. Settings live in config/settings.json under "discordReminder".
// Staff (any in-game permission) and players marked as joined with ':log dcheck <name> yes' are skipped.
const erlc = require('../lib/erlc');
const { get } = require('../lib/db');
const { config } = require('../lib/config');
const { membershipOf } = require('../lib/serverCheck');

const DEFAULTS = {
  enabled: true,
  checkEveryMinutes: 3,
  repeatEveryMinutes: 10,
  maxPerVisit: 3,
  message: 'NOTICE You are not in our communitey! Join with code LACRLA to keep playing, or you will be kicked.', // never say "Discord": Roblox's chat filter blurs it
};

let lastRunAt = 0;
let running = false;
// robloxId -> { count, lastAt } for players currently in-game; cleared when they leave.
const sent = new Map();

function hasMemberNamed(guild, robloxName) {
  const name = robloxName.toLowerCase();
  return guild.members.cache.some((m) => !m.user.bot && [m.nickname, m.user.username, m.user.globalName].some((n) => n?.toLowerCase() === name));
}

async function check(client, server) {
  const cfg = { ...DEFAULTS, ...(config.settings.discordReminder ?? {}) };
  if (!cfg.enabled || running) return;
  if (Date.now() - lastRunAt < cfg.checkEveryMinutes * 60_000) return;
  running = true;
  lastRunAt = Date.now();
  try {
    const guild = await client.guilds.fetch(process.env.GUILD_ID);
    const players = (server.Players ?? [])
      .filter((p) => !p.Permission || p.Permission === 'Normal')
      .map((p) => erlc.parsePlayer(p.Player))
      .filter((p) => p.id && p.name);

    const here = new Set(players.map((p) => String(p.id)));
    for (const id of sent.keys()) if (!here.has(id)) sent.delete(id);

    for (const p of players) {
      if (get("SELECT 1 FROM dc_status WHERE roblox_id = ? AND status = 'confirmed'", p.id)) continue;
      const state = sent.get(String(p.id)) ?? { count: 0, lastAt: 0 };
      if (state.count >= cfg.maxPerVisit || Date.now() - state.lastAt < cfg.repeatEveryMinutes * 60_000) continue;
      const m = await membershipOf(guild, p.id).catch(() => ({ status: 'unknown' }));
      if (m.status === 'member') continue;
      // Bloxlink can't answer (daily limit, outage) or the account isn't linked: nicknames are kept equal to
      // Roblox usernames, so a member with this name means they are in the Discord.
      if (hasMemberNamed(guild, p.name)) continue;
      try {
        await erlc.runCommand(`:pm ${p.name} ${cfg.message}`);
        sent.set(String(p.id), { count: state.count + 1, lastAt: Date.now() });
        console.log(`[discord reminder] PM sent to ${p.name} (${state.count + 1}/${cfg.maxPerVisit}${m.status === 'unknown' ? ', Bloxlink unavailable - matched by name' : ''})`);
      } catch (err) {
        console.warn(`[discord reminder] PM to ${p.name} failed: ${err.message}`);
      }
    }
  } finally {
    running = false;
  }
}

module.exports = { check };
