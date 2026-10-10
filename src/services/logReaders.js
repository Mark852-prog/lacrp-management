// Reads other bots' log channels (configured in /setup channels) and stores what analytics needs:
//   Vex "Shift Ended" embeds          -> shifts        (duty hours / quota)
//   Utility Bot "Infraction Notice"   -> infractions   (infractions issued per staff member, strikes)
//   Utility Bot promotions/resignations -> staff_events (turnover)
//   IA members' logs + ban request panels -> ia_logs / ban_requests (see iaAndBans.js)
// A configured source can be a channel, a forum, or a category; threads inside are read too.
// Works live (messageCreate/messageUpdate) and by back-filling channel history.
const { DateTime } = require('luxon');
const { ChannelType } = require('discord.js');
const { run, get } = require('../lib/db');
const { channel: channelId } = require('../lib/guildConfig');
const { config } = require('../lib/config');
const { parseIaLog, parseBanMessage } = require('./iaAndBans');

const SOURCES = ['vex_shift_logs', 'infractions', 'promotions', 'resignations', 'ia_logs', 'ban_requests'];
const MENTION = /<@!?(\d{15,21})>/;

// All visible text of the first embed, with markdown/quote markers stripped so labels line up.
function embedText(embed) {
  const parts = [embed.title, embed.description, ...(embed.fields ?? []).flatMap((f) => [f.name, f.value]), embed.footer?.text];
  return parts.filter(Boolean).join('\n').replace(/\*\*|__|`/g, '').replace(/^>\s?/gm, '');
}

function field(embed, re) {
  return (embed.fields ?? []).find((f) => re.test(f.name))?.value ?? null;
}

// "1 hour, 5 minutes and 10 seconds" / "2h 3m 4s" -> seconds
function parseLength(text) {
  if (!text) return null;
  const units = { d: 86400, day: 86400, h: 3600, hr: 3600, hour: 3600, m: 60, min: 60, minute: 60, s: 1, sec: 1, second: 1 };
  let total = 0;
  let found = false;
  for (const m of text.matchAll(/(\d+(?:\.\d+)?)\s*(days?|d|hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\b/gi)) {
    const unit = m[2].toLowerCase();
    const mult = units[unit] ?? units[unit.replace(/s$/, '')];
    if (mult) {
      total += Number(m[1]) * mult;
      found = true;
    }
  }
  return found ? Math.round(total) : null;
}

// "<t:123:f>" or "10 September 2026 18:07" -> unix
function parseTime(text) {
  if (!text) return null;
  const tag = text.match(/<t:(\d+)(?::\w)?>/);
  if (tag) return Number(tag[1]);
  const clean = text.trim();
  for (const fmt of ['d MMMM yyyy HH:mm', 'd MMMM yyyy H:mm', 'MMMM d, yyyy h:mm a', 'dd/MM/yyyy HH:mm']) {
    const d = DateTime.fromFormat(clean, fmt, { zone: config.settings.timezone });
    if (d.isValid) return Math.floor(d.toSeconds());
  }
  return null;
}

function labelled(raw, label) {
  // raw text before markdown stripping keeps <t:..> tags intact
  const m = raw.match(new RegExp(`${label}:?\\**\\s*([^\\n]+)`, 'i'));
  return m ? m[1].replace(/\*\*/g, '').trim() : null;
}

function rawEmbedText(embed) {
  return [embed.description, ...(embed.fields ?? []).map((f) => f.value)].filter(Boolean).join('\n').replace(/^>\s?/gm, '');
}

// ---------- Vex ----------
function parseVex(message) {
  const embed = message.embeds[0];
  if (!embed || !/shift\s+ended/i.test(embed.title ?? embedText(embed))) return false;
  const raw = rawEmbedText(embed);
  const memberLine = labelled(raw, 'Staff Member') ?? '';
  const discordId = memberLine.match(MENTION)?.[1] ?? raw.match(MENTION)?.[1];
  if (!discordId) return false;

  const type = labelled(raw, 'Shift Type');
  const counted = config.settings.vexShiftTypesCounted;
  if (type && counted?.length && !counted.some((t) => t.toLowerCase() === type.toLowerCase())) return false;

  const end = parseTime(labelled(raw, 'Shift End')) ?? Math.floor(message.createdTimestamp / 1000);
  const start = parseTime(labelled(raw, 'Shift Start'));
  const length = parseLength(labelled(raw, 'Shift Length'));
  const duration = length ?? (start ? end - start : null);
  if (duration == null || duration < 0) return false;

  run(`INSERT INTO shifts(message_id, discord_id, shift_type, started_at, ended_at, duration_s) VALUES(?, ?, ?, ?, ?, ?)
       ON CONFLICT(message_id) DO UPDATE SET discord_id = excluded.discord_id, shift_type = excluded.shift_type,
         started_at = excluded.started_at, ended_at = excluded.ended_at, duration_s = excluded.duration_s`,
  message.id, discordId, type, start ?? end - duration, end, duration);
  return true;
}

// ---------- Utility Bot infractions ----------
async function parseInfraction(message) {
  const embed = message.embeds[0];
  if (!embed || !/infraction/i.test(embed.title ?? '')) return false;
  const targetId = field(embed, /infracted|staff member/i)?.match(MENTION)?.[1] ?? message.content.match(MENTION)?.[1] ?? null;
  const punishment = field(embed, /punishment/i)?.trim() ?? null;
  const reason = field(embed, /reason/i)?.trim() ?? null;
  const issuerName = (embed.footer?.text ?? '').match(/issued by,?\s*([^\n]+)/i)?.[1]?.trim() ?? null;

  const existing = get('SELECT issuer_id, issuer_name FROM infractions WHERE message_id = ?', message.id);
  let issuerId = existing?.issuer_name === issuerName ? existing.issuer_id : null;
  if (!issuerId && issuerName && message.guild) issuerId = await resolveMemberByName(message.guild, issuerName);

  run(`INSERT INTO infractions(message_id, target_id, issuer_name, issuer_id, punishment, reason, ts) VALUES(?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(message_id) DO UPDATE SET target_id = excluded.target_id, issuer_name = excluded.issuer_name,
         issuer_id = excluded.issuer_id, punishment = excluded.punishment, reason = excluded.reason`,
  message.id, targetId, issuerName, issuerId, punishment, reason, Math.floor(message.createdTimestamp / 1000));
  return true;
}

async function resolveMemberByName(guild, name) {
  try {
    const found = await guild.members.search({ query: name, limit: 10 });
    const lower = name.toLowerCase();
    const exact = found.find((m) => [m.user.username, m.user.globalName, m.displayName].some((n) => n?.toLowerCase() === lower));
    return (exact ?? (found.size === 1 ? found.first() : null))?.id ?? null;
  } catch {
    return null;
  }
}

// ---------- Utility Bot promotions / resignations ----------
// Utility Bot posts "Staff Promotion" / "Staff Resignation" embeds: the member is pinged in the message
// content, and the rank is a role mention (<@&id>) inside the embed.
function parseStaffEvent(message, kind) {
  const embed = message.embeds[0];
  const titleRe = kind === 'promotion' ? /promot/i : /resign/i;
  if (!embed || !titleRe.test(embed.title ?? '')) return false;
  const body = rawEmbedText(embed);
  const discordId = message.content.match(MENTION)?.[1] ?? body.match(MENTION)?.[1] ?? null;
  const roleId = body.match(/<@&(\d{15,21})>/)?.[1] ?? null;
  run('INSERT OR IGNORE INTO staff_events(message_id, kind, discord_id, role_id, ts) VALUES(?, ?, ?, ?, ?)',
    message.id, kind, discordId, roleId, Math.floor(message.createdTimestamp / 1000));
  return true;
}

// Which source a message belongs to: its channel, the thread's parent, or the category above.
function slotFor(message) {
  const ch = message.channel;
  const ids = [message.channelId, ch?.parentId, ch?.parent?.parentId].filter(Boolean);
  return SOURCES.find((s) => ids.includes(channelId(s)));
}

async function handleMessage(message) {
  if (!message.guildId || message.author?.id === message.client?.user?.id) return;
  const slot = slotFor(message);
  if (!slot) return;
  try {
    if (slot === 'vex_shift_logs') parseVex(message);
    else if (slot === 'infractions') await parseInfraction(message);
    else if (slot === 'ia_logs') parseIaLog(message);
    else if (slot === 'ban_requests') parseBanMessage(message);
    else parseStaffEvent(message, slot === 'promotions' ? 'promotion' : 'resignation');
  } catch (err) {
    console.warn(`[logReaders:${slot}]`, err.message);
  }
}

// Every message container under a source: the channel itself, channels in a category, and threads (active + archived).
async function containersOf(ch) {
  const out = [];
  if (ch.type === ChannelType.GuildCategory) {
    const children = ch.guild.channels.cache.filter((c) => c.parentId === ch.id);
    for (const child of children.values()) out.push(...(await containersOf(child)));
    return out;
  }
  if (ch.messages) out.push(ch);
  if (ch.threads) {
    const active = await ch.threads.fetchActive().catch(() => null);
    active?.threads.forEach((t) => { if (t.parentId === ch.id) out.push(t); });
    let before;
    for (let page = 0; page < 20; page++) {
      const archived = await ch.threads.fetchArchived({ limit: 100, before }).catch(() => null);
      if (!archived?.threads.size) break;
      archived.threads.forEach((t) => out.push(t));
      if (!archived.hasMore) break;
      before = archived.threads.last().id;
    }
  }
  return out;
}

async function readHistory(container, maxMessages) {
  let before;
  let seen = 0;
  while (seen < maxMessages) {
    const batch = await container.messages.fetch({ limit: 100, before }).catch(() => null);
    if (!batch?.size) break;
    // Oldest first, so ban-request panels exist before the thread replies that review them.
    for (const msg of [...batch.values()].reverse()) await handleMessage(msg);
    seen += batch.size;
    before = batch.last().id;
  }
  return seen;
}

// Imports a source's history. Safe to re-run; rows are upserted.
async function backfill(client, slot, maxMessages = 20000) {
  const id = channelId(slot);
  if (!id) return 0;
  const ch = await client.channels.fetch(id).catch(() => null);
  if (!ch) return 0;
  if (slot === 'ia_logs') await ch.guild.members.fetch().catch(() => {}); // for name matching
  let seen = 0;
  const containers = await containersOf(ch);
  // Panels live in the parent channel; read it before the threads.
  containers.sort((a, b) => Number(Boolean(a.isThread?.())) - Number(Boolean(b.isThread?.())));
  for (const c of containers) seen += await readHistory(c, maxMessages);
  return seen;
}

async function backfillAll(client) {
  const out = {};
  for (const slot of SOURCES) out[slot] = await backfill(client, slot);
  return out;
}

function attach(client) {
  client.on('messageCreate', handleMessage);
  client.on('messageUpdate', async (_old, msg) => {
    if (msg.partial) msg = await msg.fetch().catch(() => null);
    if (msg) handleMessage(msg);
  });
}

module.exports = { attach, backfill, backfillAll, parseLength, parseTime, SOURCES };
