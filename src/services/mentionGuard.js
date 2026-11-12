// Deletes messages that ping @everyone, @here or any role when the author is not allowed to.
// Allowed: staff (and above), admins, bots/webhooks. Everyone else gets the message removed and a short notice.
// Optional settings.json block: "mentionGuard": { "enabled": true, "allow": "staff" }   (allow: staff | supervisor | highRank)
// The bot needs the Manage Messages permission in the channels it should police.
const { can } = require('../lib/permissions');
const { config } = require('../lib/config');

const PING = /@(everyone|here)\b|<@&\d+>/;

async function check(message) {
  const cfg = config.settings.mentionGuard ?? {};
  if (cfg.enabled === false) return;
  if (!message.guild || message.author?.bot || message.webhookId || message.system) return;
  if (!PING.test(message.content ?? '') && !message.mentions?.everyone && !message.mentions?.roles?.size) return;
  const member = message.member ?? await message.guild.members.fetch(message.author.id).catch(() => null);
  if (member && can(member, cfg.allow || 'staff')) return;

  await message.delete().catch((err) => console.warn(`[mention guard] couldn't delete message from ${message.author.tag}: ${err.message} (bot needs Manage Messages)`));
  const note = await message.channel.send({ content: `<@${message.author.id}> you are not allowed to mention everyone or roles.`, allowedMentions: { users: [message.author.id] } }).catch(() => null);
  if (note) setTimeout(() => note.delete().catch(() => {}), 8000);
  console.log(`[mention guard] removed a mass/role ping from ${message.author.tag}`);
}

function attach(client) {
  client.on('messageCreate', (m) => check(m).catch((e) => console.warn('[mention guard]', e.message)));
  client.on('messageUpdate', async (_o, m) => {
    if (m.partial) m = await m.fetch().catch(() => null);
    if (m) check(m).catch((e) => console.warn('[mention guard]', e.message));
  });
}

module.exports = { attach, check };
