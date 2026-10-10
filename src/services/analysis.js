// Builds the /server-analysis and /staff-analysis reports: numbers + PNG charts.
const { AttachmentBuilder } = require('discord.js');
const { all, get, now } = require('../lib/db');
const { config } = require('../lib/config');
const charts = require('../lib/charts');
const { local, weekStart } = require('../lib/time');
const { brand, plain, formatDuration } = require('../lib/embeds');
const quota = require('./quota');
const { robloxToDiscord, UNKNOWN } = require('../lib/bloxlink');

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// Daily buckets for short ranges, quota-weeks for long ones.
function buckets(since, days) {
  const weekly = days > 31;
  const keyOf = (unix) => (weekly ? local(weekStart(unix)).toISODate() : local(unix).toISODate());
  const keys = [];
  let cursor = weekly ? weekStart(since) : Math.floor(local(since).startOf('day').toSeconds());
  const end = now();
  while (cursor <= end) {
    const k = keyOf(cursor + 43200); // midday offset keeps keys stable across DST changes
    if (!keys.includes(k)) keys.push(k);
    cursor += weekly ? 7 * 86400 : 86400;
  }
  const labels = keys.map((k) => local(Math.floor(Date.parse(`${k}T12:00:00Z`) / 1000)).toFormat(weekly ? "'Wk of' MMM d" : 'MMM d'));
  const index = new Map(keys.map((k, i) => [k, i]));
  return { keys, labels, keyOf, index, weekly, zeros: () => keys.map(() => 0) };
}

const round1 = (n) => Math.round(n * 10) / 10;

function countInto(b, rows, col = 'ts') {
  const arr = b.zeros();
  for (const r of rows) {
    const i = b.index.get(b.keyOf(r[col]));
    if (i != null) arr[i] += r.n ?? 1;
  }
  return arr;
}

async function renderAll(jobs) {
  const results = await Promise.allSettled(jobs.map((j) => j.render()));
  const embeds = [];
  const files = [];
  const failed = [];
  results.forEach((r, i) => {
    const job = jobs[i];
    if (r.status === 'fulfilled') {
      const name = `${job.id}.png`;
      files.push(new AttachmentBuilder(r.value, { name }));
      embeds.push(plain().setImage(`attachment://${name}`).setFooter({ text: job.caption }));
    } else {
      failed.push(job.caption);
      console.warn(`[analysis] chart ${job.id} failed:`, r.reason?.message);
    }
  });
  return { embeds, files, failed };
}

