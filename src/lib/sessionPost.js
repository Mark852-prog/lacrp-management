// Posting helper for session announcements: goes to the sessions channel from /setup.
// The channel only ever shows the latest session post: once a new one is up, the bot's older
// messages there are deleted (polls, votes, starts, ends, schedules, activity alerts).
const { MessageFlags } = require('discord.js');
const { fetchChannel } = require('./guildConfig');

const TWO_WEEKS_MS = 14 * 24 * 3600 * 1000;

async function clearOlder(channel, keepId) {
  const me = channel.client.user.id;
  const recent = await channel.messages.fetch({ limit: 100 }).catch(() => null);
  if (!recent) return;
  const old = recent.filter((m) => m.author.id === me && m.id !== keepId && !m.pinned);
  // Bulk delete only works on messages younger than 14 days; older ones go one by one.
  const young = old.filter((m) => Date.now() - m.createdTimestamp < TWO_WEEKS_MS);
  if (young.size > 1) await channel.bulkDelete(young).catch((e) => console.warn('[sessions cleanup]', e.message));
  else if (young.size === 1) await young.first().delete().catch(() => {});
  for (const m of old.filter((x) => !young.has(x.id)).values()) await m.delete().catch(() => {});
}

async function sendAndReplace(channel, payload) {
  const msg = await channel.send(payload);
  clearOlder(channel, msg.id).catch((e) => console.warn('[sessions cleanup]', e.message));
  return msg;
}

async function postToSessions(interaction, payload) {
  const channel = await fetchChannel(interaction.client, 'sessions');
  if (!channel) {
    const content = '⚠️ The session announcement channel isn\'t set up yet. Ask the bot owner to run `/setup channels`.';
    if (interaction.deferred || interaction.replied) await interaction.editReply(content);
    else await interaction.reply({ content, flags: MessageFlags.Ephemeral });
    return null;
  }
  return sendAndReplace(channel, payload);
}

module.exports = { postToSessions, sendAndReplace };
