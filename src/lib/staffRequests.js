// Staff request queue shared by /staff-request, /staff-request-approve, /staff-request-deny and the queue buttons.
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { run, get, now } = require('./db');
const { brand, forEdit, ts } = require('./embeds');

const TYPES = {
  duty: 'Come on duty',
  session: 'Host a session',
  other: 'Other',
};

function requestMessage(guild, req) {
  const { embed, files } = brand({ guild });
  const status = {
    pending: '🟡 Pending',
    approved: `✅ Approved by <@${req.handled_by}> ${req.handled_at ? ts(req.handled_at, 'R') : ''}`,
    denied: `❌ Denied by <@${req.handled_by}> ${req.handled_at ? ts(req.handled_at, 'R') : ''}`,
  }[req.status];
  embed.setTitle(`📨 Staff Request #${req.id}`).addFields(
    { name: 'Requested by', value: `<@${req.requester_id}>`, inline: true },
    { name: 'Type', value: TYPES[req.type] ?? req.type, inline: true },
    { name: 'Submitted', value: ts(req.created_at, 'R'), inline: true },
    { name: 'Details', value: req.details?.slice(0, 1024) || '—' },
    { name: 'Status', value: status },
  );
  if (req.reason) embed.addFields({ name: 'Reason', value: req.reason.slice(0, 1024) });
  const components = req.status === 'pending'
    ? [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`staffreq:approve:${req.id}`).setLabel('Approve').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`staffreq:deny:${req.id}`).setLabel('Deny').setStyle(ButtonStyle.Danger),
    )]
    : [];
  return { embeds: [embed], files, components, allowedMentions: { parse: [] } };
}

function create(type, requesterId, details) {
  const { lastInsertRowid } = run('INSERT INTO staff_requests(type, requester_id, details, created_at) VALUES(?, ?, ?, ?)', type, requesterId, details, now());
  return get('SELECT * FROM staff_requests WHERE id = ?', Number(lastInsertRowid));
}

// Returns { ok, error, req }
async function decide(client, id, approve, handlerId, reason) {
  const req = get('SELECT * FROM staff_requests WHERE id = ?', id);
  if (!req) return { ok: false, error: `No staff request #${id}.` };
  if (req.status !== 'pending') return { ok: false, error: `Request #${id} was already ${req.status}.` };

  run('UPDATE staff_requests SET status = ?, handled_by = ?, handled_at = ?, reason = ? WHERE id = ?',
    approve ? 'approved' : 'denied', handlerId, now(), reason ?? null, id);
  const updated = get('SELECT * FROM staff_requests WHERE id = ?', id);

  if (updated.channel_id && updated.message_id) {
    const ch = await client.channels.fetch(updated.channel_id).catch(() => null);
    const msg = await ch?.messages.fetch(updated.message_id).catch(() => null);
    if (msg) await msg.edit(forEdit(requestMessage(msg.guild, updated))).catch(() => {});
  }
  const user = await client.users.fetch(updated.requester_id).catch(() => null);
  await user?.send(`${approve ? '✅' : '❌'} Your staff request #${id} (${TYPES[updated.type] ?? updated.type}) was **${approve ? 'approved' : 'denied'}**${reason ? `: ${reason}` : '.'}`).catch(() => {});
  return { ok: true, req: updated };
}

module.exports = { TYPES, requestMessage, create, decide };
