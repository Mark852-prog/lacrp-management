// Member timezones and availability (timezone panel, /availability, availability polls) and the
// numbers behind /session-times. Availability is stored as the member picked it (local days + blocks)
// and converted to UTC hours of the week; poll answers are kept per poll for that one week.
const { DateTime } = require('luxon');
const { config } = require('./config');
const { getSlot, setSlot } = require('./guildConfig');
const { run, get, all, transaction, now } = require('./db');

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const HOUR = 3600;
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');

const zones = () => config.timezones.zones;
const zoneByKey = (key) => zones().find((z) => z.key === key) ?? null;
const blocks = () => config.timezones.blocks;

// ---------------------------------------------------------------- formatting
// 18 -> "6 PM", 24 -> "12 AM", 12 -> "12 PM"
function hourLabel(h) {
  const x = ((h % 24) + 24) % 24;
  return `${x % 12 || 12} ${x < 12 ? 'AM' : 'PM'}`;
}
// Block 18 -> "6–8 PM", 22 -> "10 PM–12 AM", 24 -> "12–2 AM"
function blockLabel(start, length = 2) {
  const a = hourLabel(start); const b = hourLabel(start + length);
  return a.slice(-2) === b.slice(-2) ? `${a.slice(0, -3)}–${b}` : `${a}–${b}`;
}
// "Sat 8:00 PM" in a zone.
const at = (unix, zone, fmt = 'ccc h:mm a') => DateTime.fromSeconds(unix, { zone }).toFormat(fmt);
// "UTC−4", "UTC+5:30", "UTC"
function offsetLabel(zone, unix = now()) {
  const o = DateTime.fromSeconds(unix, { zone }).offset;
  if (!o) return 'UTC';
  const a = Math.abs(o);
  return `UTC${o < 0 ? '−' : '+'}${Math.floor(a / 60)}${a % 60 ? `:${String(a % 60).padStart(2, '0')}` : ''}`;
}

// ---------------------------------------------------------------- timezones
// The role for a timezone: remembered ID, else a role with the same name.
function zoneRole(guild, z) {
  const id = getSlot(`tzrole:${z.key}`);
  const saved = id && guild.roles.cache.get(id);
  if (saved) return saved;
  const found = guild.roles.cache.find((r) => norm(r.name) === norm(z.role));
  if (found) setSlot(`tzrole:${z.key}`, found.id);
  return found ?? null;
}

// The member's timezone: saved by the bot, else read from their timezone role.
function memberZone(member) {
  const saved = get('SELECT tz FROM member_timezones WHERE user_id = ?', member.id);
  if (saved && zoneByKey(saved.tz)) return { ...zoneByKey(saved.tz), source: 'saved' };
  const z = zones().find((x) => {
    const r = zoneRole(member.guild, x);
    return r && member.roles.cache.has(r.id);
  });
  return z ? { ...z, source: 'role' } : null;
}

// Saves the timezone, gives its role and removes any other timezone role. Returns { zone, roleNote }.
async function setMemberZone(member, key) {
  const z = zoneByKey(key);
  if (!z) throw new Error(`Unknown timezone ${key}`);
  run('INSERT INTO member_timezones(user_id, tz, updated_at) VALUES(?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET tz = excluded.tz, updated_at = excluded.updated_at', member.id, key, now());
  rebuildUtc(member.id);
  let roleNote = null;
  const wanted = zoneRole(member.guild, z);
  const others = zones().map((x) => zoneRole(member.guild, x)).filter((r) => r && r.id !== wanted?.id && member.roles.cache.has(r.id));
  try {
    if (others.length) await member.roles.remove(others, 'Timezone changed');
    if (wanted && !member.roles.cache.has(wanted.id)) await member.roles.add(wanted, 'Timezone picked');
    if (!wanted) roleNote = `the **${z.role}** role doesn't exist yet, so only the bot remembers it`;
  } catch {
    roleNote = 'the bot couldn\'t change your roles (its role must be above the timezone roles)';
  }
  return { zone: z, roleNote };
}

