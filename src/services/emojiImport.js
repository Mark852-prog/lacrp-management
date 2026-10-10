// Import of server emojis listed in config/emoji-import.json (/setup import-emojis).
// Files come from assets/emojis/<name>.png when present (bundled with the bot), otherwise from
// <baseUrl>/<folder>/<name>.png. Uploads run one at a time.
// replace: an emoji with the same name is deleted and re-uploaded (new ID) instead of skipped.
// Replaced IDs are remembered in data/emoji-replaced.json, so a rerun after a restart continues
// where it stopped instead of replacing the fixed emojis again.
// Discord's emoji upload limit answers with a 429 that discord.js would wait out silently (often for
// a long time), so emoji routes reject instead and the wait happens here, where it can be reported.
const fs = require('node:fs');
const path = require('node:path');

const CONFIG = path.join(__dirname, '..', '..', 'config', 'emoji-import.json');
const LOCAL = path.join(__dirname, '..', '..', 'assets', 'emojis');
const STATE = path.join(__dirname, '..', '..', 'data', 'emoji-replaced.json');
const STATIC_LIMIT = { 0: 50, 1: 100, 2: 150, 3: 250 }; // by server boost tier
const MAX_BYTES = 256 * 1024;

async function load(item) {
  const local = path.join(LOCAL, `${item.name}.png`);
  if (fs.existsSync(local)) return fs.readFileSync(local);
  const res = await fetch(item.url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`download failed (HTTP ${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

function readState() {
  try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch { return {}; }
}

function writeState(state) {
  fs.mkdirSync(path.dirname(STATE), { recursive: true });
  fs.writeFileSync(STATE, JSON.stringify(state, null, 2));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Runs fn; on an emoji rate limit waits it out (reporting when it resumes) and tries again.
async function withRetry(fn, onRateLimit) {
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      if (!String(err?.name).startsWith('RateLimitError')) throw err;
      const waitMs = Math.max(err.retryAfter ?? 0, err.sublimitTimeout ?? 0, err.timeToReset ?? 0, 1000) + 1000;
      const resumeAt = Math.floor((Date.now() + waitMs) / 1000);
      console.log(`[emoji import] Discord rate limit on ${err.method} ${err.route}: waiting ${Math.round(waitMs / 1000)}s (resumes ${new Date(resumeAt * 1000).toISOString()})`);
      onRateLimit(resumeAt);
      await sleep(waitMs);
    }
  }
}

async function run(guild, onProgress = () => {}, { replace = false, onRateLimit = () => {} } = {}) {
  const rest = guild.client.rest;
  const previous = rest.options.rejectOnRateLimit;
  rest.options.rejectOnRateLimit = async (data) => {
    if (/emojis/.test(data.route ?? '')) return true;
    if (typeof previous === 'function') return previous(data);
    return Array.isArray(previous) && previous.some((r) => data.route.startsWith(r.toLowerCase()));
  };
  try {
    return await runInner(guild, onProgress, replace, onRateLimit);
  } finally {
    rest.options.rejectOnRateLimit = previous;
  }
}

async function runInner(guild, onProgress, replace, onRateLimit) {
  const cfg = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
  const items = cfg.sets.flatMap((s) => s.names.map((name) => ({ name, url: `${cfg.baseUrl}/${s.folder}/${name}.png` })));
  const state = readState();
  const fixedAfter = cfg.replacedAfter ? Date.parse(cfg.replacedAfter) : 0;

  const existing = await guild.emojis.fetch();
  const staticCount = existing.filter((e) => !e.animated).size;
  const limit = STATIC_LIMIT[guild.premiumTier] ?? 50;
  let free = limit - staticCount;
  const byName = new Map(existing.map((e) => [e.name, e]));

  const added = [];
  const replaced = [];
  const skipped = [];
  const failed = [];
  const before = { staticCount, limit, free };
  let stopped = null;

  for (const [i, item] of items.entries()) {
    const old = byName.get(item.name);
    if (old && !replace) {
      skipped.push(`${item.name} (name already exists)`);
    } else if (old && (state[item.name] === old.id || old.createdTimestamp > fixedAfter)) {
      replaced.push(`<:${old.name}:${old.id}>`); // already replaced in an earlier run
    } else {
      try {
        const buf = await load(item);
        if (buf.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('file is not a PNG');
        if (buf.length > MAX_BYTES) throw new Error('file is over 256 KB');
        // With a free slot the new emoji is uploaded first (Discord allows duplicate names), so a failed
        // upload never leaves the server without the emoji. Otherwise the old one has to go first.
        const deleteFirst = old && free <= 0;
        if (deleteFirst) {
          console.log(`[emoji import] ${item.name}: no free slot, deleting the old one first`);
          await withRetry(() => old.delete('Replaced with a fixed version (/setup import-emojis replace)'), onRateLimit);
          free += 1;
        }
        if (free <= 0) throw new Error('no free emoji slots left');
        let emoji;
        try {
          emoji = await withRetry(() => guild.emojis.create({ attachment: buf, name: item.name, reason: 'Emoji import (/setup import-emojis)' }), onRateLimit);
        } catch (err) {
          // Stop here: carrying on would delete more emojis that may not upload either.
          if (deleteFirst) stopped = `${item.name} was deleted but its upload failed (${err.message.split('\n')[0]})`;
          throw err;
        }
        free -= 1;
        if (old && !deleteFirst) {
          await withRetry(() => old.delete('Replaced with a fixed version (/setup import-emojis replace)'), onRateLimit);
          free += 1;
        }
        console.log(`[emoji import] ${item.name}: ${old ? 'replaced' : 'added'} (${i + 1}/${items.length})`);
        (old || replace ? replaced : added).push(`<:${emoji.name}:${emoji.id}>`);
        byName.set(item.name, emoji);
        if (replace) {
          state[item.name] = emoji.id;
          writeState(state);
        }
      } catch (err) {
        console.error(`[emoji import] ${item.name} failed:`, err.message);
        failed.push(`${item.name} (${err.message.split('\n')[0]})`);
        if (stopped) break;
      }
    }
    onProgress(i + 1, items.length);
  }
  return { before, added, replaced, skipped, failed, freeAfter: free, stopped };
}

// The running import is saved in data/emoji-job.json so it continues after a bot restart.
const JOB = path.join(__dirname, '..', '..', 'data', 'emoji-job.json');
let active = false;

function report(result, started) {
  const { before, added, replaced, skipped, failed, freeAfter, stopped } = result;
  return [
    stopped ? `⚠️ **Emoji import stopped:** ${stopped}` : `✅ **Emoji import finished** in ${Math.round((Date.now() - started) / 1000)}s`,
    `Slots before: ${before.staticCount}/${before.limit} used (${before.free} free) · free now: ${freeAfter}`,
    `**Added (${added.length}):** ${added.join(' ') || 'none'}`,
    `**Replaced (${replaced.length}):** ${replaced.join(' ') || 'none'}`,
    `**Skipped (${skipped.length}):** ${skipped.join(', ') || 'none'}`,
    `**Failed (${failed.length}):** ${failed.join(', ') || 'none'}`,
  ];
}

// Runs an import job and returns the report lines. Only one runs at a time.
async function job(guild, userId, replace, { onProgress, onRateLimit } = {}) {
  if (active) return null;
  active = true;
  const started = Date.now();
  fs.mkdirSync(path.dirname(JOB), { recursive: true });
  fs.writeFileSync(JOB, JSON.stringify({ guildId: guild.id, userId, replace, started }));
  try {
    const result = await run(guild, onProgress, { replace, onRateLimit });
    console.log('[emoji import] done', JSON.stringify({ added: result.added.length, replaced: result.replaced.length, failed: result.failed }));
    // Posted embeds still point at the old emoji IDs - re-render them with the new ones.
    await require('./starterEmbeds').refreshAll(guild.client);
    return report(result, started);
  } finally {
    fs.rmSync(JOB, { force: true });
    active = false;
  }
}

// On startup: continue an import that a restart interrupted and DM the result to whoever started it.
async function resume(client) {
  let saved;
  try { saved = JSON.parse(fs.readFileSync(JOB, 'utf8')); } catch { return; }
  const guild = client.guilds.cache.get(saved.guildId ?? process.env.GUILD_ID);
  if (!guild) return fs.rmSync(JOB, { force: true });
  const userId = saved.userId ?? process.env.BOT_OWNER_ID ?? guild.ownerId;
  const user = await client.users.fetch(userId).catch(() => null);
  console.log('[emoji import] resuming the import interrupted by a restart');
  user?.send('🔄 The bot restarted during the emoji import - it is continuing now. The result will be sent here.').catch(() => {});
  let told = false;
  const lines = await job(guild, userId, saved.replace, {
    onRateLimit: (resumeAt) => {
      if (told) return;
      told = true;
      user?.send(`⏸️ Discord's emoji upload limit was reached. The import continues automatically <t:${resumeAt}:R> (at <t:${resumeAt}:t>).`).catch(() => {});
    },
  });
  if (lines && user) for (const c of require('../lib/embeds').chunkLines(lines, 1900)) await user.send(c).catch(() => {});
}

module.exports = { run, job, resume, isRunning: () => active };
