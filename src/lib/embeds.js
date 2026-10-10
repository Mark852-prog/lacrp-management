// Shared branding: #e67e22 side bar, server author line, and the two banner images.
const path = require('node:path');
const { EmbedBuilder, AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { config } = require('./config');

const BRAND_COLOR = 0xe67e22;
const ASSETS = path.join(__dirname, '..', '..', 'assets');
const BANNERS = {
  sessions: 'banner-sessions.png',
  general: 'banner-general.png',
};

const SESSION_PINGS_BUTTON_ID = 'session-pings:toggle';

// Returns { embed, files }. Spread files into the message payload so the banner attachment resolves.
function brand({ banner = 'general', guild, withBanner = true } = {}) {
  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setAuthor({ name: config.settings.serverName, iconURL: guild?.iconURL() ?? undefined })
    .setTimestamp();
  const files = [];
  if (withBanner) {
    const file = BANNERS[banner];
    files.push(new AttachmentBuilder(path.join(ASSETS, file), { name: file }));
    embed.setImage(`attachment://${file}`);
  }
  return { embed, files };
}

// Plain branded embed without a banner (for secondary embeds, e.g. charts).
function plain() {
  return new EmbedBuilder().setColor(BRAND_COLOR);
}

function sessionPingsRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(SESSION_PINGS_BUTTON_ID)
      .setLabel('Get Session Notification!')
      .setEmoji('🔔')
      .setStyle(ButtonStyle.Secondary),
  );
}

const ts = (unix, style = 'f') => `<t:${Math.floor(unix)}:${style}>`;

function formatDuration(seconds) {
  seconds = Math.max(0, Math.round(seconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  if (m) return `${m}m`;
  return `${seconds}s`;
}

// Splits lines into chunks that fit an embed field/description.
function chunkLines(lines, max = 1024) {
  const chunks = [];
  let cur = '';
  for (const line of lines) {
    if (cur.length + line.length + 1 > max) {
      if (cur) chunks.push(cur);
      cur = line.slice(0, max);
    } else {
      cur = cur ? `${cur}\n${line}` : line;
    }
  }
  if (cur) chunks.push(cur);
  return chunks;
}

// For editing an existing message: drop files so the banner already attached is reused, not duplicated.
function forEdit({ files, ...rest }) {
  return rest;
}

module.exports = { BRAND_COLOR, brand, plain, forEdit, sessionPingsRow, SESSION_PINGS_BUTTON_ID, ts, formatDuration, chunkLines };
