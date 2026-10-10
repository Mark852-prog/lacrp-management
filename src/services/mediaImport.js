// Uploads the extra server emojis and stickers in assets/media (Google Noto Animated Emoji, CC BY 4.0,
// and Microsoft Fluent Emoji, MIT). Triggered by data/media-job.json at startup; names that already
// exist are skipped, so the job can safely run again after a restart. Discord's upload limits are
// waited out. The result goes to data/media-result.txt and is DMed to the bot owner.
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const DIR = path.join(ROOT, 'assets', 'media');
const JOB = path.join(ROOT, 'data', 'media-job.json');

// Sticker details: related emoji (required by Discord) + description.
const STICKERS = {
  siren: ['🚨', 'Sirens on!'], salute: ['🫡', 'Salute'], party: ['🥳', 'Party time'], laugh: ['😂', 'Laughing'],
  skull: ['💀', 'I am dead'], fire: ['🔥', 'Fire'], clap: ['👏', 'Applause'], wave: ['👋', 'Hello!'],
  heart: ['❤️', 'Love it'], mindblown: ['🤯', 'Mind blown'],
  policecar: ['🚓', 'Police car'], firetruck: ['🚒', 'Fire truck'], ambulance: ['🚑', 'Ambulance'], officer: ['👮', 'Officer'],
  court: ['⚖️', 'Court is in session'], trophy: ['🏆', 'Winner'], crown: ['👑', 'Royalty'], announce: ['📢', 'Announcement'],
  approved: ['✅', 'Approved'], denied: ['❌', 'Denied'],
  // From emoji.gg (community uploads, picked by the server owner).
  roblox_salute: ['🫡', 'Salute!'], banhammer: ['🔨', 'Ban hammer'], red_alert: ['🚨', 'Red alert'], ban: ['⛔', 'Banned'],
  dont_ping_staff: ['🚫', "Don't ping staff"], hi_mods: ['👋', 'Hi mods & staff'], head_mod: ['🛡️', 'Head mod'],
  moderator: ['🛡️', 'Moderator'], salute_bear: ['🫡', 'Salute bear'], skill_issue: ['🎮', 'Skill issue'], flaming_skull: ['💀', 'Flaming skull'],
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function withRetry(fn) {
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      if (!String(err?.name).startsWith('RateLimitError')) throw err;
      const wait = Math.max(err.retryAfter ?? 0, err.sublimitTimeout ?? 0, err.timeToReset ?? 0, 1000) + 1000;
      console.log(`[media import] Discord upload limit - waiting ${Math.round(wait / 1000)}s`);
      await sleep(wait);
    }
  }
}

async function runJob(client) {
  if (!fs.existsSync(JOB)) return;
  const guild = await client.guilds.fetch(process.env.GUILD_ID);
  const rest = client.rest;
  const previous = rest.options.rejectOnRateLimit;
  rest.options.rejectOnRateLimit = (d) => /emojis|stickers/.test(d.route ?? '');
  const lines = [];
  try {
    const emojis = await guild.emojis.fetch();
    const have = new Set(emojis.map((e) => e.name));
    for (const f of fs.readdirSync(path.join(DIR, 'emojis')).sort()) {
      const name = f.replace(/\.(gif|png)$/, '');
      if (have.has(name)) { lines.push(`SKIPPED emoji ${name}: already exists`); continue; }
      try {
        const e = await withRetry(() => guild.emojis.create({ attachment: fs.readFileSync(path.join(DIR, 'emojis', f)), name, reason: 'New community emojis' }));
        lines.push(`OK  emoji <${e.animated ? 'a' : ''}:${e.name}:${e.id}>`);
      } catch (err) {
        lines.push(`FAILED emoji ${name}: ${err.message.split('\n')[0]}`);
      }
    }
    const stickers = await guild.stickers.fetch();
    const haveS = new Set(stickers.map((s) => s.name.toLowerCase()));
    for (const f of fs.readdirSync(path.join(DIR, 'stickers')).sort()) {
      const name = f.replace(/\.(gif|png)$/, '');
      const [tags, description] = STICKERS[name] ?? ['⭐', name];
      if (haveS.has(name)) { lines.push(`SKIPPED sticker ${name}: already exists`); continue; }
      try {
        await withRetry(() => guild.stickers.create({ file: { attachment: fs.readFileSync(path.join(DIR, 'stickers', f)), name: f }, name, tags, description, reason: 'New community stickers' }));
        lines.push(`OK  sticker ${name}`);
      } catch (err) {
        lines.push(`FAILED sticker ${name}: ${err.message.split('\n')[0]}`);
      }
    }
    fs.rmSync(JOB, { force: true }); // done - don't run again
  } finally {
    rest.options.rejectOnRateLimit = previous;
  }
  fs.writeFileSync(path.join(ROOT, 'data', 'media-result.txt'), lines.join('\n'));
  console.log(`[media import] done - ${lines.filter((l) => l.startsWith('OK')).length} uploaded`);
  const owner = await client.users.fetch(process.env.BOT_OWNER_ID ?? guild.ownerId).catch(() => null);
  const ok = lines.filter((l) => l.startsWith('OK')).length;
  const bad = lines.filter((l) => l.startsWith('FAILED'));
  owner?.send(`✅ New emojis & stickers uploaded: **${ok}**${bad.length ? `\nFailed: ${bad.join(', ').slice(0, 1500)}` : ''}`).catch(() => {});
}

module.exports = { runJob };
