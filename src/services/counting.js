// Counting game. Members count up one number at a time in the channel set with
// /setup channels counting. Rules:
//  - the next number must be exactly one more than the last,
//  - nobody counts twice in a row,
//  - a wrong number or a double turn resets the count to 0 (the high score is kept).
// Messages that aren't a plain whole number are ignored, so people can still chat there.
const { channel } = require('../lib/guildConfig');
const { kvGet, kvSet } = require('../lib/db');

const STATE_KEY = 'counting:state';

function load() {
  return { current: 0, lastUser: null, best: 0, ...(kvGet(STATE_KEY, {}) ?? {}) };
}

const react = (msg, emoji) => msg.react(emoji).catch(() => {});

async function handle(msg) {
  const state = load();
  const n = Number(msg.content.trim());

  if (msg.author.id === state.lastUser) {
    return fail(msg, state, `${msg.author} counted twice in a row`);
  }
  if (n !== state.current + 1) {
    return fail(msg, state, `${msg.author} broke the count: the next number was **${state.current + 1}**, not **${n}**`);
  }

  state.current = n;
  state.lastUser = msg.author.id;
  state.best = Math.max(state.best, n);
  kvSet(STATE_KEY, state);
  await react(msg, n === state.best && n % 100 === 0 ? '🎉' : '✅');
}

async function fail(msg, state, reason) {
  const reached = state.current;
  const record = reached >= state.best && reached > 0;
  kvSet(STATE_KEY, { current: 0, lastUser: null, best: state.best });
  await react(msg, '❌');
  await msg.channel.send({
    content: `❌ ${reason}. The count was at **${reached}** and is back to **0**, start again from **1**!\n` +
      `🏆 High score: **${state.best}**${record ? ' (a new record!)' : ''}`,
    allowedMentions: { parse: [] },
  }).catch(() => {});
}

// One message at a time, so two people posting in the same second can't both "win" a number.
let queue = Promise.resolve();

function attach(client) {
  client.on('messageCreate', (msg) => {
    if (msg.author.bot || !msg.guild) return;
    const id = channel('counting');
    if (!id || msg.channelId !== id) return;
    if (!/^\d{1,15}$/.test(msg.content.trim())) return;
    queue = queue.then(() => handle(msg)).catch((err) => console.warn('[counting]', err.message));
  });
}

module.exports = { attach };
