// LAPD Bot - entry point.
require('dotenv').config();

const fs = require('node:fs');
const path = require('node:path');
const { Client, GatewayIntentBits, Events, MessageFlags } = require('discord.js');
const branding = require('./lib/branding');
const web = require('./web/server');

for (const key of ['DISCORD_TOKEN', 'GUILD_ID']) {
  if (!process.env[key]) {
    console.error(`Missing ${key} in .env - see .env.example`);
    process.exit(1);
  }
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// ---- load commands ----
const commands = new Map();
for (const file of fs.readdirSync(path.join(__dirname, 'commands')).filter((f) => f.endsWith('.js'))) {
  const mod = require(path.join(__dirname, 'commands', file));
  commands.set(mod.data.name, mod);
}

client.once(Events.ClientReady, async (c) => {
  console.log(`Logged in as ${c.user.tag}`);
  branding.startStatusRotation(c);
  await branding.syncProfile(c);

  const guild = await c.guilds.fetch(process.env.GUILD_ID).catch(() => null);
  if (!guild) {
    console.error(`The bot is not in guild ${process.env.GUILD_ID}. Invite it, then restart.`);
    return;
  }
  // Guild-scoped registration updates instantly (global commands can take up to an hour).
  await guild.commands.set([...commands.values()].map((m) => m.data.toJSON()));
  console.log(`Registered ${commands.size} slash commands in ${guild.name}`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const command = commands.get(interaction.commandName);
  if (!command) return;
  try {
    await command.execute(interaction);
  } catch (err) {
    console.error(`/${interaction.commandName} failed:`, err);
    const reply = { content: 'Something went wrong. Dispatch has been notified (not really, check the console).', flags: MessageFlags.Ephemeral };
    await (interaction.replied || interaction.deferred ? interaction.followUp(reply) : interaction.reply(reply)).catch(() => {});
  }
});

process.on('unhandledRejection', (err) => console.error('Unhandled rejection:', err));

web.start(client);
client.login(process.env.DISCORD_TOKEN);
