// Logs in-game commands run from Discord (/bans unban) to the in-game log channel
// (falls back to the DC log channel until one is set with /setup channels).
const { plain } = require('./embeds');
const { fetchChannel } = require('./guildConfig');

async function logIngame(interaction, { command, ok, error }) {
  const channel = (await fetchChannel(interaction.client, 'ingame_logs')) ?? (await fetchChannel(interaction.client, 'dc_logs'));
  if (!channel) return;
  const embed = plain()
    .setTitle(ok ? '🎮 In-game command run' : '❌ In-game command failed')
    .addFields(
      { name: 'Staff', value: `<@${interaction.user.id}>`, inline: true },
      { name: 'From', value: `/${interaction.commandName}`, inline: true },
      { name: 'Command', value: `\`\`\`${command.slice(0, 1000)}\`\`\`` },
    )
    .setTimestamp();
  if (error) embed.addFields({ name: 'Error', value: error.slice(0, 1000) });
  await channel.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch((e) => console.warn('[ingame log]', e.message));
}

module.exports = { logIngame };
