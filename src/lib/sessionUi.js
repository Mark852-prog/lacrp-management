// Shared look for every session post.
//
// Card builders (buildVotePost / buildStartPost / buildEndedPost / buildLowActivityPost) produce
// ONE container card: SESSIONS banner, dividers, text, buttons inside the card, bottom strip.
// Card messages use Components V2, so they can't carry `content` or `embeds` - the role ping is
// rendered inside the card instead (pass `pingRoles`, usually rolesFor('<event>') from pings.js).
//
// Legacy helpers (sessionCard / sessionButtons / joinUrl / players / bar) are kept for the posts that
// still use the two-embed look (poll, schedule, status, high-activity).
const path = require('node:path');
const {
  EmbedBuilder, AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags,
  ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize,
  MediaGalleryBuilder, MediaGalleryItemBuilder,
} = require('discord.js');
const { BRAND_COLOR, SESSION_PINGS_BUTTON_ID } = require('./embeds');
const { config } = require('./config');

const ASSETS = path.join(__dirname, '..', '..', 'assets');
const TOP = 'banner-sessions.png';
const BOTTOM = 'banner-general.png';

const assetFiles = () => [
  new AttachmentBuilder(path.join(ASSETS, TOP), { name: TOP }),
  new AttachmentBuilder(path.join(ASSETS, BOTTOM), { name: BOTTOM }),
];

const joinUrl = (code) => (code ? `https://erlc.gg/join/${encodeURIComponent(code)}` : null);

// "24/40 players · 16 slots open"
function players(server) {
  const open = Math.max(0, server.MaxPlayers - server.CurrentPlayers);
  return `**${server.CurrentPlayers}/${server.MaxPlayers}** players · ${open ? `**${open}** slot${open === 1 ? '' : 's'} open` : '**server full**'}`;
}

// Plain-text value, e.g. "8/12 (67%)" (replaces the old block bar; same name and signature).
function bar(value, max) {
  const pct = max > 0 ? Math.round((Math.max(0, Math.min(max, value)) / max) * 100) : 0;
  return `${value}/${max} (${pct}%)`;
}

const secondary = (id, label) => new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(ButtonStyle.Secondary);
const joinButton = (code) => {
  const url = joinUrl(code);
  return url ? new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(url).setLabel('Join In-Game') : null;
};

// Legacy action row for the embed-style posts.
function sessionButtons(code, { join = true, notify = true } = {}) {
  const row = new ActionRowBuilder();
  const j = join ? joinButton(code) : null;
  if (j) row.addComponents(j);
  if (notify) row.addComponents(secondary(SESSION_PINGS_BUTTON_ID, 'Get Session Notification!'));
  return row.components.length ? [row] : [];
}

// ---------------------------------------------------------------------------------------
// Card plumbing
// ---------------------------------------------------------------------------------------
const divider = () => new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);
const gallery = (name) => new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(`attachment://${name}`));
const serverName = () => config.settings.serverName;

// sections: markdown strings (each preceded by a divider) or ActionRowBuilders (sit directly under
// the text above them, no divider).
function card(sections) {
  const c = new ContainerBuilder().setAccentColor(BRAND_COLOR).addMediaGalleryComponents(gallery(TOP));
  for (const s of sections.filter(Boolean)) {
    if (s instanceof ActionRowBuilder) {
      if (s.components.length) c.addActionRowComponents(s);
    } else {
      c.addSeparatorComponents(divider()).addTextDisplayComponents(new TextDisplayBuilder().setContent(s));
    }
  }
  c.addSeparatorComponents(divider()).addMediaGalleryComponents(gallery(BOTTOM));
  return c;
}

const pingLine = (roles = []) => (roles.length ? `${roles.map((r) => `<@&${r}>`).join(' ')}\n\n` : '');
const quote = (note) => (note ? `\n\n> ${note.replace(/\n/g, '\n> ')}` : '');

function payload(container, pingRoles = []) {
  return {
    components: [container],
    files: assetFiles(),
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: pingRoles.length ? { parse: [], roles: pingRoles } : { parse: [] },
  };
}

// ---------------------------------------------------------------------------------------
// Vote post. No vote target and no end time - votes just accumulate until a session starts.
// ---------------------------------------------------------------------------------------
function buildVotePost({ yes = 0, no = 0, closed = false, pingRoles = [] } = {}) {
  const row = new ActionRowBuilder();
  if (!closed) {
    row.addComponents(secondary('vote:yes', `Yes (${yes})`), secondary('vote:no', `No (${no})`));
  }
  row.addComponents(secondary('vote:voters', 'View Voters'), secondary(SESSION_PINGS_BUTTON_ID, 'Get Session Notification!'));

  return payload(card([
    pingLine(pingRoles) + (closed
      ? `The **${serverName()}** session vote has **closed**. Thank you to everyone who voted.`
      : `A **${serverName()}** session vote is now **open**. Cast your vote below to help decide whether a session should begin.\n\n` +
        'If you vote **yes**, please be ready to join when the server opens, so the session can get going quickly.'),
    `**Yes**  ${yes}\n**No**  ${no}`,
    'Want to see who has voted? Press **View Voters** for the full list. Use **Get Session Notification!** to be pinged when a session starts.',
    row,
  ]), pingRoles);
}

