// Which roles each kind of post pings. Set with /setup pings; defaults below until changed.
const { getSlot, setSlot, role } = require('./guildConfig');

const EVENTS = {
  staff_request: { label: 'Staff requests', default: ['high_rank'] },
  session_start: { label: 'Session started', default: ['session_pings'] },
  session_end: { label: 'Session ended', default: [] },
  session_vote: { label: 'Session vote', default: ['session_pings'] },
  session_poll: { label: 'Session poll', default: ['session_pings'] },
  session_schedule: { label: 'Session scheduled', default: ['session_pings'] },
  low_activity: { label: 'Low activity alert', default: ['session_pings'] },
  high_activity: { label: 'Server full / almost full alert', default: ['session_pings'] },
};

// Role IDs to ping for an event.
function rolesFor(event) {
  const saved = getSlot(`ping:${event}`);
  if (saved != null) return saved ? saved.split(',') : [];
  return (EVENTS[event]?.default ?? []).map(role).filter(Boolean);
}

function setRoles(event, roleIds) {
  setSlot(`ping:${event}`, roleIds.join(','));
}

// Adds the ping line + allowedMentions to a message payload.
function withPing(payload, event) {
  const roles = rolesFor(event);
  if (!roles.length) return { ...payload, allowedMentions: { ...(payload.allowedMentions ?? {}), parse: [], roles: [] } };
  return {
    ...payload,
    content: [roles.map((r) => `<@&${r}>`).join(' '), payload.content].filter(Boolean).join('\n'),
    allowedMentions: { ...(payload.allowedMentions ?? {}), parse: [], roles },
  };
}

module.exports = { EVENTS, rolesFor, setRoles, withPing };
