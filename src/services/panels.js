// Self-updating panels posted with /panel:
//   status   - live server status, refreshed every minute from the poller's data
//   commands - the ':log announce' list, rebuilt whenever an announcement changes
const path = require('node:path');
const { EmbedBuilder, AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { BRAND_COLOR, SESSION_PINGS_BUTTON_ID, ts, formatDuration } = require('../lib/embeds');
const { kvGet, kvSet, get, now } = require('../lib/db');
const { config } = require('../lib/config');
const { activeSession } = require('../lib/sessions');
const { joinUrl, players } = require('../lib/sessionUi');
const { robloxToDiscord, UNKNOWN } = require('../lib/bloxlink');
const announcements = require('../lib/announcements');

const ASSETS = path.join(__dirname, '..', '..', 'assets');
const GROUP_URL = 'https://www.roblox.com/share/g/759995318';
const STATUS_EVERY_MS = 60_000;
const file = (name) => new AttachmentBuilder(path.join(ASSETS, name), { name });

let client;
let lastStatusAt = 0;
let failures = 0;
let lastServer = null;
const ownerCache = { id: null, text: null };

// ======================= STATUS =======================
async function ownerText(ownerId) {
  if (!ownerId) return 'Unknown';
  if (ownerCache.id === ownerId && ownerCache.text) return ownerCache.text;
  let name = null;
  try {
    const res = await fetch(`https://users.roblox.com/v1/users/${ownerId}`, { signal: AbortSignal.timeout(8000) });
    if (res.ok) name = (await res.json()).name;
  } catch { /* keep null */ }
  const discordId = await robloxToDiscord(ownerId).catch(() => null);
  const profile = `[${name ?? ownerId}](https://www.roblox.com/users/${ownerId}/profile)`;
  const text = discordId && discordId !== UNKNOWN ? `<@${discordId}>\n${profile}` : profile;
  Object.assign(ownerCache, { id: ownerId, text });
  return text;
}

async function statusPayload(guild, server, online) {
  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setAuthor({ name: config.settings.serverName, iconURL: guild.iconURL() ?? undefined })
    .setTitle('📊 Live Server Status')
    .setImage('attachment://banner-la.png')
    .setFooter({ text: 'Refreshes automatically every minute' })
    .setTimestamp();

  if (!server) {
    embed.setDescription('🔴 **Server unreachable.** The status will update as soon as the server responds again.');
    return { embeds: [embed], files: [file('banner-la.png')], components: [buttons(null)], allowedMentions: { parse: [] } };
  }

  const players = server.Players ?? [];
  const staff = players.filter((p) => p.Permission && p.Permission !== 'Normal').length;
  const queue = Array.isArray(server.Queue) ? server.Queue.length : 0;
  const openCalls = get('SELECT COUNT(*) AS n FROM mod_calls WHERE moderator IS NULL AND resolved_at IS NULL AND ts >= ?', now() - 7200).n;
  const session = activeSession();
  const state = !online ? '🟡 **Last known status** — the server isn\'t answering right now.'
    : server.CurrentPlayers >= server.MaxPlayers ? '🟢 **Online — full!** Join the queue to get in next.'
      : '🟢 **Online** — hop in, there\'s room for you!';

  embed.setDescription(`${state}\n-# Last updated ${ts(now(), 'R')}`)
    .addFields(
      { name: 'Server', value: server.Name ?? '—' },
      { name: 'Owner', value: await ownerText(server.OwnerId), inline: true },
      { name: 'Join Code', value: `\`${server.JoinKey}\``, inline: true },
      { name: 'Session', value: session ? `🟢 Live · <@${session.host_id}>\n${formatDuration(now() - session.started_at)}` : '🔴 None running', inline: true },
      { name: 'Players', value: `${players(server)}` },
      { name: 'Staff In-Game', value: `**${staff}**`, inline: true },
      { name: 'In Queue', value: `**${queue}**`, inline: true },
      { name: 'Open Mod Calls', value: `**${openCalls}**`, inline: true },
    );
  return { embeds: [embed], files: [file('banner-la.png')], components: [buttons(server.JoinKey)], allowedMentions: { parse: [] } };
}

function buttons(code) {
  const row = new ActionRowBuilder();
  const url = joinUrl(code);
  if (url) row.addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(url).setLabel('Join In-Game').setEmoji('🎮'));
  row.addComponents(
    new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(GROUP_URL).setLabel('Roblox Group').setEmoji('👥'),
    new ButtonBuilder().setCustomId(SESSION_PINGS_BUTTON_ID).setLabel('Session Pings').setEmoji('🔔').setStyle(ButtonStyle.Secondary),
  );
  return row;
}

async function postStatus(channel) {
  const msg = await channel.send(await statusPayload(channel.guild, lastServer, failures === 0));
  kvSet('panel_status', { channelId: channel.id, messageId: msg.id });
  lastStatusAt = Date.now();
  return msg;
}

async function refreshStatus() {
  const ref = kvGet('panel_status');
  if (!ref || !client) return;
  const channel = await client.channels.fetch(ref.channelId).catch(() => null);
  const msg = await channel?.messages.fetch(ref.messageId).catch(() => null);
  if (!msg) {
    kvSet('panel_status', null); // panel was deleted
    return;
  }
  const { files, ...payload } = await statusPayload(channel.guild, lastServer, failures === 0);
  await msg.edit(payload).catch((e) => console.warn('[status panel]', e.message));
  lastStatusAt = Date.now();
}

