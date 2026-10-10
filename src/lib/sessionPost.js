// Posting helper for session announcements: goes to the sessions channel from /setup.
const { MessageFlags } = require('discord.js');
const { fetchChannel } = require('./guildConfig');

async function postToSessions(interaction, payload) {
  const channel = await fetchChannel(interaction.client, 'sessions');
  if (!channel) {
    const content = '⚠️ The session announcement channel isn\'t set up yet. Ask the bot owner to run `/setup channels`.';
    if (interaction.deferred || interaction.replied) await interaction.editReply(content);
    else await interaction.reply({ content, flags: MessageFlags.Ephemeral });
    return null;
  }
  return channel.send(payload);
}

module.exports = { postToSessions };
