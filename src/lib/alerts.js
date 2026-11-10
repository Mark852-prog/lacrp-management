// The two "nudge" posts: manual low-activity and automatic high-activity / server-full.
// Layout: SESSIONS banner, one bold hook line, 1-2 short supporting lines, Join + notification buttons.
const { withPing, rolesFor } = require('./pings');
const { buildLowActivityPost, buildHighActivityPost } = require('./sessionUi');

function lowActivityMessage(guild, server) {
  return buildLowActivityPost({ pingRoles: rolesFor('low_activity'), serverInfo: server, code: server?.JoinKey });
}

function highActivityMessage(guild, server) {
  return buildHighActivityPost({
    pingRoles: rolesFor('high_activity'),
    serverInfo: server,
    code: server.JoinKey,
    full: server.CurrentPlayers >= server.MaxPlayers,
    queue: Array.isArray(server.Queue) ? server.Queue.length : 0,
  });
}

module.exports = { lowActivityMessage, highActivityMessage, withPing };