// ======================= SERVER =======================
async function serverAnalysis(guild, days) {
  const since = now() - days * 86400;
  const b = buckets(since, days);
  const hourly = all('SELECT * FROM hourly_stats WHERE hour_ts >= ? ORDER BY hour_ts', since);
  if (!hourly.length) return { empty: true };

  // Heatmap: average players by weekday x hour.
  const sum = Array.from({ length: 7 }, () => Array(24).fill(0));
  const cnt = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const h of hourly) {
    const d = local(h.hour_ts);
    sum[d.weekday - 1][d.hour] += h.sum_players;
    cnt[d.weekday - 1][d.hour] += h.samples;
  }
  const heat = sum.map((row, d) => row.map((s, h) => (cnt[d][h] ? s / cnt[d][h] : null)));
  let best = { v: -1 };
  heat.forEach((row, d) => row.forEach((v, h) => { if (v != null && v > best.v) best = { v, d, h }; }));

  // Daily/weekly aggregates.
  const agg = b.keys.map(() => ({ s: 0, n: 0, ss: 0, sn: 0, peak: 0, queue: 0 }));
  let capacity = 0;
  let tot = { s: 0, n: 0, ss: 0, sn: 0 };
  for (const h of hourly) {
    const i = b.index.get(b.keyOf(h.hour_ts));
    if (i == null) continue;
    const a = agg[i];
    a.s += h.sum_players; a.n += h.samples; a.ss += h.session_sum_players; a.sn += h.session_samples;
    a.peak = Math.max(a.peak, h.max_players); a.queue = Math.max(a.queue, h.max_queue);
    capacity = Math.max(capacity, h.capacity);
    tot = { s: tot.s + h.sum_players, n: tot.n + h.samples, ss: tot.ss + h.session_sum_players, sn: tot.sn + h.session_samples };
  }
  const avgOf = (s, n) => (n ? round1(s / n) : null);
  const avgOverall = avgOf(tot.s, tot.n);
  const avgSession = avgOf(tot.ss, tot.sn);
  const avgOff = avgOf(tot.s - tot.ss, tot.n - tot.sn);
  const queueHours = hourly.filter((h) => h.max_queue > 0).length;
  const fullHours = hourly.filter((h) => h.capacity && h.max_players >= h.capacity).length;

  // Sessions.
  const sessions = all('SELECT s.*, (SELECT COUNT(*) FROM session_players sp WHERE sp.session_id = s.id) AS uniq FROM sessions s WHERE started_at >= ? AND ended_at IS NOT NULL', since);
  const attendance = b.zeros();
  const attendanceN = b.zeros();
  for (const s of sessions) {
    const i = b.index.get(b.keyOf(s.started_at));
    if (i != null) { attendance[i] += s.uniq; attendanceN[i] += 1; }
  }
  const avgDuration = sessions.length ? sessions.reduce((a, s) => a + (s.ended_at - s.started_at), 0) / sessions.length : null;
  const filled = sessions.filter((s) => s.filled_at);
  const avgFill = filled.length ? filled.reduce((a, s) => a + (s.filled_at - s.started_at), 0) / filled.length : null;

  // Retention: players first seen in this period - came back on another day vs one-time.
  const ret = get(`SELECT
      SUM(CASE WHEN d >= 2 THEN 1 ELSE 0 END) AS returned,
      SUM(CASE WHEN d = 1 THEN 1 ELSE 0 END) AS onetime
    FROM (SELECT p.roblox_id, COUNT(pd.day) AS d FROM players p JOIN player_days pd ON pd.roblox_id = p.roblox_id
          WHERE p.first_seen >= ? GROUP BY p.roblox_id)`, since);

  // Growth + frequency trends.
  const newPlayers = countInto(b, all('SELECT first_seen AS ts FROM players WHERE first_seen >= ?', since));
  const joins = countInto(b, all('SELECT ts FROM join_logs WHERE is_join = 1 AND ts >= ?', since));
  const modCalls = countInto(b, all('SELECT ts FROM mod_calls WHERE ts >= ?', since));
  const cmdCount = (list) => {
    const where = list.map(() => 'LOWER(command) LIKE ?').join(' OR ');
    return countInto(b, all(`SELECT ts FROM command_logs WHERE ts >= ? AND (${where})`, since, ...list.map((c) => `${c.toLowerCase()} %`)));
  };
  const bans = cmdCount(config.settings.banCommands);
  const kicks = cmdCount(config.settings.kickCommands);

  const unit = b.weekly ? 'week' : 'day';
  const jobs = [
    { id: 'heatmap', caption: 'Best session hours/days - average players by weekday and hour',
      render: () => charts.heatmap({ title: 'Average players by day & hour', matrix: heat, dayLabels: DAY_LABELS, valueLabel: 'players' }) },
    { id: 'avg-players', caption: `Average player count per ${unit}: overall vs during sessions vs off-peak`,
      render: () => charts.line({ title: 'Average player count', labels: b.labels, yLabel: 'Players', series: [
        { label: 'Overall', data: agg.map((a) => avgOf(a.s, a.n)) },
        { label: 'During sessions', data: agg.map((a) => avgOf(a.ss, a.sn)) },
        { label: 'Off-peak (no session)', data: agg.map((a) => avgOf(a.s - a.ss, a.n - a.sn)) },
      ] }) },
    { id: 'peak-queue', caption: `Peak players and longest queue per ${unit}; dashed line = server capacity`,
      render: () => charts.line({ title: 'Peak population & queue', labels: b.labels, yLabel: 'Players', reference: capacity ? { label: `Capacity (${capacity})`, value: capacity } : null, series: [
        { label: 'Peak players', data: agg.map((a) => (a.n ? a.peak : null)) },
        { label: 'Longest queue', data: agg.map((a) => (a.n ? a.queue : null)) },
      ] }) },
    { id: 'attendance', caption: `Average unique players per session, by ${unit}`,
      render: () => charts.line({ title: 'Session attendance', labels: b.labels, yLabel: 'Unique players per session', series: [
        { label: 'Avg attendance', data: attendance.map((v, i) => (attendanceN[i] ? round1(v / attendanceN[i]) : null)) },
      ] }) },
    { id: 'retention', caption: 'Players first seen in this period: came back on another day vs only once',
      render: () => charts.doughnut({ title: 'New player retention', slices: [
        { label: 'Returning', value: ret?.returned ?? 0, color: charts.SERIES[0] },
        { label: 'One-time', value: ret?.onetime ?? 0, color: charts.SERIES[1] },
      ] }) },
    { id: 'growth', caption: `New unique players and total joins per ${unit}`,
      render: () => charts.line({ title: 'Growth', labels: b.labels, yLabel: 'Players', series: [
        { label: 'New players', data: newPlayers },
        { label: 'Total joins', data: joins },
      ] }) },
    { id: 'frequency', caption: `Mod calls, bans and kicks per ${unit}`,
      render: () => charts.line({ title: 'Moderation frequency', labels: b.labels, yLabel: 'Count', series: [
        { label: 'Mod calls', data: modCalls },
        { label: 'Bans', data: bans },
        { label: 'Kicks', data: kicks },
      ] }) },
  ];

  const { embed, files } = brand({ guild });
  const retTotal = (ret?.returned ?? 0) + (ret?.onetime ?? 0);
  embed.setTitle(`📊 Server Analysis — last ${days} days`).addFields(
    { name: 'Best time to host', value: best.v >= 0 ? `**${DAY_LABELS[best.d]} ${String(best.h).padStart(2, '0')}:00** (avg ${round1(best.v)} players)` : 'Not enough data', inline: false },
    { name: 'Avg players', value: `Overall **${avgOverall ?? '—'}**\nSessions **${avgSession ?? '—'}**\nOff-peak **${avgOff ?? '—'}**`, inline: true },
    { name: 'Capacity', value: `Queue in **${queueHours}** hrs\nFull in **${fullHours}** hrs\nMax **${capacity || '—'}**`, inline: true },
    { name: 'Sessions', value: `**${sessions.length}** hosted\nAvg length **${avgDuration ? formatDuration(avgDuration) : '—'}**\nAvg time-to-fill **${avgFill ? formatDuration(avgFill) : '—'}** (${filled.length} filled)`, inline: true },
    { name: 'Retention', value: retTotal ? `**${Math.round((ret.returned / retTotal) * 100)}%** of ${retTotal} new players returned` : 'No new players yet', inline: true },
    { name: 'Totals', value: `Mod calls **${sum1(modCalls)}** · Bans **${sum1(bans)}** · Kicks **${sum1(kicks)}**`, inline: false },
  );
  const charted = await renderAll(jobs);
  if (charted.failed.length) embed.setFooter({ text: `Some charts could not be drawn: ${charted.failed.join('; ')}` });
  return { embeds: [embed, ...charted.embeds], files: [...files, ...charted.files] };
}

