// ':log announce <keyword>' messages. Stored in the DB so the owner can manage them with /announcement.
// config/announcements.json is only the starting list, copied in on first run.
const { run, get, all, kvGet, kvSet, now } = require('./db');
const { config } = require('./config');

const KEYWORD_RE = /^[a-z0-9_-]{1,32}$/;
const MAX_MESSAGE = 250;

function seedOnce() {
  if (kvGet('announcements_seeded')) return;
  for (const [keyword, a] of Object.entries(config.announcements.announcements ?? {})) {
    run('INSERT OR IGNORE INTO announcements(keyword, type, message, label, updated_at) VALUES(?, ?, ?, ?, ?)',
      keyword.toLowerCase(), a.type === 'm' ? 'm' : 'h', a.message, a.label ?? null, now());
  }
  kvSet('announcements_seeded', true);
}

const normalize = (k) => String(k ?? '').trim().toLowerCase();
const find = (keyword) => get('SELECT * FROM announcements WHERE keyword = ?', normalize(keyword));
const list = () => all('SELECT * FROM announcements ORDER BY keyword');
const search = (q) => all('SELECT keyword, label FROM announcements WHERE keyword LIKE ? OR label LIKE ? ORDER BY keyword LIMIT 25', `%${q}%`, `%${q}%`);

function add({ keyword, message, type = 'h', label = null, by }) {
  run('INSERT INTO announcements(keyword, type, message, label, updated_by, updated_at) VALUES(?, ?, ?, ?, ?, ?)',
    normalize(keyword), type, message, label, by, now());
}

// changes: { newKeyword?, message?, type?, label? }
function edit(keyword, changes, by) {
  const cur = find(keyword);
  if (!cur) return null;
  const next = {
    keyword: changes.newKeyword ? normalize(changes.newKeyword) : cur.keyword,
    message: changes.message ?? cur.message,
    type: changes.type ?? cur.type,
    label: changes.label ?? cur.label,
  };
  run('UPDATE announcements SET keyword = ?, message = ?, type = ?, label = ?, updated_by = ?, updated_at = ? WHERE keyword = ?',
    next.keyword, next.message, next.type, next.label, by, now(), cur.keyword);
  return find(next.keyword);
}

const remove = (keyword) => run('DELETE FROM announcements WHERE keyword = ?', normalize(keyword)).changes > 0;

module.exports = { seedOnce, find, list, search, add, edit, remove, normalize, KEYWORD_RE, MAX_MESSAGE };
