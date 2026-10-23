// Polls the ER:LC API on an interval and drives everything automatic:
// history for analytics, mod call tracking, in-game ':log' commands,
// the high-activity alert, and scheduled-session reminders / no-shows.
const erlc = require('../lib/erlc');
const { run, get, all, transaction, kvGet, kvSet, now } = require('../lib/db');
const { config } = require('../lib/config');
const { fetchChannel } = require('../lib/guildConfig');
const { plain, ts } = require('../lib/embeds');
const { activeSession } = require('../lib/sessions');
const { highActivityMessage } = require('../lib/alerts');
const { sendAndReplace } = require('../lib/sessionPost');
const { dayKey } = require('../lib/time');
const { robloxToDiscord, UNKNOWN } = require('../lib/bloxlink');
const announcements = require('../lib/announcements');
const panels = require('./panels');
const inGameRole = require('./inGameRole');

const FLAGS = ['Players', 'Queue', 'JoinLogs', 'CommandLogs', 'ModCalls'];
const bootTs = now();
let client;
let timer;
let lastError = null;
let lastServerPayload = null;

function start(discordClient) {
  client = discordClient;
  announcements.seedOnce();
  // Cursors: only act on log entries newer than these (first run starts "now", so old backlog isn't replayed).
  const loop = async () => {
    try {
      await tick();
      if (lastServerPayload) {
        panels.onServerData(lastServerPayload);
        inGameRole.update(lastServerPayload).catch((e) => console.warn('[in-game role]', e.message));
        require('./discordReminder').check(client, lastServerPayload).catch((e) => console.warn('[discord reminder]', e.message));
      }
      if (lastError) console.log('[poller] recovered');
      lastError = null;
    } catch (err) {
      if (lastError !== err.message) console.warn('[poller]', err.message);
      lastError = err.message;
      panels.onServerError();
    }
    timer = setTimeout(loop, config.settings.pollIntervalSeconds * 1000);
  };
  loop();
}

const stop = () => clearTimeout(timer);

async function tick() {
  await handleSchedules(); // runs even if the game server is offline

  const server = await erlc.getServer(FLAGS);
  lastServerPayload = server;
  const t = now();
  const players = server.Players ?? [];
  const queueLen = Array.isArray(server.Queue) ? server.Queue.length : 0;
  const staffOnline = players.filter((p) => p.Permission && p.Permission !== 'Normal').length;
  const session = activeSession();

  transaction(() => {
    recordSnapshot(t, server, players.length, queueLen, staffOnline, session);
    recordPlayers(t, players, session);
    for (const j of server.JoinLogs ?? []) {
      const p = erlc.parsePlayer(j.Player);
      if (p.id) run('INSERT OR IGNORE INTO join_logs(ts, roblox_id, name, is_join) VALUES(?, ?, ?, ?)', j.Timestamp, p.id, p.name, j.Join ? 1 : 0);
    }
    recordModCalls(t, server.ModCalls ?? []);
  });

  await handleCommands(server.CommandLogs ?? [], players);
  await handleHighActivity(server);
  pruneDaily();
}

function recordSnapshot(t, server, count, queueLen, staffOnline, session) {
  run('INSERT INTO snapshots(ts, players, max_players, queue, staff, session_id) VALUES(?, ?, ?, ?, ?, ?)',
    t, count, server.MaxPlayers ?? 0, queueLen, staffOnline, session?.id ?? null);
  const hour = t - (t % 3600);
  run(`INSERT INTO hourly_stats(hour_ts, samples, sum_players, max_players, max_queue, capacity, session_samples, session_sum_players)
       VALUES(?, 1, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(hour_ts) DO UPDATE SET
         samples = samples + 1,
         sum_players = sum_players + excluded.sum_players,
         max_players = MAX(max_players, excluded.max_players),
         max_queue = MAX(max_queue, excluded.max_queue),
         capacity = MAX(capacity, excluded.capacity),
         session_samples = session_samples + excluded.session_samples,
         session_sum_players = session_sum_players + excluded.session_sum_players`,
  hour, count, count, queueLen, server.MaxPlayers ?? 0, session ? 1 : 0, session ? count : 0);

  if (session) {
    run('UPDATE sessions SET peak_players = MAX(peak_players, ?) WHERE id = ?', count, session.id);
    const fillAt = Math.ceil((server.MaxPlayers ?? 0) * config.settings.sessionFillPercent / 100);
    if (!session.filled_at && fillAt > 0 && count >= fillAt) run('UPDATE sessions SET filled_at = ? WHERE id = ?', t, session.id);
  }
}