const sum1 = (arr) => arr.reduce((a, v) => a + v, 0);

// ======================= STAFF =======================
async function staffAnalysis(guild, days) {
  const since = now() - days * 86400;
  const b = buckets(since, Math.max(days, 32)); // staff trends read best weekly
  const report = await quota.buildReport(guild, 0);
  const name = (id) => guild.members.cache.get(id)?.displayName ?? `Unknown (${id})`;

  // Active vs inactive (this quota week).
  const counts = { met: 0, below: 0, loa: 0 };
  for (const r of report.rows) {
    if (r.status.key === 'exempt') continue; // no quota (e.g. Senior High Rank)
    if (r.status.key === 'met') counts.met += 1;
    else if (r.status.key === 'loa') counts.loa += 1;
    else counts.below += 1;
  }

  // Duty-hours leaderboard (period).
  const secs = quota.secondsByMember(since, now() + 1);
  const leaderboard = Object.entries(secs).sort((a, b2) => b2[1] - a[1]).slice(0, 15);

  // Sessions hosted.
  const hosted = all('SELECT host_id, COUNT(*) AS n FROM sessions WHERE started_at >= ? GROUP BY host_id ORDER BY n DESC LIMIT 15', since);

  // Mod call response time (only calls we saw unanswered first, so the timing is real).
  const calls = all(`SELECT moderator_id, moderator, AVG(answered_seen_at - ts) AS avg_s, COUNT(*) AS n FROM mod_calls
    WHERE ts >= ? AND seen_unanswered = 1 AND answered_seen_at IS NOT NULL AND moderator_id IS NOT NULL
    GROUP BY moderator_id ORDER BY avg_s ASC LIMIT 15`, since);
  const callLines = [];
  for (const c of calls) {
    const d = await robloxToDiscord(c.moderator_id);
    const who = d && d !== UNKNOWN ? `<@${d}>` : c.moderator;
    callLines.push(`${who} — **${formatDuration(c.avg_s)}** avg (${c.n} calls)`);
  }

  // Infractions issued.
  const infr = all(`SELECT COALESCE(issuer_id, issuer_name) AS who, issuer_id, COUNT(*) AS n FROM infractions
    WHERE ts >= ? GROUP BY who ORDER BY n DESC LIMIT 15`, since);
  const infrLines = infr.map((r) => `${r.issuer_id ? `<@${r.issuer_id}>` : r.who ?? 'Unknown'} — **${r.n}**`);

  // No-shows on scheduled sessions.
  const sched = all("SELECT host_id, status FROM scheduled_sessions WHERE scheduled_for >= ? AND status IN ('started','no_show')", since);
  const perHost = {};
  for (const s of sched) {
    perHost[s.host_id] ??= { total: 0, miss: 0 };
    perHost[s.host_id].total += 1;
    if (s.status === 'no_show') perHost[s.host_id].miss += 1;
  }
  const missTotal = sched.filter((s) => s.status === 'no_show').length;
  const noShowLines = Object.entries(perHost).filter(([, v]) => v.miss).sort((a, c) => c[1].miss - a[1].miss).slice(0, 10)
    .map(([id, v]) => `<@${id}> — ${v.miss}/${v.total} (${Math.round((v.miss / v.total) * 100)}%)`);

  // Quota completion % (this week).
  const quotaRows = report.rows.filter((r) => r.status.key !== 'loa' && r.status.key !== 'exempt').slice(0, 40);

  // Activity trend + turnover.
  const shiftRows = all('SELECT ended_at AS ts, duration_s, discord_id FROM shifts WHERE ended_at >= ?', since);
  const hoursTrend = b.zeros();
  const activeSets = b.keys.map(() => new Set());
  for (const s of shiftRows) {
    const i = b.index.get(b.keyOf(s.ts));
    if (i != null) { hoursTrend[i] += s.duration_s / 3600; activeSets[i].add(s.discord_id); }
  }
  const events = all('SELECT kind, ts FROM staff_events WHERE ts >= ?', since);
  const promotions = countInto(b, events.filter((e) => e.kind === 'promotion'));
  const resignations = countInto(b, events.filter((e) => e.kind === 'resignation'));
  const avgActive = activeSets.length ? round1(activeSets.reduce((a, s) => a + s.size, 0) / activeSets.length) : 0;

  const jobs = [
    { id: 'active', caption: 'This quota week: staff who met quota vs below vs on LOA',
      render: () => charts.doughnut({ title: 'Active vs inactive staff (this week)', slices: [
        { label: 'Met quota', value: counts.met, color: charts.SERIES[2] },
        { label: 'Below quota', value: counts.below, color: charts.SERIES[1] },
        { label: 'On LOA', value: counts.loa, color: charts.SERIES[0] },
      ] }) },
    { id: 'duty-hours', caption: `Top 15 duty hours (Vex shifts), last ${days} days`,
      render: () => charts.bar({ title: 'Duty hours leaderboard', horizontal: true, labels: leaderboard.map(([id]) => name(id)), yLabel: 'Hours',
        series: [{ label: 'Hours', data: leaderboard.map(([, s]) => round1(s / 3600)) }] }) },
    { id: 'hosted', caption: `Sessions hosted per staff member, last ${days} days`,
      render: () => charts.bar({ title: 'Sessions hosted', labels: hosted.map((h) => name(h.host_id)), yLabel: 'Sessions',
        series: [{ label: 'Sessions', data: hosted.map((h) => h.n) }] }) },
    { id: 'quota', caption: 'Quota completion this week (hours ÷ tier quota); dashed line = 100%',
      render: () => charts.bar({ title: 'Quota completion (this week)', labels: quotaRows.map((r) => r.member.displayName), yLabel: '% of quota',
        reference: { label: 'Quota (100%)', value: 100 },
        series: [{ label: '% of quota', data: quotaRows.map((r) => Math.round((r.hours / (r.tier.weeklyHours || 1)) * 100)) }] }) },
    { id: 'trend', caption: 'Total staff duty hours per week',
      render: () => charts.line({ title: 'Staff activity trend', labels: b.labels, yLabel: 'Duty hours',
        series: [{ label: 'Duty hours', data: hoursTrend.map(round1) }] }) },
    { id: 'turnover', caption: 'Promotions and resignations per week (from Utility Bot channels)',
      render: () => charts.bar({ title: 'Turnover', labels: b.labels, yLabel: 'Count', series: [
        { label: 'Promotions', data: promotions },
        { label: 'Resignations', data: resignations },
      ] }) },
  ];

  const { embed, files } = brand({ guild });
  const orNone = (lines) => (lines.length ? lines.join('\n').slice(0, 1024) : 'No data yet');
  embed.setTitle(`👮 Staff Analysis — last ${days} days`).addFields(
    { name: 'This week', value: `✅ **${counts.met}** met · ⚠️ **${counts.below}** below · 💤 **${counts.loa}** LOA`, inline: false },
    { name: 'Avg active staff / week', value: `**${avgActive}**`, inline: true },
    { name: 'Turnover', value: `⬆️ **${sum1(promotions)}** promotions · 🚪 **${sum1(resignations)}** resignations`, inline: true },
    { name: 'Session no-show rate', value: sched.length ? `**${Math.round((missTotal / sched.length) * 100)}%** (${missTotal}/${sched.length} scheduled)` : 'No scheduled sessions', inline: true },
    { name: 'Mod call response time (fastest first)', value: orNone(callLines), inline: false },
    { name: 'Infractions issued', value: orNone(infrLines), inline: true },
    { name: 'No-shows by host', value: orNone(noShowLines), inline: true },
  );
  const charted = await renderAll(jobs);
  if (charted.failed.length) embed.setFooter({ text: `Some charts could not be drawn: ${charted.failed.join('; ')}` });
  return { embeds: [embed, ...charted.embeds], files: [...files, ...charted.files] };
}

module.exports = { serverAnalysis, staffAnalysis };
