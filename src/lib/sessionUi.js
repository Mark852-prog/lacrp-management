// Shared look for every session post: SESSIONS banner on top, the content, then the
// "Los Angeles" wordmark at the bottom. Discord only allows one image per embed, so the top
// banner is its own image-only embed stacked above the main one.
const path = require('node:path');
const { EmbedBuilder, AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { BRAND_COLOR, SESSION_PINGS_BUTTON_ID } = require('./embeds');
const { config } = require('./config');

const ASSETS = path.join(__dirname, '..', '..', 'assets');
const TOP = 'banner-sessions.png';
const BOTTOM = 'banner-general.png';

// Returns { top, main, files }. Send as { embeds: [top, main], files }.
function sessionCard() {
  const top = new EmbedBuilder().setColor(BRAND_COLOR).setImage(`attachment://${TOP}`);
  const main = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setImage(`attachment://${BOTTOM}`)
    .setFooter({ text: config.settings.serverName })
    .setTimestamp();
  const files = [
    new AttachmentBuilder(path.join(ASSETS, TOP), { name: TOP }),
    new AttachmentBuilder(path.join(ASSETS, BOTTOM), { name: BOTTOM }),
  ];
  return { top, main, files };
}

const joinUrl = (code) => (code ? `https://erlc.gg/join/${encodeURIComponent(code)}` : null);

// Action row: [Join In-Game] (when the join code is known) + [Get Session Notification!]
function sessionButtons(code, { join = true, notify = true } = {}) {
  const row = new ActionRowBuilder();
  const url = joinUrl(code);
  if (join && url) row.addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(url).setLabel('Join In-Game').setEmoji('🎮'));
  if (notify) row.addComponents(new ButtonBuilder().setCustomId(SESSION_PINGS_BUTTON_ID).setLabel('Get Session Notification!').setEmoji('🔔').setStyle(ButtonStyle.Secondary));
  return row.components.length ? [row] : [];
}

// ▰▰▰▱▱▱ style bar
function bar(value, max, width = 12) {
  const filled = max > 0 ? Math.max(0, Math.min(width, Math.round((value / max) * width))) : 0;
  return `${'▰'.repeat(filled)}${'▱'.repeat(width - filled)}`;
}

// "24/40 players · 16 slots open" - used instead of a progress bar.
function players(server) {
  const open = Math.max(0, server.MaxPlayers - server.CurrentPlayers);
  return `**${server.CurrentPlayers}/${server.MaxPlayers}** players · ${open ? `**${open}** slot${open === 1 ? '' : 's'} open` : '**server full**'}`;
}

module.exports = { sessionCard, sessionButtons, joinUrl, bar, players };
