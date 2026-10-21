// LACRP Management - entry point.
require('dotenv').config();

// Prefer IPv4 for outgoing requests: ER:LC's allowlist holds the host's IPv4 address, and an
// IPv6 connection would come from a different address and be rejected.
require('node:dns').setDefaultResultOrder('ipv4first');
require('node:net').setDefaultAutoSelectFamily(false);

// node:sqlite prints an "experimental" warning on some Node 22 builds; it's stable for our use.
const emitWarning = process.emitWarning;
process.emitWarning = (warning, ...args) => {
  if (String(warning).includes('SQLite')) return;
  return emitWarning.call(process, warning, ...args);
};

const fs = require('node:fs');
const path = require('node:path');
const { Client, GatewayIntentBits, Partials, Events, MessageFlags } = require('discord.js');

for (const key of ['DISCORD_TOKEN', 'GUILD_ID', 'ERLC_SERVER_KEY']) {
  if (!process.env[key]) {
    console.error(`Missing ${key} in .env - see .env.example`);
    process.exit(1);
  }
}
if (!process.env.BOT_OWNER_ID) console.warn('BOT_OWNER_ID not set - only the Discord server owner can configure the bot.');
if (!process.env.BLOXLINK_API_KEY) console.warn('BLOXLINK_API_KEY not set - Discord checks and staff linking will be limited.');

const { role } = require('./lib/guildConfig');
const { SESSION_PINGS_BUTTON_ID } = require('./lib/embeds');
const poller = require('./services/poller');
const logReaders = require('./services/logReaders');
const nicknames = require('./services/nicknames');
const panels = require('./services/panels');
const emojis = require('./lib/emojis');
const channelPerms = require('./lib/channelPerms');
const { kvSet } = require('./lib/db');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers, // privileged: staff lists for quota / activity checks
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // privileged: reading Vex / Utility Bot embeds
  ],
  partials: [Partials.Message, Partials.Channel],
});
emojis.install(client);

// ---- load commands ----
const commands = new Map();
const buttons = new Map();
const modals = new Map();
const selects = new Map();
for (const file of fs.readdirSync(path.join(__dirname, 'commands')).filter((f) => f.endsWith('.js'))) {
  const mod = require(path.join(__dirname, 'commands', file));
  commands.set(mod.data.name, mod);
  for (const [prefix, fn] of Object.entries(mod.buttons ?? {})) buttons.set(prefix, fn);
  for (const [prefix, fn] of Object.entries(mod.modals ?? {})) modals.set(prefix, fn);
  for (const [prefix, fn] of Object.entries(mod.selects ?? {})) selects.set(prefix, fn);
}

client.once(Events.ClientReady, async (c) => {
  console.log(`Logged in as ${c.user.tag}`);
  const guild = await c.guilds.fetch(process.env.GUILD_ID).catch(() => null);
  if (!guild) {
    console.error(`The bot is not in guild ${process.env.GUILD_ID}. Invite it, then restart.`);
    return;
  }
  // Guild-scoped registration updates instantly (global commands can take up to an hour).
  await guild.commands.set([...commands.values()].map((m) => m.data.toJSON()));
  console.log(`Registered ${commands.size} slash commands in ${guild.name}`);

  // ER:LC only accepts in-game commands from allowlisted IPs, so print the one to allowlist.
  fetch('https://api.ipify.org', { signal: AbortSignal.timeout(10_000) })
    .then((r) => r.text())
    .then((ip) => {
      kvSet('public_ip', ip.trim());
      console.log(`Public IP: ${ip.trim()} (allowlist this at https://api.erlc.gg/server-owners so in-game announcements work)`);
    })
    .catch(() => {});
  fetch('https://api6.ipify.org', { signal: AbortSignal.timeout(10_000) })
    .then((r) => r.text())
    .then((ip) => console.log(`Host also has IPv6 ${ip.trim()} (not used for ER:LC - requests are forced over IPv4)`))
    .catch(() => {});

  const problems = (await channelPerms.audit(guild).catch(() => [])).filter((a) => a.missing.length);
  for (const p of problems) console.warn(`[permissions] ${p.slot} (#${guild.channels.cache.get(p.channelId)?.name ?? p.channelId}) is missing: ${p.missing.join(', ')}`);

  logReaders.attach(c);
  nicknames.attach(c);
  panels.attach(c);
  require('./services/inGameRole').attach(c);
  require('./services/webEditor').start(c);
  require('./services/starterEmbeds').ensure();
  // Cleanup first (removes unwanted files), then the import (only when their job files exist).
  require('./services/mediaCleanup').runJob(c).catch((err) => console.error('[media cleanup]', err))
    .finally(() => require('./services/mediaImport').runJob(c).catch((err) => console.error('[media import]', err)));
  require('./services/roleColors').runJob(c).catch((err) => console.error('[role colors]', err)); // only when data/role-colors-job.json exists
  require('./services/roleIcons').runJob(c).catch((err) => console.error('[role icons]', err)); // only when data/role-icons-job.json exists
  require('./services/permAudit').runJob(c).catch((err) => console.error('[perm audit]', err)); // only when data/perm-job.json exists
  require('./services/serverLayout').runJob(c).catch((err) => console.error('[layout]', err)); // only when data/layout-job.json exists
  require('./services/guidelines').refresh(c).catch(() => {}); // already-posted panels pick up design changes
  // Redraw posted polls, custom embeds and the commands panel so they use the latest emojis/layout.
  require('./commands/session-poll').refreshRecent(c).catch((err) => console.warn('[poll refresh]', err.message));
  require('./services/starterEmbeds').refreshAll(c).catch(() => {});
  panels.refreshCommands().catch(() => {});
  // Upload the bot's own emojis (department logos) first, then redraw the hub that uses them.
  require('./services/appEmojis').ensure(c).catch((err) => console.warn('[app emojis]', err.message))
    .then(() => require('./services/departments').refresh(c)).catch(() => {});
  require('./services/emojiImport').resume(c).catch((err) => console.error('[emoji import]', err));
  poller.start(c);
  logReaders.backfillAll(c)
    .then((counts) => console.log('[backfill]', counts))
    .catch((err) => console.warn('[backfill]', err.message));
});