// ---------------------------------------------------------------- /availability
function localBlocks(userId) {
  return all('SELECT day, block FROM availability_blocks WHERE user_id = ? ORDER BY day, block', userId);
}

// Replaces the blocks for the given local days (1 = Mon). Empty blockList = not available those days.
function saveDays(userId, days, blockList) {
  transaction(() => {
    for (const d of days) {
      run('DELETE FROM availability_blocks WHERE user_id = ? AND day = ?', userId, d);
      for (const b of blockList) run('INSERT INTO availability_blocks(user_id, day, block) VALUES(?, ?, ?)', userId, d, b);
    }
  });
  rebuildUtc(userId);
}

function clearAvailability(userId) {
  run('DELETE FROM availability_blocks WHERE user_id = ?', userId);
  run('DELETE FROM availability_utc WHERE user_id = ?', userId);
}

// Converts the member's local blocks to UTC hours of the week, using this week's UTC offset.
function rebuildUtc(userId) {
  const tz = get('SELECT tz FROM member_timezones WHERE user_id = ?', userId);
  const z = tz && zoneByKey(tz.tz);
  const rows = localBlocks(userId);
  transaction(() => {
    run('DELETE FROM availability_utc WHERE user_id = ?', userId);
    if (!z) return;
    const monday = DateTime.now().setZone(z.zone).startOf('week');
    const hours = new Set();
    for (const { day, block } of rows) {
      for (let k = 0; k < 2; k++) {
        const u = monday.plus({ days: day - 1 }).plus({ hours: block + k }).toUTC();
        hours.add((u.weekday - 1) * 24 + u.hour);
      }
    }
    for (const how of hours) run('INSERT INTO availability_utc(user_id, how) VALUES(?, ?)', userId, how);
  });
}

// "Mon — 6 PM–12 AM" lines, consecutive blocks merged, in the member's own time.
function summaryLines(userId) {
  const rows = localBlocks(userId);
  const lines = [];
  for (let d = 1; d <= 7; d++) {
    const list = rows.filter((r) => r.day === d).map((r) => r.block).sort((a, b) => a - b);
    if (!list.length) continue;
    const ranges = [];
    for (const b of list) {
      const last = ranges[ranges.length - 1];
      if (last && last[1] === b) last[1] = b + 2;
      else ranges.push([b, b + 2]);
    }
    lines.push(`**${DAYS[d - 1].slice(0, 3)}** — ${ranges.map(([a, b]) => blockLabel(a, b - a)).join(', ')}`);
  }
  return lines;
}

// ---------------------------------------------------------------- polls
// Unix start of each 1-hour slot a poll answer covers.
function pollHours(poll, vote) {
  const days = JSON.parse(vote.days); const picked = JSON.parse(vote.blocks);
  const start = DateTime.fromSeconds(poll.week_start, { zone: config.timezones.pollZone });
  const out = [];
  for (const d of days) {
    for (const b of picked) {
      const t = Math.floor(start.plus({ days: d }).plus({ hours: b }).toSeconds());
      out.push(t, t + HOUR);
    }
  }
  return out;
}

