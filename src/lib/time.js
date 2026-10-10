// Time helpers, all in the community's timezone (settings.timezone).
const { DateTime } = require('luxon');
const { config } = require('./config');

const zone = () => config.settings.timezone;
const WEEKDAYS = { monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6, sunday: 7 };

const local = (unix) => DateTime.fromSeconds(unix, { zone: zone() });
const nowLocal = () => DateTime.now().setZone(zone());

// Start (unix) of the quota week containing `unix`. Weeks reset at 00:00 on quota.weekResetDay.
function weekStart(unix = Math.floor(Date.now() / 1000), offsetWeeks = 0) {
  const resetDay = WEEKDAYS[String(config.quota.weekResetDay).toLowerCase()] ?? 5;
  let d = local(unix).startOf('day');
  const back = (d.weekday - resetDay + 7) % 7;
  d = d.minus({ days: back }).plus({ weeks: offsetWeeks });
  return Math.floor(d.toSeconds());
}

const dayKey = (unix) => local(unix).toISODate();

// Accepts "30m", "2h", "1h30m", "18:30", "2026-10-01 18:30". Returns unix seconds or null.
function parseWhen(input) {
  const s = String(input).trim().toLowerCase();
  const rel = s.match(/^(?:in\s+)?(?:(\d+)\s*h)?\s*(?:(\d+)\s*m)?$/);
  if (rel && (rel[1] || rel[2])) {
    return Math.floor(Date.now() / 1000) + (Number(rel[1] || 0) * 3600) + (Number(rel[2] || 0) * 60);
  }
  const hm = s.match(/^(\d{1,2}):(\d{2})\s*(am|pm)?$/);
  if (hm) {
    let hour = Number(hm[1]);
    if (hm[3] === 'pm' && hour < 12) hour += 12;
    if (hm[3] === 'am' && hour === 12) hour = 0;
    let d = nowLocal().set({ hour, minute: Number(hm[2]), second: 0, millisecond: 0 });
    if (d < nowLocal()) d = d.plus({ days: 1 });
    return Math.floor(d.toSeconds());
  }
  const full = DateTime.fromFormat(s, 'yyyy-MM-dd HH:mm', { zone: zone() });
  if (full.isValid) return Math.floor(full.toSeconds());
  const unix = s.match(/^<t:(\d+)(?::\w)?>$|^(\d{10})$/);
  if (unix) return Number(unix[1] || unix[2]);
  return null;
}

module.exports = { local, nowLocal, weekStart, dayKey, parseWhen, zone };
