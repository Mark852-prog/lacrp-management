// Counting game. Members count up one number at a time in the channel set with
// /setup channels counting. Rules:
//  - ONLY plain whole numbers are allowed in the channel: anything else is deleted
//    (the bot needs Manage Messages in that channel),
//  - the next number must be exactly one more than the last,
//  - nobody counts twice in a row,
//  - a wrong number or a double turn resets the count to 0 (the high score is kept).
// /counting set (bot owner) puts the count back where it was, e.g. after the bot was offline.
const { channel } = require('../lib/guildConfig');
const { kvGet, kvSet } = require('../lib/db');

const STATE_KEY = 'counting:state';

const isNumber = (text) => /^\d{1,15}$/.test(String(text ?? '').trim());

function load() {
  return { current: 0, lastUser: null, best: 0, ...(kvGet(STATE_KEY, {}) ?? {}) };
}

// Sets the count (and who counted it, so they can't also count the next number).
function setCount(current, lastUser = null) {
  const state = load();
  const next = { current, lastUser, best: Math.max(state.best, current) };
  kvSet(STATE_KEY, next);
  return next;
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
    content: `❌ ${reason}. ` +
      (reached ? `The count was at **${reached}** and is back to **0**, start again from **1**!` : 'The count is at **0**, so start from **1**!') + '\n' +
      `🏆 High score: **${state.best}**${record ? ' (a new record!)' : ''}`,
    allowedMentions: { parse: [] },
  }).catch(() => {});
}

// One message at a time, so two people posting in the same second can't both "win" a number.
let queue = Promise.resolve();

function attach(client) {
  const inCountingChannel = (msg) => {
    const id = channel('counting');
    return Boolean(id) && Boolean(msg.guild) && msg.channelId === id && !msg.author?.bot;
  };

  client.on('messageCreate', (msg) => {
    if (!inCountingChannel(msg)) return;
    // Only numbers are allowed here (text, images, stickers, links...): remove everything else.
    if (!isNumber(msg.content)) {
      msg.delete().catch((err) => console.warn('[counting] could not delete a message (needs Manage Messages):', err.message));
      return;
    }
    queue = queue.then(() => handle(msg)).catch((err) => console.warn('[counting]', err.message));
  });

  // Editing a number into text would sneak words past the filter.
  client.on('messageUpdate', (_old, msg) => {
    if (!inCountingChannel(msg) || msg.content == null) return;
    if (!isNumber(msg.content)) msg.delete().catch(() => {});
  });
}

module.exports = { attach, load, setCount, isNumber };