// ---------------------------------------------------------------------------------------
// Session started
// ---------------------------------------------------------------------------------------
function buildStartPost({ pingRoles = [], host, serverInfo, code, note } = {}) {
  const row = new ActionRowBuilder();
  const j = joinButton(code);
  if (j) row.addComponents(j);
  row.addComponents(secondary(SESSION_PINGS_BUTTON_ID, 'Get Session Notification!'));

  const stats = [];
  if (host) stats.push(`**Host**  <@${host}>`);
  if (serverInfo) stats.push(`**Players**  ${players(serverInfo)}`);
  stats.push(`**Join code**  ${code ? `\`${code}\`` : 'See in-game'}`);

  return payload(card([
    `${pingLine(pingRoles)}A **${serverName()}** session has **started**. The server is open, so join in and help build **realistic scenes** across every department.\n\n` +
      `Please read the **server rules** before you load in, and keep your roleplay **serious and enjoyable** for everyone.${quote(note)}`,
    stats.join('\n'),
    'Press **Join In-Game** to load straight into the server. Missed the last one? Use **Get Session Notification!** so you never miss a start-up.',
    row,
  ]), pingRoles);
}

// ---------------------------------------------------------------------------------------
// Session ended
// ---------------------------------------------------------------------------------------
function buildEndedPost({ pingRoles = [], host, duration, peakPlayers, uniquePlayers, note } = {}) {
  const stats = [];
  if (host) stats.push(`**Host**  <@${host}>`);
  if (duration) stats.push(`**Duration**  ${duration}`);
  if (peakPlayers != null) stats.push(`**Peak players**  ${peakPlayers}`);
  if (uniquePlayers != null) stats.push(`**Unique players**  ${uniquePlayers}`);

  return payload(card([
    `${pingLine(pingRoles)}The **${serverName()}** session has **ended**. Thank you to everyone who joined, built **realistic scenes** and made today's roleplay **worthwhile**.\n\n` +
      `The server is now **closed**. We hope you enjoyed the session, and we'll see you at the next one.${quote(note)}`,
    stats.join('\n'),
    "Want to be first in line next time? Press **Get Session Notification!** and you'll be pinged as soon as the next session starts.",
    new ActionRowBuilder().addComponents(secondary(SESSION_PINGS_BUTTON_ID, 'Get Session Notification!')),
  ]), pingRoles);
}

// ---------------------------------------------------------------------------------------
// Low player activity nudge
// ---------------------------------------------------------------------------------------
function buildLowActivityPost({ pingRoles = [], serverInfo, code } = {}) {
  const row = new ActionRowBuilder();
  const j = joinButton(code);
  if (j) row.addComponents(j);
  row.addComponents(secondary(SESSION_PINGS_BUTTON_ID, 'Get Session Notification!'));

  const stats = [];
  if (serverInfo) stats.push(`**Players**  ${players(serverInfo)}`);
  if (code) stats.push(`**Join code**  \`${code}\``);

  return payload(card([
    `${pingLine(pingRoles)}A **${serverName()}** session is currently experiencing **low player activity**. Join now to help create **realistic scenes**, support **active departments** and keep the roleplay going.\n\n` +
      'The session may end early if activity does not improve, so every extra player helps.',
    stats.join('\n'),
    row,
  ]), pingRoles);
}

// ---------------------------------------------------------------------------------------
// Poll. options: [{ label, count }]. Button ids are poll:<index>, poll:close and poll:voters.
// ---------------------------------------------------------------------------------------
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function buildPollPost({ question, options = [], createdBy, closed = false, pingRoles = [] } = {}) {
  const total = options.reduce((a, o) => a + o.count, 0);
  const top = Math.max(0, ...options.map((o) => o.count));
  const leaders = options.filter((o) => top > 0 && o.count === top).map((o) => o.label);

  const lines = options.map((o) => {
    const pct = total ? Math.round((o.count / total) * 100) : 0;
    const lead = !closed && top > 0 && o.count === top ? '  (leading)' : '';
    return `**${o.label}**  ${plural(o.count, 'vote')} · ${pct}%${lead}`;
  });

  const optionRow = new ActionRowBuilder().addComponents(
    ...options.map((o, i) => new ButtonBuilder().setCustomId(`poll:${i}`).setLabel(`${o.label.slice(0, 60)} (${o.count})`)
      .setStyle(ButtonStyle.Secondary).setDisabled(closed)),
    new ButtonBuilder().setCustomId('poll:close').setLabel('Close').setStyle(ButtonStyle.Danger).setDisabled(closed),
  );
  const votersRow = new ActionRowBuilder().addComponents(secondary('poll:voters', 'Voters'));

  return payload(card([
    `${pingLine(pingRoles)}**${question}**\n\n` + (closed
      ? (leaders.length ? `Final result: **${leaders.join(' / ')}** wins with ${plural(top, 'vote')}.` : 'The poll closed with no votes.')
      : 'Vote with the buttons below. One vote each; tap again to change or remove it.'),
    `${lines.join('\n')}\n\n**${plural(total, 'total vote')}** · started by <@${createdBy}>`,
    optionRow,
    votersRow,
  ]), pingRoles);
}

