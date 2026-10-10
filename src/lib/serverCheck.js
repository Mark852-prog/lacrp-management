// Logic behind /server-check: who's not in the Discord, and who's driving a restricted vehicle/livery.
const { get } = require('./db');
const { config } = require('./config');
const { role } = require('./guildConfig');
const { parsePlayer } = require('./erlc');
const { robloxToDiscord, UNKNOWN } = require('./bloxlink');
const { can } = require('./permissions');

const tokens = (s) => String(s).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);

function lev(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length][b.length];
}

// Loose match: the year must match exactly, every other word must appear (allowing small typos
// like "Chevon"/"Chevelon" vs "Chevlon" on words of 5+ letters).
function vehicleMatches(restricted, actual) {
  const want = tokens(restricted);
  const have = tokens(actual);
  return want.every((w) => have.some((h) => h === w || (w.length >= 5 && !/^\d+$/.test(w) && lev(w, h) <= 2)));
}

// Restricted liveries: exact name match (case ignored), skipped for teams like Civilian.
function liveryRestricted(texture, team) {
  const { restrictedLiveries = [], liveryIgnoredTeams = [] } = config.vehicles;
  if (!texture) return false;
  if (team && liveryIgnoredTeams.some((t) => t.toLowerCase() === String(team).toLowerCase())) return false;
  return restrictedLiveries.some((l) => l.trim().toLowerCase() === String(texture).trim().toLowerCase());
}

// Staff-only liveries: the livery name CONTAINS one of these (case ignored), e.g. "LACRP Staff".
function staffLivery(texture) {
  const { staffLiveries = [] } = config.vehicles;
  const t = String(texture ?? '').toLowerCase();
  return Boolean(t) && staffLiveries.some((l) => t.includes(l.toLowerCase()));
}

async function membershipOf(guild, robloxId) {
  const discordId = await robloxToDiscord(robloxId);
  if (discordId === UNKNOWN) return { status: 'unknown' };
  if (!discordId) return { status: 'missing' };
  const member = await guild.members.fetch(discordId).catch(() => null);
  return member ? { status: 'member', member } : { status: 'missing' };
}

async function run(guild, server) {
  const players = (server.Players ?? []).map((p) => ({ ...parsePlayer(p.Player), team: p.Team, permission: p.Permission }));
  const byName = new Map(players.map((p) => [p.name?.toLowerCase(), p]));

  // Not in Discord
  const notInDiscord = [];
  let unknown = 0;
  const memberOf = new Map();
  for (const p of players) {
    if (!p.id) continue;
    const confirmed = get("SELECT 1 FROM dc_status WHERE roblox_id = ? AND status = 'confirmed'", p.id);
    const m = await membershipOf(guild, p.id);
    memberOf.set(p.id, m);
    if (confirmed) continue;
    if (m.status === 'missing') notInDiscord.push(p);
    else if (m.status === 'unknown') unknown += 1;
  }

  // Vehicle restrictions. Premium/VIP may use restricted vehicles and the Standard livery;
  // staff liveries are for staff only (Premium/VIP doesn't unlock those).
  const exemptRoles = ['premium', 'vip'].map(role).filter(Boolean);
  // Prohibited vehicles are flagged for everyone - Premium/VIP don't unlock those.
  const { restrictedVehicles = [], prohibitedVehicles = [] } = config.vehicles;
  const flagged = [];
  for (const v of server.Vehicles ?? []) {
    const owner = byName.get(String(v.Owner).toLowerCase()) ?? { name: v.Owner, id: null, team: null };
    const m = owner.id ? memberOf.get(owner.id) : null;
    const member = m?.member ?? null;
    const premium = Boolean(member && exemptRoles.some((r) => member.roles.cache.has(r)));
    const isStaff = Boolean(member && can(member, 'staff'));

    const reasons = [];
    if (prohibitedVehicles.some((r) => vehicleMatches(r, v.Name))) reasons.push('prohibited vehicle');
    else if (!premium && restrictedVehicles.some((r) => vehicleMatches(r, v.Name))) reasons.push('restricted vehicle');
    if (!premium && liveryRestricted(v.Texture, owner.team)) reasons.push(`restricted livery '${v.Texture}'`);
    if (!isStaff && staffLivery(v.Texture)) reasons.push(`staff livery '${v.Texture}' but not staff`);
    if (!reasons.length) continue;
    // unverified = driver isn't linked to a Discord member, so Premium/VIP/staff can't be confirmed.
    flagged.push({ vehicle: v, owner, member, reasons, unverified: !member });
  }

  return { players, notInDiscord, unknown, flagged };
}

module.exports = { run, vehicleMatches, liveryRestricted, staffLivery };
