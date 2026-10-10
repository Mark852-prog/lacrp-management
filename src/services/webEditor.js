// Web editor for custom embeds, served by the bot itself on the host's port.
// Access: /embed web gives the owner a one-time login link (15 min). Opening it sets a session
// cookie (12 h). Every API call needs that cookie. Plain HTTP (the host has no TLS), so links
// are single-use and short-lived.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { ChannelType, PermissionFlagsBits } = require('discord.js');
const ce = require('../lib/customEmbeds');
const { config } = require('../lib/config');

const PAGE = path.join(__dirname, '..', 'web', 'editor.html');
const LOGIN_TTL = 15 * 60 * 1000;
const SESSION_TTL = 12 * 3600 * 1000;
const loginTokens = new Map(); // token -> expiresAt
const sessions = new Map(); // sid -> expiresAt

let client;
let port = null;

const newToken = () => crypto.randomBytes(24).toString('base64url');

function loginLink() {
  if (!port) return null;
  const token = newToken();
  loginTokens.set(token, Date.now() + LOGIN_TTL);
  const base = (process.env.WEB_URL || config.settings.webEditorUrl || `http://localhost:${port}`).replace(/\/$/, '');
  return `${base}/login?t=${token}`;
}

function authed(req) {
  const sid = (req.headers.cookie ?? '').match(/(?:^|;\s*)sid=([\w-]+)/)?.[1];
  const exp = sid && sessions.get(sid);
  if (!exp || exp < Date.now()) return false;
  return true;
}

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY' });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('Too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function channels() {
  const guild = client.guilds.cache.get(process.env.GUILD_ID);
  if (!guild) return [];
  const me = guild.members.me;
  return guild.channels.cache
    .filter((c) => [ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(c.type) && c.permissionsFor(me)?.has(PermissionFlagsBits.SendMessages))
    .sort((a, b) => a.rawPosition - b.rawPosition)
    .map((c) => ({ id: c.id, name: c.name, category: c.parent?.name ?? '' }));
}

const imageList = () => ce.listImages().map((i) => ({ ...i, url: `/img/${encodeURIComponent(i.key)}` }));

async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;

  // GET only shows a page - it never uses up the link. Discord (and other link previewers) fetch
  // URLs automatically, so the one-time token is only consumed by the POST a real browser sends.
  if (p === '/login' && req.method === 'GET') {
    const t = String(url.searchParams.get('t') ?? '').replace(/[^\w-]/g, '');
    return send(res, 200, `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>LACRP Embed Studio</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0f1012;color:#e9e9ec;font:15px system-ui,sans-serif}form{text-align:center}button{background:#e67e22;border:0;border-radius:8px;padding:12px 22px;font:600 15px system-ui;color:#1a0f05;cursor:pointer}</style></head>
<body><form method="post" action="/login"><p>LACRP Embed Studio</p><input type="hidden" name="t" value="${t}"><button type="submit">Open the editor</button></form>
<script>document.forms[0].submit()</script></body></html>`, 'text/html; charset=utf-8');
  }
  if (p === '/login' && req.method === 'POST') {
    const t = new URLSearchParams((await readBody(req, 2000)).toString()).get('t');
    const exp = t && loginTokens.get(t);
    loginTokens.delete(t);
    if (!exp || exp < Date.now()) return send(res, 403, 'This link has expired or was already used. Run /embed web in Discord for a new one.', 'text/plain; charset=utf-8');
    const sid = newToken();
    sessions.set(sid, Date.now() + SESSION_TTL);
    res.writeHead(302, { 'Set-Cookie': `sid=${sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL / 1000}`, Location: '/' });
    return res.end();
  }
  if (!authed(req)) return send(res, 401, 'Open the link from /embed web in Discord to use the editor.', 'text/plain; charset=utf-8');

  if (p === '/' && req.method === 'GET') return send(res, 200, fs.readFileSync(PAGE), 'text/html; charset=utf-8');

  if (p.startsWith('/img/')) {
    const file = ce.imagePath(decodeURIComponent(p.slice(5)));
    if (!file || !fs.existsSync(file)) return send(res, 404, { error: 'Not found' });
    const ext = path.extname(file).slice(1).replace('jpg', 'jpeg');
    res.writeHead(200, { 'Content-Type': `image/${ext}`, 'Cache-Control': 'private, max-age=3600' });
    return fs.createReadStream(file).pipe(res);
  }

  // Same-origin JSON API. Mutations require a custom header, which cross-site forms can't send.
  if (req.method !== 'GET' && req.headers['x-lacrp'] !== '1') return send(res, 403, { error: 'Bad request' });

  if (p === '/api/state' && req.method === 'GET') {
    return send(res, 200, { guildId: process.env.GUILD_ID, embeds: ce.list(), images: imageList(), channels: await channels(), presets: Object.keys(ce.PRESETS) });
  }
  if (p === '/api/upload' && req.method === 'POST') {
    const body = await readBody(req, 8 * 1024 * 1024 + 1);
    const key = ce.saveUpload(body, req.headers['content-type']);
    return send(res, 200, { key, images: imageList() });
  }
  if (p === '/api/embeds' && req.method === 'POST') {
    const { name } = JSON.parse((await readBody(req, 10_000)).toString() || '{}');
    return send(res, 200, ce.create(name));
  }

  const m = p.match(/^\/api\/embeds\/(\d+)(\/post|\/rename)?$/);
  if (m) {
    const e = ce.byId(m[1]);
    if (!e) return send(res, 404, { error: 'Embed not found' });
    if (!m[2] && req.method === 'GET') return send(res, 200, e);
    if (!m[2] && req.method === 'PUT') {
      const data = JSON.parse((await readBody(req, 200_000)).toString());
      const saved = ce.save(e.id, data);
      const updated = saved.posts.length ? await ce.refreshPosts(client, e.id) : 0;
      return send(res, 200, { ...ce.byId(e.id), updatedPosts: updated });
    }
    if (!m[2] && req.method === 'DELETE') {
      ce.remove(e.id);
      return send(res, 200, { ok: true });
    }
    if (m[2] === '/rename' && req.method === 'POST') {
      const { name } = JSON.parse((await readBody(req, 10_000)).toString());
      ce.rename(e.id, name);
      return send(res, 200, ce.byId(e.id));
    }
    if (m[2] === '/post' && req.method === 'POST') {
      const { channelId } = JSON.parse((await readBody(req, 10_000)).toString());
      if (!(await channels()).some((c) => c.id === channelId)) return send(res, 400, { error: 'Pick a channel the bot can post in.' });
      const channel = await client.channels.fetch(channelId);
      await ce.post(channel, e.id);
      return send(res, 200, ce.byId(e.id));
    }
  }
  return send(res, 404, { error: 'Not found' });
}

function start(discordClient) {
  client = discordClient;
  const wanted = Number(process.env.SERVER_PORT || process.env.WEB_PORT || config.settings.webEditorPort || 0);
  if (!wanted) {
    console.log('[web editor] no port configured - web editor disabled (Discord builder still works)');
    return;
  }
  const server = http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      console.warn('[web editor]', err.message);
      if (!res.headersSent) send(res, 400, { error: err.message });
    });
  });
  server.on('error', (err) => console.warn('[web editor] could not start:', err.message));
  server.listen(wanted, '0.0.0.0', () => {
    port = wanted;
    console.log(`[web editor] listening on port ${wanted}`);
  });
  // Clean up expired tokens/sessions hourly.
  setInterval(() => {
    const t = Date.now();
    for (const [k, v] of loginTokens) if (v < t) loginTokens.delete(k);
    for (const [k, v] of sessions) if (v < t) sessions.delete(k);
  }, 3600_000).unref();
}

module.exports = { start, loginLink };