// ---------------------------------------------------------------------------------------
// Scheduled session announcement (and its cancelled state).
// ---------------------------------------------------------------------------------------
function buildSchedulePost({ id, when, host, note, cancelled = false, pingRoles = [] } = {}) {
  if (cancelled) {
    return payload(card([
      `The scheduled **${serverName()}** session has been **cancelled**. Keep an eye on this channel for the next one.`,
    ]), []);
  }
  return payload(card([
    `${pingLine(pingRoles)}A **${serverName()}** session has been **scheduled**. Mark your calendar, and press **Get Session Notification!** to be pinged when it goes live.${quote(note)}`,
    `**When**  <t:${Math.floor(when)}:F> (<t:${Math.floor(when)}:R>)\n**Host**  <@${host}>\n**Schedule #**  ${id}`,
    new ActionRowBuilder().addComponents(secondary(SESSION_PINGS_BUTTON_ID, 'Get Session Notification!')),
  ]), pingRoles);
}

// ---------------------------------------------------------------------------------------
// Server almost full / full alert (sent by the poller).
// ---------------------------------------------------------------------------------------
function buildHighActivityPost({ pingRoles = [], serverInfo, code, full = false, queue = 0 } = {}) {
  const row = new ActionRowBuilder();
  const j = joinButton(code);
  if (j) row.addComponents(j);
  row.addComponents(secondary(SESSION_PINGS_BUTTON_ID, 'Get Session Notification!'));

  const stats = [];
  if (serverInfo) stats.push(`**Players**  ${players(serverInfo)}`);
  stats.push(`**Queue**  ${queue}`);
  if (code) stats.push(`**Join code**  \`${code}\``);

  return payload(card([
    `${pingLine(pingRoles)}` + (full
      ? `The **${serverName()}** session is **full**. All slots are taken${queue ? ` and **${queue}** ${queue === 1 ? 'is' : 'are'} waiting in the queue` : ''}, so join the queue now to grab the next open spot.`
      : `The **${serverName()}** session is **almost full**. Only a few slots are left, so join before they're gone.`),
    stats.join('\n'),
    row,
  ]), pingRoles);
}

// ---------------------------------------------------------------------------------------
// "View Voters" ephemeral reply. yesIds / noIds are Discord user ids. Field values are capped
// under Discord's 1024-character limit; long lists end with "+N more".
// ---------------------------------------------------------------------------------------
function listField(ids) {
  if (!ids.length) return 'No votes yet';
  const lines = [];
  let used = 0;
  for (let i = 0; i < ids.length; i++) {
    const line = `<@${ids[i]}>`;
    const left = ids.length - i - 1;
    if (used + line.length + 1 + (left ? 12 : 0) > 1024) {
      lines.push(`+${ids.length - i} more`);
      break;
    }
    lines.push(line);
    used += line.length + 1;
  }
  return lines.join('\n');
}

function buildVotersReply({ yesIds = [], noIds = [], viewerId = null } = {}) {
  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle('Session voters')
    .addFields(
      { name: `Yes (${yesIds.length})`, value: listField(yesIds), inline: true },
      { name: `No (${noIds.length})`, value: listField(noIds), inline: true },
    );
  if (viewerId && !yesIds.includes(viewerId) && !noIds.includes(viewerId)) embed.setFooter({ text: 'You have not voted yet.' });
  return { embeds: [embed], flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } };
}

// ---------------------------------------------------------------------------------------
// Legacy two-embed card (poll, schedule, status, high-activity still use it).
// ---------------------------------------------------------------------------------------
function sessionCard() {
  const top = new EmbedBuilder().setColor(BRAND_COLOR).setImage(`attachment://${TOP}`);
  const main = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setImage(`attachment://${BOTTOM}`)
    .setFooter({ text: config.settings.serverName })
    .setTimestamp();
  return { top, main, files: assetFiles() };
}

module.exports = {
  buildVotePost, buildStartPost, buildEndedPost, buildLowActivityPost, buildPollPost, buildSchedulePost,
  buildHighActivityPost, buildVotersReply,
  sessionCard, sessionButtons, joinUrl, bar, players,
};