// Called by the poller after every ER:LC fetch.
function onServerData(server) {
  lastServer = server;
  failures = 0;
  if (Date.now() - lastStatusAt >= STATUS_EVERY_MS) refreshStatus().catch(() => {});
}
function onServerError() {
  failures += 1;
  // After ~2 minutes of failures, show the panel as unreachable.
  if (failures === 6) lastServer = null;
  if (Date.now() - lastStatusAt >= STATUS_EVERY_MS) refreshStatus().catch(() => {});
}

// ======================= COMMANDS =======================
function commandMessages() {
  const all = announcements.list();
  const byKeyword = new Map(all.map((a) => [a.keyword, a]));
  const cats = (config.commandPanel?.categories ?? []).map((c) => ({ ...c, items: c.keywords.map((k) => byKeyword.get(k)).filter(Boolean) }));
  const placed = new Set(cats.flatMap((c) => c.items.map((a) => a.keyword)));
  const other = all.filter((a) => !placed.has(a.keyword));
  if (other.length) cats.push({ name: 'Other', emoji: '📌', items: other });

  const header = [
    new EmbedBuilder().setColor(BRAND_COLOR).setImage('attachment://banner-commands.png'),
    new EmbedBuilder().setColor(BRAND_COLOR)
      .setTitle('📢 In-Game Announcements')
      .setDescription(
        'Every announcement below can be fired in-game by any staff member.\n\n' +
        '**Quick way** — type the shortcut in the ER:LC chat:\n```:log announce <keyword>```' +
        '**Backup** — if the bot is having issues, copy the full command under each one and paste it in-game.\n\n' +
        '**Discord checks** — log whether a player joined the Discord:\n```:log dcheck <exact username> yes/no```' +
        `-# ${all.length} announcements · this list updates itself whenever one is added, edited or removed.`,
      ),
  ];

  const sections = cats.filter((c) => c.items.length).map((c) => {
    const lines = c.items.map((a) => `**\`${a.keyword}\`**${a.label ? ` · ${a.label}` : ''}\n\`\`\`:${a.type === 'm' ? 'm' : 'h'} ${a.message}\`\`\``);
    return new EmbedBuilder().setColor(BRAND_COLOR).setTitle(`${c.emoji ?? ''} ${c.name}`.trim()).setDescription(lines.join('\n').slice(0, 4096));
  });
  sections[sections.length - 1]?.setImage('attachment://banner-general.png').setFooter({ text: config.settings.serverName });

  // Pack into messages: max 10 embeds and ~5,500 characters each (Discord caps a message at 6,000).
  const messages = [{ embeds: header, files: [file('banner-commands.png')] }];
  let cur = { embeds: [], size: 0 };
  for (const e of sections) {
    const size = (e.data.title?.length ?? 0) + (e.data.description?.length ?? 0);
    if (cur.embeds.length && (cur.size + size > 5500 || cur.embeds.length >= 10)) {
      messages.push({ embeds: cur.embeds });
      cur = { embeds: [], size: 0 };
    }
    cur.embeds.push(e);
    cur.size += size;
  }
  if (cur.embeds.length) messages.push({ embeds: cur.embeds });
  messages[messages.length - 1].files = [...(messages[messages.length - 1].files ?? []), file('banner-general.png')];
  return messages;
}

async function postCommands(channel) {
  const ids = [];
  for (const m of commandMessages()) ids.push((await channel.send({ ...m, allowedMentions: { parse: [] } })).id);
  kvSet('panel_commands', { channelId: channel.id, messageIds: ids });
}

// Re-renders the commands panel in place (sends extra messages / removes surplus ones as needed).
async function refreshCommands() {
  const ref = kvGet('panel_commands');
  if (!ref || !client) return;
  const channel = await client.channels.fetch(ref.channelId).catch(() => null);
  if (!channel) return;
  // If someone deleted (part of) the panel, it was removed on purpose: stop tracking it instead of
  // re-posting it. A new one can be posted any time with /panel commands.
  for (const id of ref.messageIds) {
    if (!(await channel.messages.fetch(id).catch(() => null))) {
      kvSet('panel_commands', null);
      console.log('[commands panel] panel was deleted - no longer updating it');
      return;
    }
  }
  const next = commandMessages();
  const ids = [];
  for (let i = 0; i < next.length; i++) {
    const old = ref.messageIds[i] ? await channel.messages.fetch(ref.messageIds[i]).catch(() => null) : null;
    // Messages whose image files changed position are simplest to re-send; text-only ones are edited.
    if (old && !next[i].files && !old.attachments.size) {
      await old.edit({ embeds: next[i].embeds, allowedMentions: { parse: [] } });
      ids.push(old.id);
    } else if (old && next[i].files && old.attachments.size === next[i].files.length) {
      await old.edit({ embeds: next[i].embeds, allowedMentions: { parse: [] } });
      ids.push(old.id);
    } else {
      // Layout changed - repost everything from here so the order stays right.
      for (const id of ref.messageIds.slice(i)) await channel.messages.delete(id).catch(() => {});
      for (const m of next.slice(i)) ids.push((await channel.send({ ...m, allowedMentions: { parse: [] } })).id);
      kvSet('panel_commands', { channelId: channel.id, messageIds: ids });
      return;
    }
  }
  for (const id of ref.messageIds.slice(next.length)) await channel.messages.delete(id).catch(() => {});
  kvSet('panel_commands', { channelId: channel.id, messageIds: ids });
}

function attach(discordClient) {
  client = discordClient;
}

module.exports = { attach, postStatus, refreshStatus, onServerData, onServerError, postCommands, refreshCommands };
