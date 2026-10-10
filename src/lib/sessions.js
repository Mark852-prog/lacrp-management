// Session bookkeeping shared by the session commands and the poller.
const { run, get, all, now } = require('./db');
const { config } = require('./config');

const activeSession = () => get('SELECT * FROM sessions WHERE ended_at IS NULL ORDER BY id DESC LIMIT 1');

function startSession(hostId) {
  const t = now();
  const grace = config.settings.noShowGraceMinutes * 60;
  // Link to this host's scheduled session if one is due around now.
  const sched = get(
    `SELECT id FROM scheduled_sessions WHERE host_id = ? AND status IN ('scheduled','no_show')
     AND scheduled_for BETWEEN ? AND ? ORDER BY ABS(scheduled_for - ?) LIMIT 1`,
    hostId, t - grace * 2, t + grace * 2, t,
  );
  const { lastInsertRowid } = run('INSERT INTO sessions(host_id, started_at, scheduled_id) VALUES(?, ?, ?)', hostId, t, sched?.id ?? null);
  const id = Number(lastInsertRowid);
  if (sched) run("UPDATE scheduled_sessions SET status = 'started', session_id = ? WHERE id = ?", id, sched.id);
  return get('SELECT * FROM sessions WHERE id = ?', id);
}

function endSession(id, endedBy) {
  run('UPDATE sessions SET ended_at = ?, ended_by = ? WHERE id = ?', now(), endedBy, id);
  return get('SELECT * FROM sessions WHERE id = ?', id);
}

function sessionStats(session) {
  const unique = get('SELECT COUNT(*) AS n FROM session_players WHERE session_id = ?', session.id).n;
  const avg = get('SELECT AVG(players) AS a FROM snapshots WHERE session_id = ?', session.id).a;
  return {
    uniquePlayers: unique,
    avgPlayers: avg ? Math.round(avg * 10) / 10 : 0,
    duration: (session.ended_at ?? now()) - session.started_at,
    timeToFill: session.filled_at ? session.filled_at - session.started_at : null,
  };
}

const upcomingScheduled = () =>
  all("SELECT * FROM scheduled_sessions WHERE status = 'scheduled' AND scheduled_for > ? ORDER BY scheduled_for LIMIT 5", now() - 3600);

module.exports = { activeSession, startSession, endSession, sessionStats, upcomingScheduled };