// ---------------------------------------------------------------- recommendations
// Who is available in each hour of the next 7 days (from the next full hour).
//   confirmed: /availability (repeats weekly) or a poll answer covering that hour
//   likely:    only a timezone - counted during config estimate hours in their own time
// members: Collection of current guild members (bots are skipped).
function hourly(members, from = Math.ceil(now() / HOUR) * HOUR) {
  const hours = Array.from({ length: 7 * 24 }, (_, i) => from + i * HOUR);
  const inGuild = new Set(members.filter((m) => !m.user.bot).map((m) => m.id));
  const confirmed = hours.map(() => new Set());

  const index = new Map(hours.map((t, i) => [t, i]));
  // /availability: each member's local picks placed on the real dates in their timezone, so a daylight
  // saving switch during the week is handled (availability_utc holds the same data at this week's offset).
  const byUser = new Map();
  for (const r of all('SELECT b.user_id, b.day, b.block, t.tz FROM availability_blocks b JOIN member_timezones t ON t.user_id = b.user_id')) {
    if (!inGuild.has(r.user_id) || !zoneByKey(r.tz)) continue;
    if (!byUser.has(r.user_id)) byUser.set(r.user_id, { zone: zoneByKey(r.tz).zone, rows: [] });
    byUser.get(r.user_id).rows.push(r);
  }
  for (const [id, { zone, rows }] of byUser) {
    const first = DateTime.fromSeconds(from, { zone }).startOf('day').minus({ days: 1 });
    for (let d = 0; d <= 8; d++) {
      const date = first.plus({ days: d });
      for (const r of rows.filter((x) => x.day === date.weekday)) {
        for (let k = 0; k < 2; k++) {
          const i = index.get(Math.floor(date.plus({ hours: r.block + k }).toSeconds()));
          if (i !== undefined) confirmed[i].add(id);
        }
      }
    }
  }

  const polls = all('SELECT * FROM avail_polls WHERE week_start > ?', from - 8 * 86400);
  const pollUsers = new Set();
  for (const poll of polls) {
    for (const v of all('SELECT * FROM avail_poll_votes WHERE message_id = ?', poll.message_id)) {
      if (!inGuild.has(v.user_id)) continue;
      pollUsers.add(v.user_id);
      for (const t of pollHours(poll, v)) if (index.has(t)) confirmed[index.get(t)].add(v.user_id);
    }
  }

  const withAvailability = new Set(byUser.keys());
  const { weekday, weekend } = config.timezones.estimate;
  const likely = hours.map(() => new Set());
  const zoned = [];
  for (const m of members.values()) {
    if (m.user.bot || withAvailability.has(m.id) || pollUsers.has(m.id)) continue;
    const z = memberZone(m);
    if (z) zoned.push([m.id, z.zone]);
  }
  hours.forEach((t, i) => {
    for (const [id, zone] of zoned) {
      const local = DateTime.fromSeconds(t, { zone });
      // Hours just after midnight belong to the evening before.
      const day = local.hour < 4 ? local.minus({ days: 1 }) : local;
      const hour = local.hour < 4 ? local.hour + 24 : local.hour;
      const [a, b] = day.weekday >= 6 ? weekend : weekday;
      if (hour >= a && hour < b) likely[i].add(id);
    }
  });

  return {
    hours, confirmed, likely,
    counts: {
      availability: withAvailability.size,
      poll: pollUsers.size,
      zoneOnly: zoned.length,
    },
  };
}

// Best non-overlapping slots of `length` hours. Score = confirmed + weight x likely, for the whole slot.
function bestSlots(data, { length = 2, count = 5 } = {}) {
  const weight = config.timezones.estimate.weight;
  const slots = [];
  for (let i = 0; i + length <= data.hours.length; i++) {
    const inter = (sets) => [...sets[i]].filter((id) => sets.slice(i + 1, i + length).every((s) => s.has(id)));
    const confirmed = inter(data.confirmed).length;
    const likely = inter(data.likely).length;
    if (!confirmed && !likely) continue;
    slots.push({ start: data.hours[i], confirmed, likely, score: confirmed + weight * likely });
  }
  slots.sort((a, b) => b.score - a.score || a.start - b.start);
  const picked = [];
  for (const s of slots) {
    if (picked.length >= count) break;
    if (picked.some((p) => Math.abs(p.start - s.start) < length * HOUR)) continue;
    picked.push(s);
  }
  return picked;
}

module.exports = {
  DAYS, HOUR, zones, zoneByKey, blocks, hourLabel, blockLabel, at, offsetLabel,
  zoneRole, memberZone, setMemberZone, localBlocks, saveDays, clearAvailability, rebuildUtc, summaryLines,
  pollHours, hourly, bestSlots,
};
