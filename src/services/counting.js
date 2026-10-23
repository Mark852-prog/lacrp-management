// Counting channel: members count 1, 2, 3... in order. The right number gets ✅. A wrong number, or the
// same person counting twice in a row, is deleted (the count does not reset). Messages that aren't a number
// are left alone. On startup the count continues from the last number already in the channel.
// The channel is the one named "counting" (or set with /setup channels counting).
const { kvGet, kvSet } = require('../lib/db');
const { fetchChannel } = require('../lib/guildConfig');

const KEY = 'counting_state';
const state = () => kvGet(KEY, { current: 0, lastUserId: null, lastMessageId: null });
const numberIn = (text) => text.trim().match(/^(\d+)(?:\s|$)/)?.[1];
let queue = Promise.resolve(); // one message at a time, so two people typing at once can't both count the same number
let channelId = null;

async function counting(client) {
  if (channelId) return channelId;
  channelId = (await fetchChannel(client, 'counting').catch(() => null))?.id ?? null;
  return channelId;
}

// Pick up where people already are: the newest number in the channel is the current count.
async function syncFromChannel(client) {
  const channel = await fetchChannel(client, 'counting').catch(() => null);
  if (!channel?.messages) return;
  const recent = await channel.messages.fetch({ limit: 50 });
  const last = [...recent.values()].find((m) => !m.author.bot && numberIn(m.content));
  if (!last) return;
  kvSet(KEY, { current: Number(numberIn(last.content)), lastUserId: last.author.id, lastMessageId: last.id });
  console.log(`[counting] continuing from ${numberIn(last.content)} (last counted by ${last.author.tag})`);
}

// Short note that removes itself, so the channel stays clean.
async function note(channel, text) {
  const msg = await channel.send({ content: text, allowedMentions: { parse: [] } }).catch(() => null);
  if (msg) setTimeout(() => msg.delete().catch(() => {}), 5000);
}

async function handle(message) {
  const s = state();
  const raw = numberIn(message.content);
  if (!raw) return; // not a number - just chat
  const n = Number(raw);
  const expected = s.current + 1;

  if (message.author.id === s.lastUserId) {
    await message.delete().catch(() => {});
    return note(message.channel, `⏳ ${message.author}, wait for someone else to count before you go again. Next number: **${expected}**`);
  }
  if (n !== expected) {
    await message.delete().catch(() => {});
    return note(message.channel, `❌ ${message.author}, wrong number. Next number: **${expected}**`);
  }
  kvSet(KEY, { current: n, lastUserId: message.author.id, lastMessageId: message.id });
  await message.react('✅').catch(() => {});
}

function attach(client) {
  syncFromChannel(client).catch((err) => console.warn('[counting] sync failed:', err.message));

  client.on('messageCreate', async (message) => {
    if (message.author.bot || message.guildId !== process.env.GUILD_ID) return;
    if (message.channelId !== (await counting(client))) return;
    queue = queue.then(() => handle(message)).catch((err) => console.warn('[counting]', err.message));
  });

  // Someone deleted the last counted number (often to trick the next person): say where the count is.
  client.on('messageDelete', async (message) => {
    if (message.channelId !== (await counting(client))) return;
    const s = state();
    if (!s.lastMessageId || message.id !== s.lastMessageId) return;
    await message.channel.send({ content: `🗑️ The last number was deleted. The count is at **${s.current}**, next is **${s.current + 1}**.`, allowedMentions: { parse: [] } }).catch(() => {});
  });

  // Channel renamed or recreated: look it up again.
  client.on('channelUpdate', () => { channelId = null; });
  client.on('channelDelete', () => { channelId = null; });
  client.on('channelCreate', () => { channelId = null; });
}

module.exports = { attach };
