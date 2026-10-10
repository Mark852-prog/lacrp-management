// The bot's own (application) emojis: uploaded to the bot itself, usable in every server and not
// counted against the server's emoji slots. Every assets/emojis/dept_*.png is uploaded once under
// its file name; texts use them as :dept_lapd: like any server emoji (src/lib/emojis.js).
const fs = require('node:fs');
const path = require('node:path');

const DIR = path.join(__dirname, '..', '..', 'assets', 'emojis');
const PREFIX = 'dept_';

async function ensure(client) {
  const existing = await client.application.emojis.fetch();
  const names = new Set(existing.map((e) => e.name));
  const files = fs.readdirSync(DIR).filter((f) => f.startsWith(PREFIX) && f.endsWith('.png'));
  for (const f of files) {
    const name = f.replace(/\.png$/, '');
    if (names.has(name)) continue;
    try {
      const emoji = await client.application.emojis.create({ attachment: fs.readFileSync(path.join(DIR, f)), name });
      console.log(`[app emojis] uploaded :${emoji.name}: (${emoji.id})`);
    } catch (err) {
      console.warn(`[app emojis] ${name} failed:`, err.message);
    }
  }
}

module.exports = { ensure };
