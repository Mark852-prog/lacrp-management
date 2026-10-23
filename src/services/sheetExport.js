// One-off export of server information for the management spreadsheet. Triggered by
// data/sheet-job.json at startup; writes data/sheet-export.json (names, ranks, roles, channels - no tokens,
// no emails, nothing outside Discord/Roblox usernames).
const fs = require('node:fs');
const path = require('node:path');
const { PermissionFlagsBits: P, ChannelType } = require('discord.js');
const { get, all } = require('../lib/db');
const { discordToRoblox, UNKNOWN } = require('../lib/bloxlink');
const { can } = require('../lib/permissions');
const { role } = require('../lib/guildConfig');

const DATA = path.join(__dirname, '..', '..', 'data');
const JOB = path.join(DATA, 'sheet-job.json');
const KEY_PERMS = ['Administrator', 'ManageGuild', 'ManageRoles', 'ManageChannels', 'BanMembers', 'KickMembers', 'ModerateMembers',
  'ManageMessages', 'MentionEveryone', 'AttachFiles', 'EmbedLinks', 'UseExternalEmojis', 'UseExternalStickers'];
const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');
const isSeparator = (r) => /^[\s⎯—_.-]*$/.test(r.name);

async function runJob(client) {
  if (!fs.existsSync(JOB)) return;
  fs.rmSync(JOB, { force: true });
  const guild = await client.guilds.fetch(process.env.GUILD_ID);
  await Promise.all([guild.roles.fetch(), guild.channels.fetch(), guild.members.fetch()]);
  const roles = [...guild.roles.cache.values()].sort((a, b) => b.position - a.position);
  const loa = role('loa');

  // Staff: anyone the bot treats as staff (staff role, or a rank at/above Supervisor), bots excluded.
  const members = [...guild.members.cache.filter((m) => !m.user.bot && can(m, 'staff'))
    .sort((a, b) => b.roles.highest.position - a.roles.highest.position).values()];
  const week = Math.floor(Date.now() / 1000) - 7 * 86400;
  const staff = [];
  for (const m of members) {
      // Roblox account: cached link first, otherwise ask Bloxlink, then Roblox for the username.
      let robloxId = get('SELECT roblox_id FROM discord_links WHERE discord_id = ?', m.id)?.roblox_id ?? null;
      if (!robloxId) { const r = await discordToRoblox(m.id, { force: true }).catch(() => null); if (r && r !== UNKNOWN) robloxId = r; }
      let roblox = robloxId ? get('SELECT name, last_seen FROM players WHERE roblox_id = ?', robloxId) : null;
      if (robloxId && !roblox) {
        const res = await fetch(`https://users.roblox.com/v1/users/${robloxId}`, { signal: AbortSignal.timeout(8000) }).catch(() => null);
        const u = res?.ok ? await res.json() : null;
        roblox = u ? { name: u.name, last_seen: null } : null;
      }
      const rank = roles.find((r) => m.roles.cache.has(r.id) && !isSeparator(r) && !r.managed && r.id !== guild.id
        && !/in game|currently moderating|staff of the week|under investigation|leave of absence|^\.$/i.test(r.name));
      const shifts7 = get('SELECT COALESCE(SUM(duration_s), 0) AS s FROM shifts WHERE discord_id = ? AND ended_at >= ?', m.id, week).s;
      const shiftsAll = get('SELECT COALESCE(SUM(duration_s), 0) AS s, COUNT(*) AS n, MAX(ended_at) AS last FROM shifts WHERE discord_id = ?', m.id);
      const inf = all('SELECT punishment, reason, ts FROM infractions WHERE target_id = ? ORDER BY ts DESC', m.id);
      const promos = all("SELECT role_id, ts FROM staff_events WHERE discord_id = ? AND kind = 'promotion' ORDER BY ts DESC", m.id);
      const mods = robloxId ? get(`SELECT SUM(command LIKE ':kick %') AS kicks, SUM(command LIKE ':ban %' OR command LIKE ':tban %') AS bans FROM command_logs WHERE player_id = ?`, robloxId) : null;
      const daysSeen = robloxId ? get('SELECT COUNT(*) AS n FROM player_days WHERE roblox_id = ?', robloxId).n : 0;
      const has = (re) => m.roles.cache.filter((r) => re.test(r.name)).map((r) => r.name).join(', ');
      const ts = (s) => (s ? day(s * 1000) : '');
      staff.push({
        shiftHoursAll: Math.round((shiftsAll.s / 3600) * 10) / 10, shiftCount: shiftsAll.n, lastShift: ts(shiftsAll.last),
        sessionsHosted: get('SELECT COUNT(*) AS n FROM sessions WHERE host_id = ?', m.id).n,
        kicks: mods?.kicks ?? 0, bans: mods?.bans ?? 0, daysInGame: daysSeen,
        iaCases: get('SELECT COUNT(*) AS n FROM ia_logs WHERE ia_member_id = ?', m.id).n,
        banReviews: get('SELECT COUNT(*) AS n FROM ban_requests WHERE reviewer_id = ?', m.id).n,
        staffRequests: get('SELECT COUNT(*) AS n FROM staff_requests WHERE requester_id = ?', m.id).n,
        infractions: inf.length, lastInfraction: inf[0] ? `${ts(inf[0].ts)} ${inf[0].punishment ?? ''} ${inf[0].reason ? '(' + inf[0].reason + ')' : ''}`.trim() : '',
        promotions: promos.length, lastPromotion: promos[0] ? `${ts(promos[0].ts)} ${guild.roles.cache.get(promos[0].role_id)?.name ?? ''}`.trim() : '',
        warnings: has(/^(warning|strike) \d/i), memberships: has(/^(premium member|vip|executive membership|server booster)$/i),
        departments: has(/^department |^los angeles (police|fire|sheriff|government|caltrans)/i),
        teams: has(/^lacrp \| (?!staff team)|^(application reader|ticket handler|training program|training director|discord staff|server advisor|developer)/i),
        discord: m.user.username, display: m.displayName, discordId: m.id,
        roblox: roblox?.name ?? '', robloxId: robloxId ?? '',
        topRank: rank?.name ?? '', allRoles: m.roles.cache.filter((r) => r.id !== guild.id && !isSeparator(r)).sort((a, b) => b.position - a.position).map((r) => r.name).join(', '),
        joinedServer: day(m.joinedAt), onLoa: loa ? m.roles.cache.has(loa) : false,
        shiftHours7d: Math.round((shifts7 / 3600) * 10) / 10,
        lastInGame: roblox?.last_seen ? day(roblox.last_seen * 1000) : '',
      });
  }

  const roleRows = roles.filter((r) => r.id !== guild.id && !isSeparator(r)).map((r) => ({
    name: r.name, members: r.members.size, color: r.color ? r.hexColor : '', managed: r.managed,
    permissions: KEY_PERMS.filter((k) => r.permissions.has(P[k], false)).join(', '),
  }));

  const cats = guild.channels.cache.filter((c) => c.type === ChannelType.GuildCategory).sort((a, b) => a.position - b.position);
  const channelRows = [];
  for (const [catId, catName] of [[null, '(no category)'], ...cats.map((c) => [c.id, c.name])]) {
    const chans = guild.channels.cache.filter((c) => c.parentId === catId && c.type !== ChannelType.GuildCategory).sort((a, b) => a.position - b.position);
    for (const c of chans.values()) {
      const everyoneSees = c.permissionsFor(guild.roles.everyone).has(P.ViewChannel);
      const verified = role('verified') ? guild.roles.cache.get(role('verified')) : null;
      channelRows.push({
        category: catName, name: c.name, type: ChannelType[c.type], topic: c.topic ?? '',
        public: everyoneSees || Boolean(verified && c.permissionsFor(verified).has(P.ViewChannel)),
      });
    }
  }

  fs.writeFileSync(path.join(DATA, 'sheet-export.json'), JSON.stringify({
    generatedAt: new Date().toISOString(),
    server: { name: guild.name, members: guild.memberCount, boosts: guild.premiumSubscriptionCount, tier: guild.premiumTier, vanity: guild.vanityURLCode, created: day(guild.createdAt) },
    staff, roles: roleRows, channels: channelRows,
  }, null, 1));
  console.log(`[sheet export] ${staff.length} staff, ${roleRows.length} roles, ${channelRows.length} channels`);
}

module.exports = { runJob };
