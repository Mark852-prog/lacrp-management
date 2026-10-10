// Quota tiers, weekly duty hours (from Vex shifts) and activity-check evaluation.
// Tiers are grouped (staff / ia); a member is matched to at most one tier per group.
const { all, get } = require('../lib/db');
const { config } = require('../lib/config');
const { role } = require('../lib/guildConfig');
const { weekStart } = require('../lib/time');
const { discordToRoblox, UNKNOWN } = require('../lib/bloxlink');

function tiers() {
  const overrides = Object.fromEntries(all('SELECT tier_id, weekly_hours FROM quota_overrides').map((r) => [r.tier_id, r.weekly_hours]));
  return config.quota.tiers.map((t) => ({ group: 'staff', ...t, weeklyHours: t.id in overrides ? overrides[t.id] : t.weeklyHours }));
}

const groups = () => [...new Set(config.quota.tiers.map((t) => t.group ?? 'staff'))];
const groupLabel = (g) => config.quota.groups?.[g]?.label ?? g;

const hasRoleSlot = (member, slot) => {
  const id = role(slot);
  return Boolean(id && member.roles.cache.has(id));
};

function tierFor(member, list = tiers(), group = 'staff') {
  return list.find((t) => t.group === group && t.roles.some((slot) => hasRoleSlot(member, slot))) ?? null;
}

// { discordId: seconds } for shifts that ended in [start, end)
function secondsByMember(start, end) {
  const rows = all('SELECT discord_id, SUM(duration_s) AS s FROM shifts WHERE ended_at >= ? AND ended_at < ? GROUP BY discord_id', start, end);
  return Object.fromEntries(rows.map((r) => [r.discord_id, r.s]));
}

const onLoa = (member) => hasRoleSlot(member, 'loa');
const hasQuota = (tier) => tier.weeklyHours != null;

// IA cases logged per member in [start, end)
function iaLogsByMember(start, end) {
  const rows = all('SELECT ia_member_id AS id, COUNT(*) AS n FROM ia_logs WHERE ts >= ? AND ts < ? AND ia_member_id IS NOT NULL GROUP BY ia_member_id', start, end);
  return Object.fromEntries(rows.map((r) => [r.id, r.n]));
}

// extra.logs = IA cases logged this week (only matters for tiers with minLogsPerWeek)
function evaluate(member, hours, tier, extra = {}) {
  if (!hasQuota(tier)) return { key: 'exempt', label: 'No quota', emoji: '➖' };
  if (onLoa(member)) return { key: 'loa', label: 'On LOA', emoji: '💤' };
  const logsOk = tier.minLogsPerWeek == null || (extra.logs ?? 0) >= tier.minLogsPerWeek;
  if (hours >= tier.weeklyHours && logsOk) return { key: 'met', label: 'Quota met', emoji: '✅' };
  if (!tier.enforced) return { key: 'below', label: 'Below quota', emoji: '⚠️' };
  for (const rule of config.quota.enforcement) {
    if ((rule.belowHours != null && hours < rule.belowHours) || (rule.belowQuota && hours < tier.weeklyHours)) {
      return { key: rule.action, label: rule.action, emoji: rule.emoji ?? '⚠️' };
    }
  }
  return { key: 'below', label: 'Below quota', emoji: '⚠️' };
}

// Members who belong to a quota group. Staff-role holders without a specific tier fall back to "general".
async function membersOf(guild, group = 'staff') {
  const members = await guild.members.fetch();
  const list = tiers();
  return members.filter((m) => !m.user.bot && (tierFor(m, list, group) || (group === 'staff' && hasRoleSlot(m, 'staff'))));
}

async function trialProgress(member, tier) {
  if (!tier.trial) return null;
  const since = Math.floor(Date.now() / 1000) - config.quota.trialLookbackDays * 86400;
  const strikes = get("SELECT COUNT(*) AS n FROM infractions WHERE target_id = ? AND ts >= ? AND punishment LIKE '%strike%'", member.id, since).n;
  const out = { strikes, maxStrikes: tier.trial.maxStrikes ?? 0 };
  if (tier.trial.minModerations != null) {
    const robloxId = await discordToRoblox(member.id);
    if (robloxId && robloxId !== UNKNOWN) {
      const cmds = config.settings.moderationCommands;
      const where = cmds.map(() => 'LOWER(command) LIKE ?').join(' OR ');
      out.moderations = get(`SELECT COUNT(*) AS n FROM command_logs WHERE player_id = ? AND ts >= ? AND (${where})`,
        robloxId, since, ...cmds.map((c) => `${c.toLowerCase()} %`)).n;
    } else {
      out.moderations = null; // not linked in Bloxlink
    }
    out.minModerations = tier.trial.minModerations;
  }
  if (tier.trial.minBansReviewed != null) {
    out.bansReviewed = get('SELECT COUNT(*) AS n FROM ban_requests WHERE reviewer_id = ? AND reviewed_at >= ?', member.id, since).n;
    out.minBansReviewed = tier.trial.minBansReviewed;
  }
  return out;
}

// Report for one quota group and week. weekOffset 0 = current week, -1 = last completed week.
async function buildReport(guild, weekOffset = 0, group = 'staff') {
  const start = weekStart(undefined, weekOffset);
  const end = weekStart(undefined, weekOffset + 1);
  const secs = secondsByMember(start, end);
  const logs = iaLogsByMember(start, end);
  const list = tiers();
  const members = await membersOf(guild, group);
  const fallback = list.find((t) => t.id === 'general');

  const rows = [];
  for (const m of members.values()) {
    const tier = tierFor(m, list, group) ?? fallback;
    const hours = (secs[m.id] ?? 0) / 3600;
    const extra = { logs: logs[m.id] ?? 0 };
    rows.push({ member: m, tier, hours, logs: extra.logs, status: evaluate(m, hours, tier, extra), trial: await trialProgress(m, tier) });
  }
  rows.sort((a, b) => b.hours - a.hours);

  // Promotion eligibility: staff group only, 5h+ and top 10 by hours (among people with a quota).
  if (group === 'staff') {
    const promo = config.quota.promotional;
    rows.filter((r) => hasQuota(r.tier)).forEach((r, i) => { r.promoEligible = r.hours >= promo.weeklyHours && i < promo.topN; });
  }
  return { start, end, group, rows };
}

module.exports = { iaLogsByMember, tiers, groups, groupLabel, tierFor, secondsByMember, evaluate, buildReport, membersOf, onLoa, hasQuota };