async function toggleSessionPings(interaction) {
  const roleId = role('session_pings');
  if (!roleId) return interaction.reply({ content: '⚠️ The Session Pings role hasn\'t been set up yet.', flags: MessageFlags.Ephemeral });
  const member = interaction.member;
  try {
    if (member.roles.cache.has(roleId)) {
      await member.roles.remove(roleId, 'Session notification opt-out');
      return interaction.reply({ content: '🔕 You will **no longer** be pinged for sessions.', flags: MessageFlags.Ephemeral });
    }
    await member.roles.add(roleId, 'Session notification opt-in');
    return interaction.reply({ content: '🔔 You will now be pinged for sessions! Tap again to opt out.', flags: MessageFlags.Ephemeral });
  } catch {
    return interaction.reply({ content: '❌ I couldn\'t change your roles — the bot\'s role must be above **Session Pings** and have Manage Roles.', flags: MessageFlags.Ephemeral });
  }
}

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.guildId !== process.env.GUILD_ID) return;
  try {
    if (interaction.isAutocomplete()) {
      return await commands.get(interaction.commandName)?.autocomplete?.(interaction);
    }
    if (interaction.isChatInputCommand()) {
      await commands.get(interaction.commandName)?.execute(interaction);
    } else if (interaction.isButton()) {
      if (interaction.customId === SESSION_PINGS_BUTTON_ID) return await toggleSessionPings(interaction);
      await buttons.get(interaction.customId.split(':')[0])?.(interaction);
    } else if (interaction.isAnySelectMenu()) {
      await selects.get(interaction.customId.split(':')[0])?.(interaction);
    } else if (interaction.isModalSubmit()) {
      await modals.get(interaction.customId.split(':')[0])?.(interaction);
    }
  } catch (err) {
    console.error(`[interaction ${interaction.commandName ?? interaction.customId}]`, err);
    if (interaction.isAutocomplete()) return;
    const msg = { content: channelPerms.explain(err) ?? '❌ Something went wrong running that. The error has been logged.', flags: MessageFlags.Ephemeral };
    if (interaction.deferred || interaction.replied) await interaction.followUp(msg).catch(() => {});
    else await interaction.reply(msg).catch(() => {});
  }
});

process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', err));
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    poller.stop();
    client.destroy();
    process.exit(0);
  });
}

client.login(process.env.DISCORD_TOKEN).catch((err) => {
  const hint = /disallowed intents/i.test(err.message)
    ? 'turn on Server Members Intent and Message Content Intent (Developer Portal > Bot)'
    : 'check DISCORD_TOKEN in .env';
  console.error('Discord login failed:', err.message, '-', hint);
  process.exit(1);
});
