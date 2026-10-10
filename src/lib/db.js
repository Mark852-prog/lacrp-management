// SQLite storage using Node's built-in node:sqlite (no native modules to compile on the host).
// All timestamps are unix seconds (UTC).
//
// Long-range analytics read from compact rollup tables (hourly_stats, player_days, shifts,
// sessions...) so months of history stay fast. Raw per-poll snapshots are pruned after
// settings.rawSnapshotRetentionDays.
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const dbPath = path.resolve(process.env.DATABASE_PATH || path.join(__dirname, '..', '..', 'data', 'lacrp.db'));
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new DatabaseSync(dbPath);
db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS guild_config (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS kv (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- One row per poll. Pruned after rawSnapshotRetentionDays.
CREATE TABLE IF NOT EXISTS snapshots (
  ts          INTEGER NOT NULL,
  players     INTEGER NOT NULL,
  max_players INTEGER NOT NULL,
  queue       INTEGER NOT NULL,
  staff       INTEGER NOT NULL,
  session_id  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_snapshots_ts ON snapshots(ts);

-- Hourly rollup of snapshots (kept forever, ~8.8k rows/year).
CREATE TABLE IF NOT EXISTS hourly_stats (
  hour_ts              INTEGER PRIMARY KEY,
  samples              INTEGER NOT NULL DEFAULT 0,
  sum_players          INTEGER NOT NULL DEFAULT 0,
  max_players          INTEGER NOT NULL DEFAULT 0,
  max_queue            INTEGER NOT NULL DEFAULT 0,
  capacity             INTEGER NOT NULL DEFAULT 0,
  session_samples      INTEGER NOT NULL DEFAULT 0,
  session_sum_players  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS players (
  roblox_id  INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  first_seen INTEGER NOT NULL,
  last_seen  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_players_name ON players(name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_players_first ON players(first_seen);

-- Distinct days each player was seen (for retention).
CREATE TABLE IF NOT EXISTS player_days (
  roblox_id INTEGER NOT NULL,
  day       TEXT NOT NULL,
  PRIMARY KEY (roblox_id, day)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS join_logs (
  ts        INTEGER NOT NULL,
  roblox_id INTEGER NOT NULL,
  name      TEXT,
  is_join   INTEGER NOT NULL,
  UNIQUE (ts, roblox_id, is_join)
);
CREATE INDEX IF NOT EXISTS idx_join_logs_ts ON join_logs(ts);

CREATE TABLE IF NOT EXISTS kill_logs (
  ts        INTEGER NOT NULL,
  killer    TEXT,
  killer_id INTEGER,
  killed    TEXT,
  killed_id INTEGER,
  UNIQUE (ts, killer_id, killed_id)
);
CREATE INDEX IF NOT EXISTS idx_kill_logs_ts ON kill_logs(ts);

CREATE TABLE IF NOT EXISTS command_logs (
  ts        INTEGER NOT NULL,
  player    TEXT,
  player_id INTEGER,
  command   TEXT NOT NULL,
  UNIQUE (ts, player_id, command)
);
CREATE INDEX IF NOT EXISTS idx_command_logs_ts ON command_logs(ts);
CREATE INDEX IF NOT EXISTS idx_command_logs_player ON command_logs(player_id, ts);

CREATE TABLE IF NOT EXISTS mod_calls (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  ts               INTEGER NOT NULL,
  caller           TEXT,
  caller_id        INTEGER,
  moderator        TEXT,
  moderator_id     INTEGER,
  first_seen       INTEGER NOT NULL,
  seen_unanswered  INTEGER NOT NULL DEFAULT 0,
  answered_seen_at INTEGER,
  resolved_by      TEXT,
  resolved_at      INTEGER,
  UNIQUE (ts, caller_id)
);
CREATE INDEX IF NOT EXISTS idx_mod_calls_ts ON mod_calls(ts);

CREATE TABLE IF NOT EXISTS sessions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  host_id        TEXT NOT NULL,
  started_at     INTEGER NOT NULL,
  ended_at       INTEGER,
  ended_by       TEXT,
  peak_players   INTEGER NOT NULL DEFAULT 0,
  filled_at      INTEGER,
  scheduled_id   INTEGER,
  channel_id     TEXT,
  message_id     TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions(started_at);

CREATE TABLE IF NOT EXISTS session_players (
  session_id INTEGER NOT NULL,
  roblox_id  INTEGER NOT NULL,
  PRIMARY KEY (session_id, roblox_id)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS scheduled_sessions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  host_id       TEXT NOT NULL,
  scheduled_for INTEGER NOT NULL,
  created_at    INTEGER NOT NULL,
  note          TEXT,
  status        TEXT NOT NULL DEFAULT 'scheduled', -- scheduled | started | no_show | cancelled
  session_id    INTEGER,
  reminded      INTEGER NOT NULL DEFAULT 0,
  channel_id    TEXT,
  message_id    TEXT
);
CREATE INDEX IF NOT EXISTS idx_sched_for ON scheduled_sessions(scheduled_for);

CREATE TABLE IF NOT EXISTS staff_requests (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  type         TEXT NOT NULL,
  requester_id TEXT NOT NULL,
  details      TEXT,
  status       TEXT NOT NULL DEFAULT 'pending', -- pending | approved | denied
  handled_by   TEXT,
  handled_at   INTEGER,
  reason       TEXT,
  created_at   INTEGER NOT NULL,
  channel_id   TEXT,
  message_id   TEXT
);

-- Votes for /session-vote and /session-poll.
CREATE TABLE IF NOT EXISTS polls (
  message_id TEXT PRIMARY KEY,
  kind       TEXT NOT NULL,          -- vote | poll
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  needed     INTEGER,
  options    TEXT,                   -- JSON array for polls
  question   TEXT,
  closed     INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS poll_votes (
  message_id TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  option     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (message_id, user_id)
) WITHOUT ROWID;

-- Parsed from Vex "Shift Ended" embeds.
CREATE TABLE IF NOT EXISTS shifts (
  message_id  TEXT PRIMARY KEY,
  discord_id  TEXT NOT NULL,
  shift_type  TEXT,
  started_at  INTEGER NOT NULL,
  ended_at    INTEGER NOT NULL,
  duration_s  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_shifts_ended ON shifts(ended_at);
CREATE INDEX IF NOT EXISTS idx_shifts_member ON shifts(discord_id, ended_at);

-- Parsed from Utility Bot infraction notices.
CREATE TABLE IF NOT EXISTS infractions (
  message_id  TEXT PRIMARY KEY,
  target_id   TEXT,
  issuer_name TEXT,
  issuer_id   TEXT,
  punishment  TEXT,
  reason      TEXT,
  ts          INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_infractions_ts ON infractions(ts);

-- Parsed from Utility Bot promotion / resignation channels.
CREATE TABLE IF NOT EXISTS staff_events (
  message_id TEXT PRIMARY KEY,
  kind       TEXT NOT NULL, -- promotion | resignation
  discord_id TEXT,
  role_id    TEXT,          -- rank promoted to / resigned from
  ts         INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_staff_events_ts ON staff_events(ts);

-- Utility Bot "... Logged" embeds in IA members' logs (IA cases handled).
CREATE TABLE IF NOT EXISTS ia_logs (
  message_id   TEXT PRIMARY KEY,
  ia_member_id TEXT,          -- IA member credited (who ran the log / owns the log channel)
  kind         TEXT,          -- e.g. "ban appeal", "infraction"
  subject_id   TEXT,          -- member the case was about
  ts           INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ia_logs_member ON ia_logs(ia_member_id, ts);

-- "Ban Request Submission" panels and who reviewed them (Trial Administrator quota).
CREATE TABLE IF NOT EXISTS ban_requests (
  message_id   TEXT PRIMARY KEY,  -- the panel message (its review thread has the same ID)
  target       TEXT,
  requested_by TEXT,
  submitted_at INTEGER NOT NULL,
  outcome      TEXT,              -- approved | denied | null while pending
  reviewer_id  TEXT,
  reviewed_at  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_ban_requests_reviewer ON ban_requests(reviewer_id, reviewed_at);

-- In-game ':log dc <user> yes|no' results.
CREATE TABLE IF NOT EXISTS dc_status (
  roblox_id  INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  status     TEXT NOT NULL, -- confirmed | not_joined
  checked_by TEXT,
  checked_at INTEGER NOT NULL
);

-- Roblox <-> Discord link cache (Bloxlink).
CREATE TABLE IF NOT EXISTS roblox_links (
  roblox_id  INTEGER PRIMARY KEY,
  discord_id TEXT,
  fetched_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS discord_links (
  discord_id TEXT PRIMARY KEY,
  roblox_id  INTEGER,
  fetched_at INTEGER NOT NULL
);

-- ':log announce <keyword>' messages, managed with /announcement (seeded from config/announcements.json once).
CREATE TABLE IF NOT EXISTS announcements (
  keyword    TEXT PRIMARY KEY,
  type       TEXT NOT NULL DEFAULT 'h', -- h = hint bar, m = full message
  message    TEXT NOT NULL,
  label      TEXT,
  updated_by TEXT,
  updated_at INTEGER
);

-- Custom embeds built with /embed or the web editor. data = JSON design, posts = JSON [{channelId, messageId}].
CREATE TABLE IF NOT EXISTS custom_embeds (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  data       TEXT NOT NULL,
  posts      TEXT NOT NULL DEFAULT '[]',
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS quota_overrides (
  tier_id      TEXT PRIMARY KEY,
  weekly_hours REAL NOT NULL
);
`);

const stmtCache = new Map();
function prep(sql) {
  let s = stmtCache.get(sql);
  if (!s) {
    s = db.prepare(sql);
    stmtCache.set(sql, s);
  }
  return s;
}

const run = (sql, ...params) => prep(sql).run(...params);
const get = (sql, ...params) => prep(sql).get(...params);
const all = (sql, ...params) => prep(sql).all(...params);

function transaction(fn) {
  db.exec('BEGIN');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function kvGet(key, fallback = null) {
  const row = get('SELECT value FROM kv WHERE key = ?', key);
  return row ? JSON.parse(row.value) : fallback;
}
function kvSet(key, value) {
  run('INSERT INTO kv(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, JSON.stringify(value));
}

const now = () => Math.floor(Date.now() / 1000);

module.exports = { db, run, get, all, transaction, kvGet, kvSet, now, dbPath };
