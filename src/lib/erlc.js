// ER:LC (PRC) private server API client - https://apidocs.erlc.gg
// Respects rate-limit headers and 429 Retry-After (ignoring them gets the host IP blocked).
const BASE = 'https://api.erlc.gg/v2';
const COMMAND_SPACING_MS = 5500; // command bucket is 1 request / 5s

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pausedUntil = 0; // epoch ms - set by 429s or an exhausted bucket
let lastServer = null; // most recent successful GET /server payload
let lastServerAt = 0;

class ErlcError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function request(method, path, body) {
  const key = process.env.ERLC_SERVER_KEY;
  if (!key) throw new ErlcError(0, 'ERLC_SERVER_KEY is not set in .env');

  const wait = pausedUntil - Date.now();
  if (wait > 0) await sleep(wait);

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'server-key': key, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });

  const remaining = Number(res.headers.get('x-ratelimit-remaining'));
  const reset = Number(res.headers.get('x-ratelimit-reset'));
  if (res.headers.has('x-ratelimit-remaining') && remaining <= 0 && reset) {
    pausedUntil = Math.max(pausedUntil, reset * 1000 + 250);
  }

  let data = null;
  const text = await res.text();
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { message: text };
  }

  if (res.status === 429) {
    const retry = Number(res.headers.get('retry-after') ?? data?.retry_after ?? 5);
    pausedUntil = Date.now() + retry * 1000 + 250;
    throw new ErlcError(429, `Rate limited by ER:LC API, retrying in ${retry}s`);
  }
  if (!res.ok) {
    if (res.status === 403 && /allowlist/i.test(data?.message ?? '')) {
      const ip = require('./db').kvGet('public_ip');
      throw new ErlcError(403, `ER:LC hasn't allowlisted the bot's IP${ip ? ` (${ip})` : ''} yet. The server owner must add it at https://api.erlc.gg/server-owners.`);
    }
    throw new ErlcError(res.status, data?.message || `ER:LC API error ${res.status}`);
  }
  return data;
}

// flags: array of Players | Staff | JoinLogs | Queue | KillLogs | CommandLogs | ModCalls | EmergencyCalls | Vehicles
async function getServer(flags = []) {
  const qs = flags.length ? `?${flags.map((f) => `${f}=true`).join('&')}` : '';
  const data = await request('GET', `/server${qs}`);
  if (flags.includes('Players')) {
    lastServer = data;
    lastServerAt = Date.now();
  }
  return data;
}

// Returns the last polled payload if it's fresh enough, otherwise fetches.
async function getServerCached(flags, maxAgeMs = 30_000) {
  const fresh = lastServer && Date.now() - lastServerAt < maxAgeMs && flags.every((f) => f in lastServer);
  if (fresh) return lastServer;
  return getServer(flags);
}

// ---- in-game commands (serialised, spaced to the command bucket) ----
const commandQueue = [];
let commandWorker = null;
let lastCommandAt = 0;

function runCommand(command) {
  return new Promise((resolve, reject) => {
    commandQueue.push({ command, resolve, reject });
    if (!commandWorker) commandWorker = drainCommands();
  });
}

async function drainCommands() {
  while (commandQueue.length) {
    const job = commandQueue.shift();
    const gap = lastCommandAt + COMMAND_SPACING_MS - Date.now();
    if (gap > 0) await sleep(gap);
    try {
      lastCommandAt = Date.now();
      job.resolve(await request('POST', '/server/command', { command: job.command }));
    } catch (err) {
      if (err.status === 429) {
        commandQueue.unshift(job); // retry after the pause
        continue;
      }
      job.reject(err);
    }
  }
  commandWorker = null;
}

// "PlayerName:12345" -> { name, id }
function parsePlayer(str) {
  if (!str || typeof str !== 'string') return { name: null, id: null };
  const i = str.lastIndexOf(':');
  if (i === -1) return { name: str, id: null };
  const id = Number(str.slice(i + 1));
  return { name: str.slice(0, i), id: Number.isFinite(id) ? id : null };
}

module.exports = { getServer, getServerCached, runCommand, parsePlayer, ErlcError, lastServer: () => lastServer };
