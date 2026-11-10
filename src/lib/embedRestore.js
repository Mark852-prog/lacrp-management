// One-time restore of saved custom embeds from data/embed-restore.json (exported from an older database).
//
// Rules, so nothing already working gets damaged:
//  - Each embed keeps its ORIGINAL number. Buttons and menus on messages that were already posted use that
//    number (ce:<id>:...), so they work again as soon as the embed is back.
//  - An embed is skipped if one with the same number and name is already here (safe to run repeatedly).
//  - An embed that uses uploaded pictures waits until those files are in data/uploads. Restoring it earlier would
//    make the startup refresh redraw the live posted message without its pictures.
//  - The auto-made, never-posted "verification" starter is replaced by the restored one. Any other clash
//    (same name, or same number used by a different embed) is skipped and reported, never overwritten.
// When everything is restored the file is renamed to embed-restore.done.json.
const fs = require('node:fs');
const path = require('node:path');
const { run, get, dbPath } = require('./db');

const DIR = path.dirname(dbPath);
const FILE = path.join(DIR, 'embed-restore.json');
const UPLOADS = path.join(DIR, 'uploads');

const uploadsIn = (json) => [...new Set(json.match(/upload:[a-f0-9]{16}\.(?:png|jpe?g|gif|webp)/g) ?? [])].map((k) => k.slice(7));
const hasPosts = (row) => JSON.parse(row.posts || '[]').length > 0;

function restore() {
  if (!fs.existsSync(FILE)) return;
  let rows;
  try {
    rows = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    if (!Array.isArray(rows)) throw new Error('expected a list');
  } catch (err) {
    console.warn('[embed restore] could not read data/embed-restore.json:', err.message);
    return;
  }

  const restored = [];
  const waiting = [];
  const skipped = [];
  for (const r of rows) {
    const id = Number(r.id);
    const name = String(r.name ?? '').trim();
    if (!Number.isInteger(id) || id < 1 || !name || r.data == null) { skipped.push(`${name || '?'} (bad entry)`); continue; }
    const data = typeof r.data === 'string' ? r.data : JSON.stringify(r.data);
    const posts = JSON.stringify(Array.isArray(r.posts) ? r.posts : JSON.parse(r.posts || '[]'));

    const sameId = get('SELECT id, name FROM custom_embeds WHERE id = ?', id);
    if (sameId && sameId.name === name) { skipped.push(`${name} (already here)`); continue; }

    const missing = uploadsIn(data).filter((f) => !fs.existsSync(path.join(UPLOADS, f)));
    if (missing.length) { waiting.push(`${name} (needs ${missing.length} picture${missing.length === 1 ? '' : 's'} in data/uploads)`); continue; }

    const sameName = get('SELECT id, posts FROM custom_embeds WHERE name = ?', name);
    if (sameName && sameName.id !== id) {
      if (name.toLowerCase() === 'verification' && !hasPosts(sameName)) run('DELETE FROM custom_embeds WHERE id = ?', sameName.id);
      else { skipped.push(`${name} (another embed with this name exists)`); continue; }
    }
    if (get('SELECT 1 FROM custom_embeds WHERE id = ?', id)) { skipped.push(`${name} (number ${id} is used by "${sameId.name}")`); continue; }

    run('INSERT INTO custom_embeds(id, name, data, posts, updated_at) VALUES(?, ?, ?, ?, ?)', id, name, data, posts, Number(r.updated_at) || Math.floor(Date.now() / 1000));
    restored.push(name);
  }

  console.log(`[embed restore] restored ${restored.length}${restored.length ? `: ${restored.join(', ')}` : ''}`);
  if (skipped.length) console.log(`[embed restore] skipped: ${skipped.join('; ')}`);
  if (waiting.length) console.log(`[embed restore] waiting for pictures, will retry on next start: ${waiting.join('; ')}`);
  else fs.renameSync(FILE, path.join(DIR, 'embed-restore.done.json'));
}

module.exports = { restore };
