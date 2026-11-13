// Checks the bot can actually use each channel assigned in /setup, and explains Discord permission errors.
const { PermissionFlagsBits: P, ChannelType } = require('discord.js');
const { CHANNEL_SLOTS, channel: channelId } = require('./guildConfig');

const POST = ['staff_requests', 'sessions', 'dc_logs'];
const NEEDS = {
  post: [P.ViewChannel, P.SendMessages, P.EmbedLinks, P.AttachFiles, P.ReadMessageHistory],
  read: [P.ViewChannel, P.ReadMessageHistory],
};
const NAMES = {
  [P.ViewChannel]: 'View Channel',
  [P.SendMessages]: 'Send Messages',
  [P.EmbedLinks]: 'Embed Links',
  [P.AttachFiles]: 'Attach Files',
  [P.ReadMessageHistory]: 'Read Message History',
};

// Returns [{ slot, channelId, missing: ['View Channel', ...] }] for every assigned slot.
async function audit(guild) {
  const me = guild.members.me ?? (await guild.members.fetchMe());
  const out = [];
  for (const slot of Object.keys(CHANNEL_SLOTS)) {
    const id = channelId(slot);
    if (!id) continue;
    const ch = guild.channels.cache.get(id) ?? (await guild.channels.fetch(id).catch(() => null));
    if (!ch) {
      out.push({ slot, channelId: id, missing: ['channel not found (deleted?)'] });
      continue;
    }
    const perms = ch.permissionsFor(me);
    const need = POST.includes(slot) ? NEEDS.post : NEEDS.read;
    let missing = need.filter((p) => !perms?.has(p)).map((p) => NAMES[p]);
    // For a category, check the channels inside it too (the IA logs can be a whole category).
    if (ch.type === ChannelType.GuildCategory) {
      const hidden = guild.channels.cache.filter((c) => c.parentId === ch.id && !c.permissionsFor(me)?.has(P.ViewChannel));
      if (hidden.size) missing = [...missing, `can't see ${hidden.map((c) => `#${c.name}`).join(', ')}`];
    }
    out.push({ slot, channelId: id, missing });
  }
  return out;
}

// Friendly text for Discord's "Missing Access" (50001) / "Missing Permissions" (50013) errors.
function explain(err) {
  if (err?.code !== 50001 && err?.code !== 50013) return null;
  const id = String(err.url ?? '').match(/channels\/(\d+)/)?.[1];
  const where = id ? `<#${id}>` : 'that channel';
  return `🔒 I don't have permission to ${err.code === 50001 ? 'see' : 'post in'} ${where}. ` +
    'In that channel\'s settings → **Permissions**, add the **LACRP Management** role and allow: ' +
    '**View Channel, Send Messages, Embed Links, Attach Files, Read Message History**. Then try again.';
}

module.exports = { audit, explain };