function recordPlayers(t, players, session) {
  const day = dayKey(t);
  for (const p of players) {
    const { name, id } = erlc.parsePlayer(p.Player);
    if (!id) continue;
    run(`INSERT INTO players(roblox_id, name, first_seen, last_seen) VALUES(?, ?, ?, ?)
         ON CONFLICT(roblox_id) DO UPDATE SET name = excluded.name, last_seen = excluded.last_seen`, id, name, t, t);
    run('INSERT OR IGNORE INTO player_days(roblox_id, day) VALUES(?, ?)', id, day);
    if (session) run('INSERT OR IGNORE INTO session_players(session_id, roblox_id) VALUES(?, ?)', session.id, id);
  }
}

function recordModCalls(t, calls) {
  for (const c of calls) {
    const caller = erlc.parsePlayer(c.Caller);
    const mod = erlc.parsePlayer(c.Moderator);
    const existing = get('SELECT id, moderator_id FROM mod_calls WHERE ts = ? AND caller_id IS ?', c.Timestamp, caller.id);
    if (!existing) {
      run(`INSERT INTO mod_calls(ts, caller, caller_id, moderator, moderator_id, first_seen, seen_unanswered, answered_seen_at)
           VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
      c.Timestamp, caller.name, caller.id, mod.name, mod.id, t, mod.name ? 0 : 1, mod.name ? t : null);
    } else if (!existing.moderator_id && mod.name) {
      run('UPDATE mod_calls SET moderator = ?, moderator_id = ?, answered_seen_at = ? WHERE id = ?', mod.name, mod.id, t, existing.id);
    }
  }
}

// ---------- in-game ':log' commands ----------
async function handleCommands(commands, players) {
  // Never replay commands older than a minute before boot (e.g. after downtime).
  const cursor = Math.max(kvGet('cursor_commands', 0), bootTs - 60);
  const fresh = [];
  for (const c of commands) {
    const p = erlc.parsePlayer(c.Player);
    // Remote commands (Vex, this bot) have no player id - use 0, since NULL never counts as a duplicate.
    const res = run('INSERT OR IGNORE INTO command_logs(ts, player, player_id, command) VALUES(?, ?, ?, ?)', c.Timestamp, p.name, p.id ?? 0, c.Command);
    if (res.changes && c.Timestamp > cursor) fresh.push({ ts: c.Timestamp, staff: p, command: String(c.Command).trim() });
  }
  if (!fresh.length) return;
  fresh.sort((a, b) => a.ts - b.ts);
  kvSet('cursor_commands', fresh[fresh.length - 1].ts);

  for (const c of fresh) {
    const announce = c.command.match(/^:log\s+announce\s+(\S+)/i);
    if (announce) await handleAnnounce(c, announce[1].toLowerCase());
    // ':log dc' and ':log dcheck' both work (the staff manual uses dcheck).
    const dc = c.command.match(/^:log\s+dc(?:heck)?\s+(\S+)\s+(yes|no|y|n)\b/i);
    if (dc) await handleDcCheck(c, dc[1], /^y/i.test(dc[2]), players);
  }
}

// DMs the staff member (via their Bloxlink-linked Discord account). Silent if not linked / DMs closed.
async function dmStaff(robloxId, text) {
  const discordId = await robloxToDiscord(robloxId);
  if (!discordId || discordId === UNKNOWN) return;
  const user = await client.users.fetch(discordId).catch(() => null);
  await user?.send(text).catch(() => {});
}

// In-game private message to the staff member.
async function pmStaff(staff, text) {
  try {
    await erlc.runCommand(`:pm ${staff.name} ${text}`);
  } catch (err) {
    console.warn('[pm]', err.message);
  }
}

async function handleAnnounce(c, keyword) {
  const entry = announcements.find(keyword);
  if (!entry) {
    const close = announcements.search(keyword.slice(0, 3)).slice(0, 5).map((a) => a.keyword);
    await pmStaff(c.staff, `Unknown announcement "${keyword}".${close.length ? ` Did you mean: ${close.join(', ')}?` : ''} Full list: /announcement list in Discord.`);
    return;
  }
  try {
    await erlc.runCommand(`:${entry.type === 'm' ? 'm' : 'h'} ${entry.message}`);
  } catch (err) {
    console.warn('[announce]', err.message);
    await dmStaff(c.staff.id, `❌ Your in-game announcement **${entry.keyword}** couldn't be sent: ${err.message}`);
  }
}

async function handleDcCheck(c, targetName, joined, players) {
  // Resolve the exact username: players in-game right now first, then anyone we've seen before.
  const inGame = players.map((p) => erlc.parsePlayer(p.Player)).find((p) => p.name?.toLowerCase() === targetName.toLowerCase());
  const known = inGame ?? get('SELECT roblox_id AS id, name FROM players WHERE name = ? COLLATE NOCASE ORDER BY last_seen DESC LIMIT 1', targetName);
  if (!known?.id) {
    await pmStaff(c.staff, `DC check failed: no player named "${targetName}" found. Check the exact username.`);
    await dmStaff(c.staff.id, `⚠️ DC check not logged: no player named **${targetName}** was found. Usernames must be exact.`);
    return;
  }
  run(`INSERT INTO dc_status(roblox_id, name, status, checked_by, checked_at) VALUES(?, ?, ?, ?, ?)
       ON CONFLICT(roblox_id) DO UPDATE SET name = excluded.name, status = excluded.status, checked_by = excluded.checked_by, checked_at = excluded.checked_at`,
  known.id, known.name, joined ? 'confirmed' : 'not_joined', c.staff.name, c.ts);

  const staffDiscord = await robloxToDiscord(c.staff.id);
  const linked = staffDiscord && staffDiscord !== UNKNOWN;
  const channel = await fetchChannel(client, 'dc_logs');
  if (channel) {
    const by = linked ? `<@${staffDiscord}> (${c.staff.name})` : c.staff.name;
    const embed = plain()
      .setTitle('📋 Discord Check')
      .addFields(
        { name: 'Player', value: `**${known.name}** \`${known.id}\``, inline: true },
        { name: 'Result', value: joined ? '✅ Joined the Discord' : '❌ Did not join', inline: true },
        { name: 'Checked by', value: by, inline: true },
        { name: 'Not in Discord list', value: joined ? 'Removed from the list.' : 'Stays on the list.' },
      )
      .setTimestamp(c.ts * 1000);
    await channel.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch((e) => console.warn('[dc log]', e.message));
  }

  // Confirm to the staff member: in-game PM + Discord DM.
  const result = joined ? 'joined the Discord' : 'has not joined the Discord';
  await pmStaff(c.staff, 'Logged successfully.');
  if (linked) {
    const user = await client.users.fetch(staffDiscord).catch(() => null);
    const extra = joined ? ' They have been removed from the Not in Discord list.' : '';
    await user?.send(`✅ Successfully logged the DC check for **${known.name}**: ${result}.${extra}`).catch(() => {});
  }
}

// ---------- automatic high-activity / server-full alert ----------
async function handleHighActivity(server) {
  const cfg = config.settings.highActivityAlert;
  if (!cfg?.enabled || !server.MaxPlayers) return;
  const pct = (server.CurrentPlayers / server.MaxPlayers) * 100;
  const state = kvGet('high_activity', { armed: true, lastAt: 0, lastFull: false });

  if (pct < cfg.rearmBelowPercent && !state.armed) {
    kvSet('high_activity', { ...state, armed: true, lastFull: false });
    return;
  }
  const full = server.CurrentPlayers >= server.MaxPlayers;
  const cooledDown = now() - state.lastAt >= cfg.cooldownMinutes * 60;
  // Fire on crossing the near-full line, and once more if it then actually fills up.
  const shouldPost = pct >= cfg.nearFullPercent && cooledDown && (state.armed || (full && !state.lastFull));
  if (!shouldPost) return;

  const channel = await fetchChannel(client, 'sessions');
  if (!channel) return;
  await sendAndReplace(channel, highActivityMessage(channel.guild, server)).catch((e) => console.warn('[high activity]', e.message));
  kvSet('high_activity', { armed: false, lastAt: now(), lastFull: full });
}

// ---------- scheduled sessions: start reminder + no-show ----------
async function handleSchedules() {
  const t = now();
  const due = all("SELECT * FROM scheduled_sessions WHERE status = 'scheduled' AND reminded = 0 AND scheduled_for <= ?", t);
  for (const s of due) {
    run('UPDATE scheduled_sessions SET reminded = 1 WHERE id = ?', s.id);
    const user = await client.users.fetch(s.host_id).catch(() => null);
    await user?.send(`⏰ Your scheduled LACRP session (${ts(s.scheduled_for, 'f')}) is due now. Run \`/session-start\` when you're ready.`).catch(() => {});
  }
  const grace = config.settings.noShowGraceMinutes * 60;
  run("UPDATE scheduled_sessions SET status = 'no_show' WHERE status = 'scheduled' AND scheduled_for + ? < ?", grace, t);
}

function pruneDaily() {
  const today = new Date().toISOString().slice(0, 10);
  if (kvGet('last_prune') === today) return;
  kvSet('last_prune', today);
  const cutoff = now() - config.settings.rawSnapshotRetentionDays * 86400;
  run('DELETE FROM snapshots WHERE ts < ? AND session_id IS NULL', cutoff);
}

module.exports = { start, stop, tick };
