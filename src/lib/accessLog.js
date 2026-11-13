// Table for the panel access log (kept out of db.js so it can't clash with other updates).
const { db } = require('./db');

db.exec(`CREATE TABLE IF NOT EXISTS embed_access (
  id INTEGER PRIMARY KEY AUTOINCREMENT, embed_id INTEGER, embed_name TEXT, item TEXT, file TEXT,
  user_id TEXT NOT NULL, user_tag TEXT, channel_id TEXT, at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_embed_access_user ON embed_access(user_id, at);`);
