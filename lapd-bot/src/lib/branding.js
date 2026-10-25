// LAPD look and feel: colours, the profile text, the status quotes, and syncing the bot's
// avatar / banner / About Me to Discord.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Routes, ActivityType } = require('discord.js');

const ASSETS = path.join(__dirname, '..', '..', 'assets');
const DATA = path.join(__dirname, '..', '..', 'data');
const STATE_FILE = path.join(DATA, 'branding.json');

const COLORS = { navy: 0x0a1640, gold: 0xc9a227 };
const MOTTO = 'To Protect and To Serve';

// Shown as the bot's "About Me" on its profile (Discord allows up to 400 characters).
const DESCRIPTION = [
  'Los Angeles Police Department | LACRP',
  'To protect and to serve.',
  '',
  'Pull over. Yes, you.',
].join('\n');

// Rotated through as the bot's custom status.
const QUOTES = [
  'Doughnuts are evidence. We are simply securing the scene.',
  'Knock knock. It\'s the police. No, we will not leave a message.',
  'License and registration... and your excuse.',
  'You have the right to remain silent. Please use it.',
  'It\'s not a pursuit if you never stop chasing.',
  'Speed limit is a suggestion? Your ticket is not.',
  'Code 7: officer is on a doughnut break.',
  'We don\'t crash. We perform tactical stops.',
  'PIT maneuver loading... 87%',
  'Running your plates. And judging them.',
  'Backup is on the way. Probably.',
];

const randomQuote = () => QUOTES[Math.floor(Math.random() * QUOTES.length)];

function dataUri(file) {
  const buf = fs.readFileSync(path.join(ASSETS, file));
  return { uri: `data:image/png;base64,${buf.toString('base64')}`, hash: crypto.createHash('sha1').update(buf).digest('hex') };
}

function readState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return {}; }
}

function writeState(state) {
  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// Discord rate-limits avatar/banner changes hard, so only upload what changed since the last run.
async function syncProfile(client) {
  const state = readState();
  const avatar = dataUri('avatar.png');
  const banner = dataUri('banner.png');
  const descHash = crypto.createHash('sha1').update(DESCRIPTION).digest('hex');

  const userPatch = {};
  if (state.avatar !== avatar.hash) userPatch.avatar = avatar.uri;
  if (state.banner !== banner.hash) userPatch.banner = banner.uri;
  if (Object.keys(userPatch).length) {
    try {
      await client.rest.patch(Routes.user(), { body: userPatch });
      if (userPatch.avatar) state.avatar = avatar.hash;
      if (userPatch.banner) state.banner = banner.hash;
      console.log(`Updated bot ${Object.keys(userPatch).join(' and ')}.`);
    } catch (err) {
      console.warn(`Could not update avatar/banner (Discord rate-limits this, it will retry next start): ${err.message}`);
    }
  }

  if (state.description !== descHash) {
    try {
      await client.rest.patch(Routes.currentApplication(), { body: { description: DESCRIPTION } });
      state.description = descHash;
      console.log('Updated bot About Me.');
    } catch (err) {
      console.warn(`Could not update About Me: ${err.message}`);
    }
  }

  writeState(state);
}

// Custom status with a new quote every few minutes.
function startStatusRotation(client, everyMs = 5 * 60_000) {
  const set = () => client.user.setPresence({
    status: 'online',
    activities: [{ type: ActivityType.Custom, name: 'custom', state: `🚓 ${randomQuote()}` }],
  });
  set();
  setInterval(set, everyMs).unref();
}

module.exports = { COLORS, MOTTO, DESCRIPTION, QUOTES, randomQuote, syncProfile, startStatusRotation };
