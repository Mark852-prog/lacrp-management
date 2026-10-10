// Gives the "In-Game" role (/setup roles in_game) to linked members while they're in the ER:LC
// server, and removes it when they leave. Runs on every poll with the latest player list.
const { role } = require('../lib/guildConfig');
const { parsePlayer } = require('../lib/erlc');
const { robloxToDiscord, UNKNOWN } = require('../lib/bloxlink');

let client;
let busy = false;

async function update(server) {
  const roleId = role('in_game');
  if (!roleId || !client || busy) return;
  const guild = client.guilds.cache.get(process.env.GUILD_ID);
  const inGameRole = guild?.roles.cache.get(roleId);
  if (!inGameRole) return;
  busy = true;
  try {
    // Discord members who are in-game right now (via Bloxlink links, cached).
    const shouldHave = new Set();
    for (const p of server.Players ?? []) {
      const { id } = parsePlayer(p.Player);
      if (!id) continue;
      const discordId = await robloxToDiscord(id);
      if (discordId && discordId !== UNKNOWN) shouldHave.add(discordId);
    }
    for (const id of shouldHave) {
      if (inGameRole.members.has(id)) continue;
      const member = await guild.members.fetch(id).catch(() => null);
      await member?.roles.add(roleId, 'Joined the ER:LC server').catch((e) => console.warn('[in-game role]', e.message));
    }
    for (const member of inGameRole.members.values()) {
      if (!shouldHave.has(member.id)) await member.roles.remove(roleId, 'Left the ER:LC server').catch((e) => console.warn('[in-game role]', e.message));
    }
  } finally {
    busy = false;
  }
}

function attach(discordClient) {
  client = discordClient;
}

module.exports = { attach, update };
