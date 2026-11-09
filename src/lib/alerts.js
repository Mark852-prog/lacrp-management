// The two "nudge" posts: manual low-activity and automatic high-activity / server-full.
// Layout: SESSIONS banner, one bold hook line, 1-2 short supporting lines, Join + notification buttons.
const { config } = require('./config');
const { withPing, rolesFor } = require('./pings');
const { sessionCard, sessionButtons, players, buildLowActivityPost } = require('./sessionUi');

function lowActivityMessage(guild, server) {
  return buildLowActivityPost({ pingRoles: rolesFor('low_activity'), serverInfo: server, code: server?.JoinKey });
}

function highActivityMessage(guild, server) {
  const name = config.settings.serverName;
  const full = server.CurrentPlayers >= server.MaxPlayers;
  const queue = Array.isArray(server.Queue) ? server.Queue.length : 0;
  const { top, main, files } = sessionCard();
  main.setTitle(full ? '🎉 Server Full' : '🎉 Almost Full')
    .setDescription(full
      ? `**The ${name} session is FULL!**\n\nAll slots are taken${queue ? ` and **${queue}** ${queue === 1 ? 'is' : 'are'} waiting in the queue` : ''} — hop in the queue now to grab the next open spot!`
      : `**The ${name} session is almost full!**\n\nOnly a few slots left — join before they're gone!`)
    .addFields(
      { name: 'Players', value: `${players(server)}`, inline: true },
      { name: 'Queue', value: `**${queue}**`, inline: true },
      { name: 'Join code', value: `\`${server.JoinKey}\``, inline: true },
    );
  return withPing({ embeds: [top, main], files, components: sessionButtons(server.JoinKey) }, 'high_activity');
}

module.exports = { lowActivityMessage, highActivityMessage, withPing };
