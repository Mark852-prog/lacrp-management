// Removes emojis/stickers listed in data/media-cleanup.json ({ emojis: [names], stickers: [names] }).
// Only items the bot uploaded itself are deleted; their files in assets/media are removed too so the
// media import doesn't upload them again. Result: data/media-cleanup-result.txt.
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const JOB = path.join(ROOT, 'data', 'media-cleanup.json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function runJob(client) {
  if (!fs.existsSync(JOB)) return;
  const job = JSON.parse(fs.readFileSync(JOB, 'utf8'));
  // Files first, so the media import can't re-upload them.
  for (const [dir, names] of [['emojis', job.emojis ?? []], ['stickers', job.stickers ?? []]]) {
    for (const n of names) for (const ext of ['png', 'gif']) fs.rmSync(path.join(ROOT, 'assets', 'media', dir, `${n}.${ext}`), { force: true });
  }
  const guild = await client.guilds.fetch(process.env.GUILD_ID);
  const me = client.user.id;
  const lines = [];
  const emojis = await guild.emojis.fetch();
  for (const name of job.emojis ?? []) {
    const e = emojis.find((x) => x.name === name);
    if (!e) { lines.push(`SKIPPED emoji ${name}: not found`); continue; }
    const author = await e.fetchAuthor().catch(() => null);
    if (author?.id !== me) { lines.push(`SKIPPED emoji ${name}: not uploaded by the bot`); continue; }
    try { await e.delete('Replaced with better emojis (owner request)'); lines.push(`OK  emoji ${name} deleted`); } catch (err) { lines.push(`FAILED emoji ${name}: ${err.message}`); }
    await sleep(1200);
  }
  const stickers = await guild.stickers.fetch();
  for (const name of job.stickers ?? []) {
    const s = stickers.find((x) => x.name === name);
    if (!s) { lines.push(`SKIPPED sticker ${name}: not found`); continue; }
    const user = await s.fetchUser().catch(() => null);
    if (user?.id !== me) { lines.push(`SKIPPED sticker ${name}: not uploaded by the bot`); continue; }
    try { await s.delete('Replaced with better stickers (owner request)'); lines.push(`OK  sticker ${name} deleted`); } catch (err) { lines.push(`FAILED sticker ${name}: ${err.message}`); }
    await sleep(1200);
  }
  fs.rmSync(JOB, { force: true });
  fs.writeFileSync(path.join(ROOT, 'data', 'media-cleanup-result.txt'), lines.join('\n'));
  console.log(`[media cleanup] done - ${lines.filter((l) => l.startsWith('OK')).length} deleted`);
}

module.exports = { runJob };
